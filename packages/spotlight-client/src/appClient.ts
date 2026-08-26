import {
  SPOTLIGHT_APP_PROTOCOL_V1,
  defaultSpotlightClientCapabilities,
  spotlightSkillToolNames,
  type FrontendToolManifestV1,
  type HostToolResultRequest,
  type SpotlightInitializeResponse,
  type SpotlightItem,
  type SpotlightSkill,
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
  SpotlightHttpError,
} from "./http.js";
import {
  createClientToolManifest,
  createClientToolRegistry,
  type ClientTool,
} from "./clientTool.js";
import type { SpotlightResourceProvider } from "./resourceProvider.js";

export interface SpotlightAppClientOptions extends SpotlightClientConfig {
  toolManifest?:
    | FrontendToolManifestV1
    | (() => FrontendToolManifestV1 | Promise<FrontendToolManifestV1>);
  /** Preferred: register Tools and let the SDK derive and snapshot the manifest. */
  tools?: readonly ClientTool[] | (() => readonly ClientTool[]);
  /** Resource providers generate search/get/action Tools and optional Skills. */
  resources?:
    | readonly SpotlightResourceProvider[]
    | (() => readonly SpotlightResourceProvider[]);
  frontendBuildId?: string;
  skills?:
    | Array<SpotlightSkill | SpotlightSkillRegistration>
    | (() => Array<SpotlightSkill | SpotlightSkillRegistration>);
  executeTool?: (request: {
    turnId: string;
    item: Extract<SpotlightItem, { type: "tool_call" }>;
  }) => Promise<{
    success: boolean;
    output?: unknown;
    error?: string;
    trace?: HostToolResultRequest["trace"];
    uiContext?: HostToolResultRequest["uiContext"];
  }>;
  approveTool?: (request: {
    turnId: string;
    item: Extract<SpotlightItem, { type: "tool_call" }>;
    reason?: string;
  }) => boolean | Promise<boolean>;
  clientInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
}

function valueOf<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function normalizeSkills(
  skills: Array<SpotlightSkill | SpotlightSkillRegistration>,
): {
  registrations: SpotlightSkillRegistration[];
  definitions: SpotlightSkill[];
} {
  const definitions = skills.map((skill) => {
    const candidate = skill as SpotlightSkill & SpotlightSkillRegistration;
    return {
      ...candidate,
      policy: candidate.policy ?? {
        allowImplicitInvocation: candidate.allowImplicitInvocation !== false,
      },
    } satisfies SpotlightSkill;
  });
  return {
    definitions,
    registrations: definitions.map((skill) => ({
      name: skill.name,
      displayName: skill.interface?.displayName ?? skill.displayName,
      description: skill.description,
      version: skill.version,
      allowImplicitInvocation:
        skill.policy?.allowImplicitInvocation ??
        skill.disableModelInvocation !== true,
      userInvocable: skill.userInvocable,
      dependencies: { tools: spotlightSkillToolNames(skill) },
    })),
  };
}

export interface SpotlightRunResult {
  thread: SpotlightThread;
  turn: SpotlightTurn;
  events: SpotlightTurnEvent[];
  items: SpotlightItem[];
  finalResponse: string;
  summary?: Extract<SpotlightTurnEvent, { type: "turn.completed" }>["summary"];
}

export interface SpotlightRunOptions extends Omit<
  SpotlightTurnStartRequest,
  "input"
> {
  signal?: AbortSignal;
  threadId?: string;
}

export interface SpotlightThreadHandle {
  readonly id: string | undefined;
  run(
    input: string,
    options?: Omit<SpotlightRunOptions, "threadId">,
  ): Promise<SpotlightRunResult>;
}

