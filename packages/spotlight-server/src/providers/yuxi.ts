import type {
  KnowledgeEvidence,
  KnowledgeProvider,
  KnowledgeQuery,
} from "../contracts.js";
import {
  applyYuxiStreamChunk,
  collectYuxiStreamChunks,
  type YuxiToolCallState,
} from "../yuxiStreamTools.js";
import {
  buildYuxiResumeInput,
  isYuxiInterruptStatus,
  parseYuxiInterrupt,
  YUXI_MAX_INTERRUPT_RESUMES,
  YUXI_TOOL_APPROVAL_MODE,
  type YuxiInterrupt,
} from "../yuxiInterrupts.js";

export interface YuxiProviderOptions {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  agentSlug?: string;
  /** Hard deadline for one knowledge search, including auth and streaming. */
  timeoutMs?: number;
}

interface YuxiRunResponse {
  run_id?: string;
  stream_url?: string;
}

interface YuxiStreamOutcome {
  content: string;
  status: string;
  interrupt: YuxiInterrupt | null;
}

interface YuxiKnowledgeBase {
  kb_id?: string;
  id?: string;
  name?: string;
  description?: string;
}

interface YuxiKnowledgeSearchResult {
  content?: string;
  metadata?: Record<string, unknown>;
}

interface YuxiKnowledgeSearchResponse {
  results?: YuxiKnowledgeSearchResult[];
}

