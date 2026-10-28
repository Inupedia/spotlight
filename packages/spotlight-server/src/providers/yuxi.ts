import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeEvidence,
  KnowledgeProvider,
  KnowledgeQuery,
} from "../contracts.js";
import {
  applyYuxiStreamChunk,
  type YuxiToolCallState,
} from "../yuxiStreamTools.js";
import {
  buildYuxiResumeInput,
  parseYuxiInterrupt,
  YUXI_MAX_INTERRUPT_RESUMES,
  YUXI_TOOL_APPROVAL_MODE,
} from "../yuxiInterrupts.js";

export interface YuxiProviderOptions {
  baseUrl: string;
  apiKey?: string;
  /** Yuxi Agents Public API key; Yuxi requires it to have an APP ID. */
  agentApiKey?: string;
  username?: string;
  password?: string;
  agentSlug?: string;
  /** Optional Yuxi session model override when its configured default is unavailable. */
  agentModel?: string;
  /** Hard deadline for one knowledge search, including auth and streaming. */
  timeoutMs?: number;
}

interface YuxiStreamOutcome {
  content: string;
  status: string;
  turnId?: string;
  waitpoint?: Record<string, unknown>;
  error?: string;
}

interface YuxiSessionState {
  threadId: string;
  cursor?: string;
}

const YUXI_KNOWLEDGE_RETRIEVAL_TOOLS = new Set([
  "query_kb",
  "search_file",
  "find_kb_document",
  "open_kb_document",
]);