async function asyncValueOf<T>(value: T | (() => T | Promise<T>)): Promise<T> {
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
  private capabilitySessionId: string | null = null;
  private toolRegistry: ReturnType<typeof createClientToolRegistry> | null =
    null;

  constructor(private readonly options: SpotlightAppClientOptions) {
    this.http = createSpotlightHttp(options);
  }

  private async manifest(): Promise<FrontendToolManifestV1> {
    if (this.options.toolManifest)
      return asyncValueOf(this.options.toolManifest);
    const tools = this.resolveTools();
    if (tools.length === 0)
      throw new Error("Spotlight requires tools, resources or toolManifest");
    this.toolRegistry = createClientToolRegistry(tools);
    return createClientToolManifest({
      projectId: this.options.projectId,
      frontendBuildId: this.options.frontendBuildId?.trim() || "development",
      tools,
    });
  }

  private resolveResources(): readonly SpotlightResourceProvider[] {
    return this.options.resources ? valueOf(this.options.resources) : [];
  }

  private resolveTools(): readonly ClientTool[] {
    const direct = this.options.tools ? valueOf(this.options.tools) : [];
    return [
      ...direct,
      ...this.resolveResources().flatMap((resource) => resource.tools),
    ];
  }

  private resolveSkills(): Array<SpotlightSkill | SpotlightSkillRegistration> {
    const direct = this.options.skills ? valueOf(this.options.skills) : [];
    const generated = this.resolveResources().flatMap((resource) =>
      resource.skill ? [resource.skill] : [],
    );
    return [...direct, ...generated];
  }

  async initialize(signal?: AbortSignal): Promise<SpotlightInitializeResponse> {
    const manifest = await this.manifest();
    if (
      this.initialization &&
      this.initializedDigest === manifest.manifestDigest
    ) {
      return this.initialization;
    }
    this.initializedDigest = manifest.manifestDigest;
    const normalizedSkills = normalizeSkills(this.resolveSkills());
    this.initialization = this.http
      .postJson<SpotlightInitializeResponse>(
        "/v1/initialize",
        {
          protocolVersion: SPOTLIGHT_APP_PROTOCOL_V1,
          projectId: this.options.projectId,
          clientInfo: {
            name: this.options.clientInfo?.name ?? "spotlight-typescript",
            title: this.options.clientInfo?.title,
            version: this.options.clientInfo?.version ?? "0.8.2",
          },
          capabilities: defaultSpotlightClientCapabilities(),
          toolManifest: manifest,
          skills: normalizedSkills.registrations,
          skillDefinitions: normalizedSkills.definitions,
        },
        signal,
      )
      .then((response) => {
        this.capabilitySessionId = response.capabilitySession.id;
        return response;
      })
      .catch((error) => {
        this.initialization = null;
        this.capabilitySessionId = null;
        throw error;
      });
    return this.initialization;
  }

  async startThread(
    threadId?: string,
    signal?: AbortSignal,
  ): Promise<SpotlightThread> {
    await this.initialize(signal);
    const response = await this.http.postJson<{ thread: SpotlightThread }>(
      "/v1/threads",
      { projectId: this.options.projectId, threadId },
      signal,
    );
    return response.thread;
  }

  thread(threadId?: string): SpotlightThreadHandle {
    let resolvedId = threadId;
    return {
      get id() {
        return resolvedId;
      },
      run: async (input, options = {}) => {
        const result = await this.run(input, {
          ...options,
          threadId: resolvedId,
        });
        resolvedId = result.thread.id;
        return result;
      },
    };
  }

  async listThreads(signal?: AbortSignal): Promise<SpotlightThread[]> {
    const response = await this.http.getJson<{ threads: SpotlightThread[] }>(
      "/v1/threads",
      signal,
    );
    return response.threads;
  }

  async forkThread(
    threadId: string,
    signal?: AbortSignal,
  ): Promise<SpotlightThread> {
    const response = await this.http.postJson<{ thread: SpotlightThread }>(
      `/v1/threads/${encodeURIComponent(threadId)}/fork`,
      {},
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
    const start = () =>
      this.http.postJson<{ turn: SpotlightTurn }>(
        `/v1/threads/${encodeURIComponent(threadId)}/turns`,
        {
          ...request,
          capabilitySessionId:
            request.capabilitySessionId ?? this.capabilitySessionId,
        },
        signal,
      );
    try {
      return (await start()).turn;
    } catch (error) {
      if (
        !(error instanceof SpotlightHttpError) ||
        error.code !== "CAPABILITY_SESSION_EXPIRED"
      ) {
        throw error;
      }
      this.initialization = null;
      this.capabilitySessionId = null;
      await this.initialize(signal);
      return (await start()).turn;
    }
  }

  async run(
    input: string,
    options: SpotlightRunOptions = {},
  ): Promise<SpotlightRunResult> {
    const { signal, threadId, ...request } = options;
    const thread = await this.startThread(threadId, signal);
    const turn = await this.startTurn(thread.id, { ...request, input }, signal);
    const events: SpotlightTurnEvent[] = [];
    const items = new Map<string, SpotlightItem>();
    const submitted = new Set<string>();
    let finalResponse = "";
    let summary: SpotlightRunResult["summary"];
    for await (const event of this.streamTurn(turn.id, signal)) {
      events.push(event);
      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        items.set(event.item.id, event.item);
        const clientRequest =
          event.item.type === "tool_call"
            ? event.item.clientRequest
            : undefined;
        if (
          event.item.type === "tool_call" &&
          event.item.status === "waiting_for_client" &&
          clientRequest &&
          !submitted.has(clientRequest.correlationId)
        ) {
          submitted.add(clientRequest.correlationId);
          let approved = !clientRequest.approvalRequired;
          if (!approved && this.options.approveTool) {
            approved = await this.options.approveTool({
              turnId: turn.id,
              item: event.item,
              reason: clientRequest.approvalReason,
            });
          }
          const result = !approved
            ? { success: false, error: "Tool execution was not approved" }
            : this.options.executeTool
              ? await this.options.executeTool({
                  turnId: turn.id,
                  item: event.item,
                })
              : this.toolRegistry?.has(event.item.tool)
                ? await this.toolRegistry
                    .executeResult(event.item.tool, event.item.arguments)
                    .then((result) =>
                      result.success
                        ? { success: true, output: result }
                        : {
                            success: false,
                            error: result.error.message,
                            errorCode: result.error.code,
                          },
                    )
                : {
                    success: false,
                    error: `Client tool is not registered: ${event.item.tool}`,
                  };
          await this.submitToolResult(
            turn.id,
            {
              correlationId: clientRequest.correlationId,
              ...result,
            },
            signal,
          );
        }
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      } else if (event.type === "turn.completed") {
        finalResponse = event.finalResponse;
        summary = event.summary;
      }
    }
    return {
      thread,
      turn,
      events,
      items: [...items.values()],
      finalResponse,
      summary,
    };
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
            if (
              event.type === "turn.completed" ||
              event.type === "turn.failed"
            ) {
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