function publicYuxiTitle(content: string): string {
  const heading = content.match(/^#{1,6}\s+(.+)$/mu)?.[1]?.trim();
  if (heading) return heading.slice(0, 80);
  return "项目资料";
}

export class YuxiKnowledgeProvider implements KnowledgeProvider {
  readonly id = "yuxi";
  private token: string | null = null;
  private agentId: string | null = null;
  private readonly threadIds = new Map<string, string>();

  constructor(private readonly options: YuxiProviderOptions) {}

  private searchSignal(signal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const timeoutMs = this.options.timeoutMs ?? 120_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const controller = new AbortController();
    const abort = () => {
      const reason = timeout.aborted
        ? new Error(`Yuxi request timed out after ${timeoutMs}ms`)
        : combined.reason;
      controller.abort(reason);
    };
    combined.addEventListener("abort", abort, { once: true });
    return {
      signal: controller.signal,
      cleanup: () => combined.removeEventListener("abort", abort),
    };
  }

  private base(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/u, "")}${path}`;
  }

  private async auth(signal?: AbortSignal): Promise<string> {
    if (this.options.apiKey) return `Bearer ${this.options.apiKey}`;
    if (this.token) return `Bearer ${this.token}`;
    if (!this.options.username || !this.options.password) {
      throw new Error("Yuxi requires apiKey or username/password");
    }
    const response = await fetch(this.base("/api/auth/token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: this.options.username,
        password: this.options.password,
      }),
      signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
    };
    if (!response.ok || !payload.access_token)
      throw new Error(`Yuxi auth failed: ${response.status}`);
    this.token = payload.access_token;
    return `Bearer ${this.token}`;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.base(path), {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        Authorization: await this.auth(init?.signal ?? undefined),
        ...init?.headers,
      },
    });
    if (!response.ok)
      throw new Error(`Yuxi ${path} failed: ${response.status}`);
    return response.json() as Promise<T>;
  }

  private async session(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ agentId: string; threadId: string }> {
    const existingThreadId = this.threadIds.get(sessionId);
    if (this.agentId && existingThreadId)
      return { agentId: this.agentId, threadId: existingThreadId };
    const agentId =
      this.agentId ??
      this.options.agentSlug ??
      (
        await this.json<{
          slug?: string;
          agent_id?: string;
          default_agent_id?: string;
          agent?: { slug?: string; agent_id?: string };
        }>("/api/agent/default", { signal })
      ).agent?.slug;
    if (!agentId) throw new Error("Yuxi default agent is unavailable");
    const thread = await this.json<{ id?: string; thread_id?: string }>(
      "/api/chat/thread",
      {
        method: "POST",
        body: JSON.stringify({
          agent_id: agentId,
          title: "Spotlight knowledge",
          metadata: {
            source: "spotlight-server",
            spotlight_session_id: sessionId,
          },
        }),
        signal,
      },
    );
    const threadId = thread.id ?? thread.thread_id;
    if (!threadId) throw new Error("Yuxi thread creation failed");
    this.agentId = agentId;
    this.threadIds.set(sessionId, threadId);
    return { agentId, threadId };
  }

  private async consumeStream(
    streamUrl: string,
    input: KnowledgeQuery,
    toolState: Map<string, YuxiToolCallState>,
  ): Promise<YuxiStreamOutcome> {
    const response = await fetch(this.base(streamUrl), {
      headers: { Authorization: await this.auth(input.signal) },
      signal: input.signal,
    });
    if (!response.ok) throw new Error(`Yuxi stream failed: ${response.status}`);
    const chunks: string[] = [];
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Yuxi stream has no response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal = false;
    let status = "completed";
    let interrupt: YuxiInterrupt | null = null;
    try {
      while (!terminal) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder
            .decode(value, { stream: !done })
            .replace(/\r\n/gu, "\n");
        }
        if (done) {
          buffer += decoder.decode().replace(/\r\n/gu, "\n");
          if (!buffer.trim()) break;
          buffer += "\n\n";
        }
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          let eventType = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:"))
              eventType = line.slice(6).trim() || "message";
            if (line.startsWith("data:"))
              dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          const envelope = JSON.parse(dataLines.join("\n")) as Record<
            string,
            unknown
          >;
          const payload = envelope.payload as
            Record<string, unknown> | undefined;
          for (const item of collectYuxiStreamChunks(envelope)) {
            const streamEvent = item.stream_event;
            if (
              streamEvent?.type === "message_delta" &&
              typeof streamEvent.content === "string"
            ) {
              chunks.push(streamEvent.content);
            }
            if (!input.onToolEvent) continue;
            for (const event of applyYuxiStreamChunk(toolState, item)) {
              input.onToolEvent(event);
            }
          }
          if (eventType === "interrupt") {
            interrupt = parseYuxiInterrupt(eventType, envelope) ?? interrupt;
          }
          if (eventType === "error") {
            throw new Error(
              String(payload?.message ?? envelope.message ?? "Yuxi run failed"),
            );
          }
          if (eventType === "end") {
            status = String(payload?.status ?? "completed");
            if (!interrupt && isYuxiInterruptStatus(status)) {
              interrupt = parseYuxiInterrupt(eventType, envelope);
            }
            terminal = true;
            break;
          }
        }
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!terminal) throw new Error("Yuxi stream ended before a terminal event");
    return { content: chunks.join(""), status, interrupt };
  }

  private async searchPublicKnowledge(
    input: KnowledgeQuery,
  ): Promise<KnowledgeEvidence[] | null> {
    let knowledgeBases: YuxiKnowledgeBase[];
    try {
      const payload = await this.json<
        YuxiKnowledgeBase[] | { knowledge_bases?: YuxiKnowledgeBase[] }
      >("/api/v1/knowledge/tools/list_kbs", { signal: input.signal });
      knowledgeBases = Array.isArray(payload)
        ? payload
        : (payload.knowledge_bases ?? []);
    } catch (error) {
      // Yuxi 0.7 does not expose the versioned Public API; retain its agent
      // adapter as a compatibility path for installations that still use it.
      if (
        error instanceof Error &&
        error.message.includes("/api/v1/knowledge/tools/list_kbs failed: 404")
      ) {
        return null;
      }
      throw error;
    }

    const toolCall = {
      id: `yuxi-knowledge-${Date.now()}`,
      name: "project_knowledge_search",
      input: { query: input.query },
      displayName: "查询项目知识库",
    };
    input.onToolEvent?.({
      type: "start",
      call: toolCall,
    });

    const visible = knowledgeBases.filter(
      (kb): kb is YuxiKnowledgeBase & { kb_id: string } =>
        typeof (kb.kb_id ?? kb.id) === "string" &&
        Boolean((kb.kb_id ?? kb.id)?.trim()),
    );
    if (!visible.length) {
      input.onToolEvent?.({
        type: "result",
        call: toolCall,
        success: true,
        summary: "当前账号没有可检索的知识库",
        output: { knowledgeBaseCount: 0, resultCount: 0 },
      });
      return [];
    }

    input.onToolEvent?.({
      type: "progress",
      call: toolCall,
      summary: `正在检索 ${visible.length} 个可访问知识库`,
    });

    const searches = await Promise.allSettled(
      visible.map(async (kb) => {
        const kbId = kb.kb_id ?? kb.id!;
        const response = await this.json<YuxiKnowledgeSearchResponse>(
          "/api/v1/knowledge/tools/query_kb",
          {
            method: "POST",
            body: JSON.stringify({ kb_id: kbId, query_text: input.query }),
            signal: input.signal,
          },
        );
        return (response.results ?? []).flatMap((result) => {
          if (typeof result.content !== "string" || !result.content.trim())
            return [];
          const metadata = result.metadata ?? {};
          const source =
            typeof metadata.source === "string" ? metadata.source : undefined;
          const score =
            typeof metadata.score === "number" ? metadata.score : undefined;
          return [
            {
              content: result.content,
              title: source ? `${kb.name ?? "项目资料"} · ${source}` : kb.name,
              score,
              metadata: {
                ...metadata,
                provider: this.id,
                kbId,
                kbName: kb.name,
              },
            } satisfies KnowledgeEvidence,
          ];
        });
      }),
    );

    const evidence: KnowledgeEvidence[] = [];
    const errors: Error[] = [];
    for (const search of searches) {
      if (search.status === "fulfilled") evidence.push(...search.value);
      else if (search.reason instanceof Error) errors.push(search.reason);
    }
    if (!evidence.length && errors.length) throw errors[0];

    evidence.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 8)));
    const selected = evidence.slice(0, limit);
    input.onToolEvent?.({
      type: "result",
      call: toolCall,
      success: true,
      summary: `从 ${visible.length} 个知识库检索到 ${selected.length} 条资料`,
      output: {
        knowledgeBaseCount: visible.length,
        resultCount: selected.length,
      },
    });
    return selected;
  }

  private async searchViaAgent(
    input: KnowledgeQuery,
  ): Promise<KnowledgeEvidence[]> {
    const session = await this.session(input.sessionId, input.signal);
    const toolState = new Map<string, YuxiToolCallState>();
    const contentParts: string[] = [];
    let parentRunId: string | undefined;
    let resume: Record<string, unknown> | undefined;

    for (let attempt = 0; attempt <= YUXI_MAX_INTERRUPT_RESUMES; attempt += 1) {
      const run = await this.json<YuxiRunResponse>("/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          query: resume ? undefined : input.query,
          agent_slug: session.agentId,
          thread_id: session.threadId,
          tool_approval_mode: YUXI_TOOL_APPROVAL_MODE,
          resume,
          created_by_run_id: resume ? parentRunId : undefined,
          meta: {
            source: "spotlight-server",
            projectId: input.projectId,
          },
        }),
        signal: input.signal,
      });
      if (!run.stream_url) throw new Error("Yuxi run returned no stream URL");
      parentRunId = run.run_id ?? parentRunId;
      const outcome = await this.consumeStream(
        run.stream_url,
        input,
        toolState,
      );
      if (outcome.content) contentParts.push(outcome.content);
      if (outcome.status === "completed") {
        const content = contentParts.join("").trim();
        if (!content) throw new Error("Yuxi returned no answer content");
        return [
          {
            content,
            title: publicYuxiTitle(content),
            metadata: { provider: this.id, runId: parentRunId },
          },
        ];
      }
      if (
        !outcome.interrupt ||
        !parentRunId ||
        attempt === YUXI_MAX_INTERRUPT_RESUMES
      ) {
        throw new Error(`Yuxi run ended with status ${outcome.status}`);
      }
      resume = buildYuxiResumeInput(outcome.interrupt);
    }

    throw new Error("Yuxi run ended with status interrupted");
  }

  async search(input: KnowledgeQuery): Promise<KnowledgeEvidence[]> {
    const scoped = this.searchSignal(input.signal);
    const scopedInput = { ...input, signal: scoped.signal };
    try {
      const publicEvidence = await this.searchPublicKnowledge(scopedInput);
      if (publicEvidence !== null) return publicEvidence;
      return this.searchViaAgent(scopedInput);
    } finally {
      scoped.cleanup();
    }
  }
}
