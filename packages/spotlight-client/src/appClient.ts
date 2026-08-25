import {
  SPOTLIGHT_APP_PROTOCOL_V1,
  defaultSpotlightClientCapabilities,
  type FrontendToolManifestV1,
  type HostToolResultRequest,
  type SpotlightInitializeResponse,
  type SpotlightSkillRegistration,
  type SpotlightThread,
  type SpotlightTurn,
  type SpotlightTurnEvent,
  type SpotlightTurnStartRequest,
} from "@inupedia/spotlight-protocol";
import {
  buildJsonHeaders,
  createSpotlightHttp,
  type SpotlightClientConfig,
} from "./http.js";

export interface SpotlightAppClientOptions extends SpotlightClientConfig {
  toolManifest:
    | FrontendToolManifestV1
    | (() => FrontendToolManifestV1 | Promise<FrontendToolManifestV1>);
  skills?: SpotlightSkillRegistration[] | (() => SpotlightSkillRegistration[]);
  clientInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
}

function valueOf<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

async function asyncValueOf<T>(
  value: T | (() => T | Promise<T>),
): Promise<T> {
  return typeof value === "function"
    ? await (value as () => T | Promise<T>)()
    : value;
}

function reconnectDelay(attempt: number): number {
  return Math.min(400 * 2 ** attempt, 5_000);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSseFrames(buffer: string): {
  events: SpotlightTurnEvent[];
  rest: string;
} {
  const frames = buffer.split(/\n\n/u);
  const rest = frames.pop() ?? "";
  const events = frames.flatMap((frame) => {
    const data = frame
      .split(/\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return [];
    try {
      const parsed = JSON.parse(data) as SpotlightTurnEvent | { type: "ping" };
      return parsed.type === "ping" && !("seq" in parsed)
        ? []
        : [parsed as SpotlightTurnEvent];
    } catch {
      return [];
    }
  });
  return { events, rest };
}

export class SpotlightAppClient {
  private readonly http;
  private initialization: Promise<SpotlightInitializeResponse> | null = null;
  private initializedDigest: string | null = null;

  constructor(private readonly options: SpotlightAppClientOptions) {
    this.http = createSpotlightHttp(options);
  }

  async initialize(signal?: AbortSignal): Promise<SpotlightInitializeResponse> {
    const manifest = await asyncValueOf(this.options.toolManifest);
    if (this.initialization && this.initializedDigest === manifest.manifestDigest) {
      return this.initialization;
    }
    this.initializedDigest = manifest.manifestDigest;
    this.initialization = this.http.postJson<SpotlightInitializeResponse>(
      "/v1/initialize",
      {
        protocolVersion: SPOTLIGHT_APP_PROTOCOL_V1,
        projectId: this.options.projectId,
        clientInfo: {
          name: this.options.clientInfo?.name ?? "spotlight-typescript",
          title: this.options.clientInfo?.title,
          version: this.options.clientInfo?.version ?? "0.7.0",
        },
        capabilities: defaultSpotlightClientCapabilities(),
        toolManifest: manifest,
        skills: this.options.skills ? valueOf(this.options.skills) : [],
      },
      signal,
    ).catch((error) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  async startThread(threadId?: string, signal?: AbortSignal): Promise<SpotlightThread> {
    await this.initialize(signal);
    const response = await this.http.postJson<{ thread: SpotlightThread }>(
      "/v1/threads",
      { projectId: this.options.projectId, threadId },
      signal,
    );
    return response.thread;
  }

  async startTurn(
    threadId: string,
    request: SpotlightTurnStartRequest,
    signal?: AbortSignal,
  ): Promise<SpotlightTurn> {
    await this.initialize(signal);
    const response = await this.http.postJson<{ turn: SpotlightTurn }>(
      `/v1/threads/${encodeURIComponent(threadId)}/turns`,
      request,
      signal,
    );
    return response.turn;
  }

  async *streamTurn(
    turnId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<SpotlightTurnEvent> {
    let lastSeq = 0;
    let reconnects = 0;
    while (!signal?.aborted) {
      const query = lastSeq > 0 ? `?lastEventId=${lastSeq}` : "";
      let response: Response;
      try {
        response = await fetch(
          `${this.http.getBase()}/v1/turns/${encodeURIComponent(turnId)}/events${query}`,
          { headers: buildJsonHeaders(this.http.config), signal },
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        reconnects += 1;
        if (reconnects > 6) throw error;
        await wait(reconnectDelay(reconnects - 1));
        continue;
      }
      if (response.status === 410) {
        throw new Error("Spotlight 后端已不再保留这次 Turn，请重新提问。");
      }
      if (!response.ok || !response.body) {
        throw new Error(`Spotlight Turn 事件流连接失败：${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.seq <= lastSeq) continue;
            lastSeq = event.seq;
            yield event;
            if (event.type === "turn.completed" || event.type === "turn.failed") {
              terminal = true;
              return;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (terminal || signal?.aborted) return;
      reconnects += 1;
      if (reconnects > 6) {
        throw new Error("Spotlight Turn 事件流多次重连失败，请重试。");
      }
      await wait(reconnectDelay(reconnects - 1));
    }
  }

  submitToolResult(
    turnId: string,
    result: HostToolResultRequest,
    signal?: AbortSignal,
  ): Promise<{ ok: true }> {
    return this.http.postJson(
      `/v1/turns/${encodeURIComponent(turnId)}/tool-results`,
      result,
      signal,
    );
  }

  cancelTurn(turnId: string): Promise<void> {
    return fetch(
      `${this.http.getBase()}/v1/turns/${encodeURIComponent(turnId)}`,
      { method: "DELETE", headers: buildJsonHeaders(this.http.config) },
    ).then(() => undefined);
  }
}

export function createSpotlightAppClient(
  options: SpotlightAppClientOptions,
): SpotlightAppClient {
  return new SpotlightAppClient(options);
}
