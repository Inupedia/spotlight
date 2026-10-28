import { afterEach, describe, expect, it, vi } from "vitest";
import { YuxiKnowledgeProvider } from "../src/index.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseFrame(id: string, type: string, data: Record<string, unknown>): string {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}`;
}

function sse(...frames: string[]): Response {
  return new Response(`${frames.join("\n\n")}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Yuxi knowledge provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs knowledge searches through Agents Public API and prefers its scoped key", async () => {
    const requestedUrls: string[] = [];
    const authorizationHeaders: string[] = [];
    const sessionBodies: Array<Record<string, unknown>> = [];
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requestedUrls.push(url);
        authorizationHeaders.push(
          new Headers(init?.headers).get("Authorization") ?? "",
        );
        if (
          url.endsWith("/api/v1/agents/sessions") &&
          (init?.method ?? "GET") === "POST"
        ) {
          sessionBodies.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          return json({ id: "session-agent" }, 201);
        }
        if (url.endsWith("/api/v1/agents/sessions/session-agent/events")) {
          if (init?.method === "POST") {
            eventBodies.push(
              JSON.parse(String(init.body)) as Record<string, unknown>,
            );
            return json(
              {
                object: "yuxi.session.event.accepted",
                session_id: "session-agent",
                input_id: "input-1",
              },
              202,
            );
          }
          return sse(
            sseFrame("cursor-call", "agent.session.turn.item.added", {
              type: "agent.session.turn.item.added",
              turn_id: "turn-agent",
              item: {
                type: "function_call",
                call_id: "kb-1",
                name: "query_kb",
                arguments: { query: "介绍项目" },
                status: "in_progress",
              },
            }),
            sseFrame("cursor-output", "agent.session.turn.item.done", {
              type: "agent.session.turn.item.done",
              turn_id: "turn-agent",
              item: {
                type: "function_call_output",
                call_id: "kb-1",
                output: [{ title: "项目概况" }],
                status: "completed",
              },
            }),
            sseFrame("cursor-delta", "agent.session.turn.output_text.delta", {
              type: "agent.session.turn.output_text.delta",
              turn_id: "turn-agent",
              delta: "来自 Yuxi Agent 的回答",
            }),
            sseFrame("cursor-done", "agent.session.turn.completed", {
              type: "agent.session.turn.completed",
              turn_id: "turn-agent",
              turn: { id: "turn-agent", status: "completed" },
            }),
          );
        }
        if (url.includes("/api/v1/knowledge/tools/"))
          return json({ results: [{ content: "direct API should not run" }] });
        return new Response("not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "knowledge-only-key",
      agentApiKey: "agents-api-key",
      agentModel: " siliconflow-cn:deepseek-ai/DeepSeek-V4-Flash ",
    });
    const toolEvents: string[] = [];
    const evidence = await provider.search({
      query: "介绍项目",
      projectId: "ydjm",
      sessionId: "session-agent-route",
      onToolEvent: (event) => {
        toolEvents.push(event.type === "start" ? `start:${event.call.name}` : event.type);
      },
    });

    expect(evidence[0]?.content).toBe("来自 Yuxi Agent 的回答");
    expect(requestedUrls.some((url) => url.endsWith("/api/v1/agents/sessions"))).toBe(
      true,
    );
    expect(sessionBodies[0]).toMatchObject({
      agent_id: "default-chatbot",
      agent: { model: "siliconflow-cn:deepseek-ai/DeepSeek-V4-Flash" },
    });
    expect(
      requestedUrls.some((url) => url.endsWith("/api/v1/agents/sessions/session-agent/events")),
    ).toBe(true);
    expect(
      requestedUrls.some((url) => url.includes("/api/v1/knowledge/tools/")),
    ).toBe(false);
    expect(
      authorizationHeaders.every((value) => value === "Bearer agents-api-key"),
    ).toBe(true);
    expect(eventBodies[0]).toMatchObject({
      events: [
        {
          type: "agent.session.input.message",
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: "介绍项目" }],
            },
          ],
        },
      ],
    });
    expect(toolEvents).toContain("start:query_kb");
    expect(toolEvents).toContain("result");
  });

  it("resumes a Yuxi Public API waitpoint with a structured answer", async () => {
    const eventBodies: Array<Record<string, unknown>> = [];
    let streamCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/api/v1/agents/sessions") &&
          init?.method === "POST"
        )
          return json({ id: "session-resume" }, 201);
        if (url.endsWith("/api/v1/agents/sessions/session-resume/events")) {
          if (init?.method === "POST") {
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            eventBodies.push(body);
            return json({ session_id: "session-resume", status: "accepted" }, 202);
          }
          streamCount += 1;
          if (streamCount === 1) {
            return sse(
              sseFrame("cursor-wait", "yuxi.session.turn.waiting", {
                type: "yuxi.session.turn.waiting",
                turn: { id: "turn-wait" },
                waitpoint: {
                  id: "wait-1",
                  kind: "answer",
                  questions: [
                    {
                      question_id: "q1",
                      options: [
                        { label: "直接检索 (Recommended)", value: "search" },
                      ],
                    },
                  ],
                },
              }),
            );
          }
          return sse(
            sseFrame("cursor-call", "agent.session.turn.item.added", {
              type: "agent.session.turn.item.added",
              turn_id: "turn-wait",
              item: {
                type: "function_call",
                call_id: "kb-wait",
                name: "query_kb",
                arguments: { query: "介绍项目" },
                status: "in_progress",
              },
            }),
            sseFrame("cursor-tool-output", "agent.session.turn.item.done", {
              type: "agent.session.turn.item.done",
              turn_id: "turn-wait",
              item: {
                type: "function_call_output",
                call_id: "kb-wait",
                output: [{ title: "项目概况" }],
                status: "completed",
              },
            }),
            sseFrame("cursor-answer", "agent.session.turn.output_text.delta", {
              type: "agent.session.turn.output_text.delta",
              turn_id: "turn-wait",
              delta: "ok",
            }),
            sseFrame("cursor-complete", "agent.session.turn.completed", {
              type: "agent.session.turn.completed",
              turn_id: "turn-wait",
              turn: { id: "turn-wait", status: "completed" },
            }),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      agentApiKey: "agents-api-key",
    });
    const evidence = await provider.search({
      query: "介绍项目",
      projectId: "ydjm",
      sessionId: "session-resume",
    });

    expect(evidence[0]?.content).toBe("ok");
    expect(eventBodies).toHaveLength(2);
    expect(eventBodies[1]).toMatchObject({
      events: [
        {
          type: "yuxi.session.input.resume",
          turn_id: "turn-wait",
          waitpoint_id: "wait-1",
          response: {
            type: "answer",
            answers: [{ question_id: "q1", answer: "search" }],
          },
        },
      ],
    });
  });

  it("reuses Yuxi sessions per Spotlight session and prefers service login over a Knowledge-only key", async () => {
    const createdSessions: string[] = [];
    const postedSessionIds: string[] = [];
    const streamHeaders: Array<{ sessionId: string; lastEventId: string | null }> = [];
    let streamNumber = 0;
    const authHeaders: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        authHeaders.push(headers.get("Authorization") ?? "");
        if (url.endsWith("/api/auth/token"))
          return json({ access_token: "service-user-token" });
        if (url.endsWith("/api/v1/agents/sessions") && init?.method === "POST") {
          const id = `yuxi-session-${createdSessions.length + 1}`;
          createdSessions.push(id);
          return json({ id }, 201);
        }
        const match = url.match(/\/api\/v1\/agents\/sessions\/([^/]+)\/events$/u);
        if (match) {
          const sessionId = decodeURIComponent(match[1]!);
          if (init?.method === "POST") {
            postedSessionIds.push(sessionId);
            return json({ session_id: sessionId, status: "accepted" }, 202);
          }
          streamNumber += 1;
          streamHeaders.push({
            sessionId,
            lastEventId: headers.get("Last-Event-ID"),
          });
          return sse(
            sseFrame(`call-${streamNumber}`, "agent.session.turn.item.added", {
              type: "agent.session.turn.item.added",
              turn_id: `turn-${streamNumber}`,
              item: {
                type: "function_call",
                call_id: `kb-${streamNumber}`,
                name: "query_kb",
                arguments: { query: "介绍项目" },
                status: "in_progress",
              },
            }),
            sseFrame(`tool-${streamNumber}`, "agent.session.turn.item.done", {
              type: "agent.session.turn.item.done",
              turn_id: `turn-${streamNumber}`,
              item: {
                type: "function_call_output",
                call_id: `kb-${streamNumber}`,
                output: [{ title: "项目概况" }],
                status: "completed",
              },
            }),
            sseFrame(`cursor-${streamNumber}`, "agent.session.turn.output_text.delta", {
              type: "agent.session.turn.output_text.delta",
              delta: "ok",
            }),
            sseFrame(`done-${streamNumber}`, "agent.session.turn.completed", {
              type: "agent.session.turn.completed",
              turn_id: `turn-${streamNumber}`,
              turn: { id: `turn-${streamNumber}`, status: "completed" },
            }),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "knowledge-only-key",
      username: "spotlight-service",
      password: "service-password",
    });
    const search = (sessionId: string) =>
      provider.search({ query: "介绍项目", projectId: "ydjm", sessionId });
    await search("spotlight-a");
    await search("spotlight-a");
    await search("spotlight-b");

    expect(createdSessions).toEqual(["yuxi-session-1", "yuxi-session-2"]);
    expect(postedSessionIds).toEqual([
      "yuxi-session-1",
      "yuxi-session-1",
      "yuxi-session-2",
    ]);
    expect(streamHeaders).toEqual([
      { sessionId: "yuxi-session-1", lastEventId: null },
      { sessionId: "yuxi-session-1", lastEventId: "done-1" },
      { sessionId: "yuxi-session-2", lastEventId: null },
    ]);
    expect(authHeaders.filter(Boolean).every((value) => value === "Bearer service-user-token")).toBe(
      true,
    );
  });

  it("does not return ungrounded Yuxi Agent text as knowledge evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/v1/agents/sessions") && init?.method === "POST")
          return json({ id: "session-no-kb-tool" }, 201);
        if (url.endsWith("/api/v1/agents/sessions/session-no-kb-tool/events")) {
          if (init?.method === "POST") return json({ status: "accepted" }, 202);
          return sse(
            sseFrame("cursor-answer", "agent.session.turn.output_text.delta", {
              type: "agent.session.turn.output_text.delta",
              turn_id: "turn-no-kb-tool",
              delta: "Unverified answer",
            }),
            sseFrame("cursor-complete", "agent.session.turn.completed", {
              type: "agent.session.turn.completed",
              turn_id: "turn-no-kb-tool",
              turn: { id: "turn-no-kb-tool", status: "completed" },
            }),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      agentApiKey: "agents-api-key",
    });

    await expect(
      provider.search({
        query: "内部流程是什么？",
        projectId: "ydjm",
        sessionId: "session-no-kb-tool",
      }),
    ).rejects.toThrow(
      "Yuxi Agent completed without successfully querying a knowledge-base retrieval tool",
    );
  });

  it("explains when a Knowledge-only key cannot call the Agents Public API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ detail: "API key lacks access" }, 403)),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "knowledge-only-key",
    });

    await expect(
      provider.search({
        query: "项目在哪个区？",
        projectId: "ydjm",
        sessionId: "session-agent-forbidden",
      }),
    ).rejects.toThrow(
      "Yuxi Agents Public API failed: 403. Use Yuxi service-account credentials",
    );
  });

  it("includes the failing Agent API route and safe server error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            detail: {
              code: "chat_model_not_found",
              message: "No configured chat model is available",
            },
          },
          422,
        ),
      ),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      agentApiKey: "agents-api-key",
    });

    await expect(
      provider.search({
        query: "项目在哪个区？",
        projectId: "ydjm",
        sessionId: "session-model-missing",
      }),
    ).rejects.toThrow(
      "Yuxi Agents Public API failed on /api/v1/agents/sessions: 422 (chat_model_not_found: No configured chat model is available)",
    );
  });

  it("aborts a stalled upstream request at the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const rejectOnAbort = () =>
              reject(
                init?.signal?.reason ??
                  new DOMException("Aborted", "AbortError"),
              );
            if (init?.signal?.aborted) rejectOnAbort();
            else init?.signal?.addEventListener("abort", rejectOnAbort);
          }),
      ),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "test",
      timeoutMs: 10,
    });
    const pending = provider.search({
      query: "介绍项目",
      projectId: "ydjm",
      sessionId: "session-timeout",
    });
    await expect(pending).rejects.toThrow("Yuxi request timed out after 10ms");
  });
});