function publicYuxiTitle(content: string): string {
  const heading = content.match(/^#{1,6}\s+(.+)$/mu)?.[1]?.trim();
  if (heading) return heading.slice(0, 80);
  return "项目资料";
}

function yuxiAgentRequestError(
  path: string,
  status: number,
  payload: unknown,
): Error {
  const root = asRecord(payload);
  const detail = asRecord(root?.detail);
  const code = typeof detail?.code === "string" ? detail.code : undefined;
  const message =
    (typeof detail?.message === "string" && detail.message) ||
    (typeof root?.detail === "string" && root.detail) ||
    (typeof root?.message === "string" && root.message) ||
    undefined;
  const reason = [code, message].filter(Boolean).join(": ").slice(0, 300);
  if (
    (path === "/api/v1/agents" || path.startsWith("/api/v1/agents/")) &&
    (status === 401 || status === 403)
  ) {
    return new Error(
      `Yuxi Agents Public API failed: ${status}. Use Yuxi service-account credentials with Agent and knowledge-base access, or an Agents API key with an APP ID; Knowledge-only keys cannot run an Agent.`,
    );
  }
  const api =
    path === "/api/v1/agents" || path.startsWith("/api/v1/agents/")
      ? "Yuxi Agents Public API"
      : `Yuxi ${path}`;
  return new Error(
    `${api} failed on ${path}: ${status}${reason ? ` (${reason})` : ""}`,
  );
}

function outputText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      if (item.type !== "message" || item.role !== "assistant") return [];
      if (item.phase && item.phase !== "final_answer") return [];
      if (!Array.isArray(item.content)) return [];
      return item.content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const content = part as Record<string, unknown>;
        return content.type === "output_text" && typeof content.text === "string"
          ? [content.text]
          : [];
      });
    })
    .join("");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class YuxiKnowledgeProvider implements KnowledgeProvider {
  readonly id = "yuxi";
  private token: string | null = null;
  private readonly sessions = new Map<string, YuxiSessionState>();

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
    if (this.options.agentApiKey) return `Bearer ${this.options.agentApiKey}`;
    if (this.token) return `Bearer ${this.token}`;
    if (this.options.username && this.options.password) {
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
    if (this.options.apiKey) return `Bearer ${this.options.apiKey}`;
    throw new Error(
      "Yuxi requires agentApiKey, username/password, or apiKey",
    );
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    headers.set("Authorization", await this.auth(init?.signal ?? undefined));
    const response = await fetch(this.base(path), {
      ...init,
      headers,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw yuxiAgentRequestError(path, response.status, payload);
    }
    return response.json() as Promise<T>;
  }

  private async session(
    sessionId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<YuxiSessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const agentId = this.options.agentSlug?.trim() || "default-chatbot";
    const agentModel = this.options.agentModel?.trim();
    const idempotencyKey = `spotlight-session-${createHash("sha256")
      .update(sessionId)
      .digest("hex")}`;
    const session = await this.json<{ id?: string }>(
      "/api/v1/agents/sessions",
      {
        method: "POST",
        body: JSON.stringify({
          agent_id: agentId,
          title: `Spotlight knowledge · ${projectId}`,
          tool_approval_mode: YUXI_TOOL_APPROVAL_MODE,
          ...(agentModel ? { agent: { model: agentModel } } : {}),
        }),
        headers: { "Idempotency-Key": idempotencyKey },
        signal,
      },
    );
    const threadId = session.id;
    if (!threadId) throw new Error("Yuxi thread creation failed");
    const result = { threadId };
    this.sessions.set(sessionId, result);
    return result;
  }

  private async consumeStream(
    session: YuxiSessionState,
    sessionPath: string,
    input: KnowledgeQuery,
    toolState: Map<string, YuxiToolCallState>,
  ): Promise<YuxiStreamOutcome> {
    const headers = new Headers({
      Authorization: await this.auth(input.signal),
    });
    if (session.cursor) headers.set("Last-Event-ID", session.cursor);
    const response = await fetch(this.base(`${sessionPath}/events`), {
      headers,
      signal: input.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw yuxiAgentRequestError(
        `${sessionPath}/events`,
        response.status,
        payload,
      );
    }
    const chunks: string[] = [];
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Yuxi stream has no response body");
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
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
          let cursor: string | undefined;
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:"))
              eventType = line.slice(6).trim() || "message";
            if (line.startsWith("id:")) cursor = line.slice(3).trim();
            if (line.startsWith("data:"))
              dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          const event = JSON.parse(dataLines.join("\n")) as Record<
            string,
            unknown
          >;
          if (cursor) session.cursor = cursor;
          const type = typeof event.type === "string" ? event.type : eventType;

          if (type === "agent.session.turn.output_text.delta") {
            if (typeof event.delta === "string") chunks.push(event.delta);
          } else if (type === "agent.session.turn.item.added") {
            const item = asRecord(event.item);
            if (item?.type === "function_call" && input.onToolEvent) {
              const id = String(item.call_id ?? item.id ?? "");
              const name = String(item.name ?? "");
              if (id && name) {
                const toolChunk = {
                  msg: {
                    tool_calls: [
                      {
                        id,
                        name,
                        args: item.arguments,
                      },
                    ],
                  },
                };
                for (const toolEvent of applyYuxiStreamChunk(
                  toolState,
                  toolChunk,
                )) {
                  input.onToolEvent(toolEvent);
                }
              }
            }
          } else if (type === "agent.session.turn.item.done") {
            const item = asRecord(event.item);
            if (
              item?.type === "function_call_output" &&
              input.onToolEvent
            ) {
              const id = String(item.call_id ?? "");
              const tool = toolState.get(id);
              const error = item.error;
              const output = item.output ?? error ?? null;
              const toolChunk = {
                msg: {
                  type: "tool",
                  name: tool?.name ?? id ?? "knowledge_tool",
                  tool_call_id: id,
                  content: output,
                },
              };
              for (const toolEvent of applyYuxiStreamChunk(
                toolState,
                toolChunk,
              )) {
                if (toolEvent.type !== "result") {
                  input.onToolEvent(toolEvent);
                } else {
                  const failed = item.status === "failed";
                  input.onToolEvent({
                    ...toolEvent,
                    success: !failed,
                    summary: failed
                      ? `${tool?.name ?? "知识库工具"} 执行失败`
                      : toolEvent.summary,
                    ...(failed
                      ? {
                          error:
                            typeof error === "string"
                              ? error
                              : JSON.stringify(error ?? "Yuxi tool failed"),
                        }
                      : {}),
                  });
                }
              }
            }
          } else if (type === "yuxi.session.turn.waiting") {
            const waitpoint = asRecord(event.waitpoint);
            const turn = asRecord(event.turn);
            return {
              content: chunks.join(""),
              status: "requires_action",
              turnId:
                (typeof turn?.id === "string" && turn.id) ||
                (typeof event.turn_id === "string" ? event.turn_id : undefined),
              waitpoint,
            };
          } else if (type === "agent.session.turn.completed") {
            const turn = asRecord(event.turn);
            return {
              content: chunks.join(""),
              status: "completed",
              turnId:
                (typeof event.turn_id === "string" && event.turn_id) ||
                (typeof turn?.id === "string" ? turn.id : undefined),
            };
          } else if (
            type === "agent.session.turn.failed" ||
            type === "agent.session.turn.cancelled"
          ) {
            const turn = asRecord(event.turn);
            const error = asRecord(turn?.error);
            return {
              content: chunks.join(""),
              status:
                type === "agent.session.turn.failed" ? "failed" : "cancelled",
              turnId:
                (typeof event.turn_id === "string" && event.turn_id) ||
                (typeof turn?.id === "string" ? turn.id : undefined),
              error:
                typeof error?.message === "string"
                  ? error.message
                  : undefined,
            };
          } else if (type === "error") {
            const yuxiError = asRecord(event.error);
            throw new Error(
              String(
                event.message ??
                  yuxiError?.message ??
                  "Yuxi Agent session failed",
              ),
            );
          }
        }
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    throw new Error("Yuxi Agent event stream ended before a turn result");
  }

  private async submitEvent(
    session: YuxiSessionState,
    event: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const sessionPath = `/api/v1/agents/sessions/${encodeURIComponent(session.threadId)}`;
    await this.json(`${sessionPath}/events`, {
      method: "POST",
      headers: { "Idempotency-Key": `spotlight-${randomUUID()}` },
      body: JSON.stringify({ events: [event] }),
      signal,
    });
  }

  private async searchViaAgent(
    input: KnowledgeQuery,
  ): Promise<KnowledgeEvidence[]> {
    const session = await this.session(
      input.sessionId,
      input.projectId,
      input.signal,
    );
    const sessionPath = `/api/v1/agents/sessions/${encodeURIComponent(session.threadId)}`;
    const toolState = new Map<string, YuxiToolCallState>();
    const contentParts: string[] = [];
    let knowledgeQuerySucceeded = false;
    const streamInput: KnowledgeQuery = {
      ...input,
      onToolEvent: (event) => {
        if (
          event.type === "result" &&
          event.success &&
          YUXI_KNOWLEDGE_RETRIEVAL_TOOLS.has(event.call.name)
        ) {
          knowledgeQuerySucceeded = true;
        }
        input.onToolEvent?.(event);
      },
    };
    await this.submitEvent(
      session,
      {
        type: "agent.session.input.message",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: input.query }],
          },
        ],
        yuxi: { tool_approval_mode: YUXI_TOOL_APPROVAL_MODE },
      },
      input.signal,
    );

    for (let attempt = 0; attempt <= YUXI_MAX_INTERRUPT_RESUMES; attempt += 1) {
      const outcome = await this.consumeStream(
        session,
        sessionPath,
        streamInput,
        toolState,
      );
      if (outcome.content) contentParts.push(outcome.content);
      if (outcome.status === "completed") {
        if (!knowledgeQuerySucceeded) {
          throw new Error(
            "Yuxi Agent completed without successfully querying a knowledge-base retrieval tool",
          );
        }
        let content = contentParts.join("").trim();
        if (!content && outcome.turnId) {
          const turn = await this.json<{
            yuxi?: { output?: unknown };
          }>(`${sessionPath}/turns/${encodeURIComponent(outcome.turnId)}`, {
            signal: input.signal,
          });
          content = outputText(turn.yuxi?.output).trim();
        }
        if (!content) throw new Error("Yuxi returned no answer content");
        return [
          {
            content,
            title: publicYuxiTitle(content),
            metadata: {
              provider: this.id,
              threadId: session.threadId,
              turnId: outcome.turnId,
            },
          },
        ];
      }
      if (
        outcome.status !== "requires_action" ||
        !outcome.turnId ||
        !outcome.waitpoint ||
        attempt === YUXI_MAX_INTERRUPT_RESUMES
      ) {
        throw new Error(
          outcome.error || `Yuxi Agent turn ended with status ${outcome.status}`,
        );
      }

      const waitpoint = outcome.waitpoint;
      const interrupt = parseYuxiInterrupt("interrupt", {
        payload: {
          status: waitpoint.kind,
          questions: waitpoint.questions,
          approval: { action_requests: waitpoint.calls },
        },
      });
      if (!interrupt) throw new Error("Yuxi Agent returned an unknown waitpoint");
      let response: Record<string, unknown>;
      if (interrupt.kind === "human_approval") {
        const calls = Array.isArray(waitpoint.calls) ? waitpoint.calls : [];
        response = {
          type: "approval",
          decisions: calls.flatMap((value) => {
            const call = asRecord(value);
            const callId = call?.call_id ?? call?.id;
            return typeof callId === "string"
              ? [{ call_id: callId, decision: "approve" }]
              : [];
          }),
        };
      } else {
        const questions = Array.isArray(waitpoint.questions)
          ? waitpoint.questions
          : [];
        const answers = buildYuxiResumeInput(interrupt);
        response = {
          type: "answer",
          answers: questions.flatMap((value) => {
            const question = asRecord(value);
            const questionId = question?.question_id ?? question?.id;
            return typeof questionId === "string" && questionId in answers
              ? [{ question_id: questionId, answer: answers[questionId] }]
              : [];
          }),
        };
      }
      const resumeItems = Array.isArray(response.decisions)
        ? response.decisions
        : Array.isArray(response.answers)
          ? response.answers
          : [];
      if (!resumeItems.length) {
        throw new Error("Yuxi Agent returned a waitpoint that cannot be resumed");
      }
      await this.submitEvent(
        session,
        {
          type: "yuxi.session.input.resume",
          turn_id: outcome.turnId,
          waitpoint_id: String(waitpoint.id ?? ""),
          response,
        },
        input.signal,
      );
    }

    throw new Error("Yuxi Agent turn remained interrupted");
  }

  async search(input: KnowledgeQuery): Promise<KnowledgeEvidence[]> {
    const scoped = this.searchSignal(input.signal);
    const scopedInput = { ...input, signal: scoped.signal };
    try {
      return await this.searchViaAgent(scopedInput);
    } finally {
      scoped.cleanup();
    }
  }
}
