import { afterEach, describe, expect, it, vi } from "vitest";
import { YuxiKnowledgeProvider } from "../src/index.js";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Yuxi knowledge provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("auto-resumes ask_user_question interrupts instead of failing the knowledge search", async () => {
    const runBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/agent/default"))
          return json({ agent: { slug: "ydjm" } });
        if (url.endsWith("/api/chat/thread")) return json({ id: "thread-1" });
        if (url.endsWith("/api/agent/runs")) {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          runBodies.push(body);
          const runId = body.resume ? "run-resume" : "run-1";
          return json({ run_id: runId, stream_url: `/stream/${runId}` });
        }
        if (url.endsWith("/stream/run-1")) {
          return new Response(
            [
              'data: {"payload":{"items":[{"stream_event":{"type":"tool_call","name":"ask_user_question","tool_call_id":"q-1","args":{"questions":[{"question_id":"q1"}]}}}]}}',
              "",
              'event: interrupt\ndata: {"payload":{"reason":"ask_user_question_required","chunk":{"status":"ask_user_question_required","questions":[{"question_id":"q1","options":[{"label":"直接检索 (Recommended)","value":"search"}]}]}}}',
              "",
              'event: end\ndata: {"payload":{"status":"interrupted"}}',
              "",
            ].join("\n"),
          );
        }
        if (url.endsWith("/stream/run-resume")) {
          return new Response(
            [
              'data: {"payload":{"items":[{"stream_event":{"type":"tool_call","name":"query_kb","tool_call_id":"tc-1","args":{"query":"介绍项目"}}}]}}',
              "",
              'data: {"payload":{"items":[{"msg":{"type":"tool","name":"query_kb","tool_call_id":"tc-1","content":[{"title":"概况"}]}}]}}',
              "",
              'data: {"payload":{"items":[{"stream_event":{"type":"message_delta","content":"ok"}}]}}',
              "",
              'event: end\ndata: {"payload":{"status":"completed"}}',
              "",
            ].join("\n"),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "test",
    });
    const evidence = await provider.search({
      query: "介绍项目",
      projectId: "ydjm",
      sessionId: "session-a",
    });

    expect(evidence[0]?.content).toBe("ok");
    expect(runBodies[0]).toMatchObject({
      query: "介绍项目",
      tool_approval_mode: "always_trust",
    });
    expect(runBodies[1]).toMatchObject({
      created_by_run_id: "run-1",
      resume: { q1: "search" },
      tool_approval_mode: "always_trust",
    });
  });

  it("reuses a thread within one Spotlight session and isolates different sessions", async () => {
    const createdThreads: Array<{ id: string; sessionId: string }> = [];
    const runThreadIds: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/agent/default"))
          return json({ agent: { slug: "ydjm" } });
        if (url.endsWith("/api/chat/thread")) {
          const body = JSON.parse(String(init?.body)) as {
            metadata: { spotlight_session_id: string };
          };
          const id = `thread-${createdThreads.length + 1}`;
          createdThreads.push({
            id,
            sessionId: body.metadata.spotlight_session_id,
          });
          return json({ id });
        }
        if (url.endsWith("/api/agent/runs")) {
          const body = JSON.parse(String(init?.body)) as { thread_id: string };
          runThreadIds.push(body.thread_id);
          return json({
            run_id: `run-${runThreadIds.length}`,
            stream_url: `/stream/${runThreadIds.length}`,
          });
        }
        if (url.includes("/stream/")) {
          return new Response(
            [
              'data: {"payload":{"items":[{"stream_event":{"type":"tool_call","name":"query_kb","tool_call_id":"tc-1","args":{"query":"介绍项目"}}}]}}',
              "",
              'data: {"payload":{"items":[{"msg":{"type":"tool","name":"query_kb","tool_call_id":"tc-1","content":[{"title":"概况"}]}}]}}',
              "",
              'data: {"payload":{"items":[{"stream_event":{"type":"message_delta","content":"ok"}}]}}',
              "",
              'event: end\ndata: {"payload":{"status":"completed"}}',
              "",
            ].join("\n"),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "test",
    });
    const toolNames: string[] = [];
    const query = (sessionId: string) =>
      provider.search({
        query: "介绍项目",
        projectId: "ydjm",
        sessionId,
        onToolEvent: (event) => {
          if (event.type === "start") toolNames.push(event.call.name);
        },
      });
    await query("session-a");
    await query("session-a");
    await query("session-b");

    expect(createdThreads).toEqual([
      { id: "thread-1", sessionId: "session-a" },
      { id: "thread-2", sessionId: "session-b" },
    ]);
    expect(runThreadIds).toEqual(["thread-1", "thread-1", "thread-2"]);
    expect(toolNames).toEqual(["query_kb", "query_kb", "query_kb"]);
  });

  it("aborts a stalled upstream request at the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(
                init.signal?.reason ??
                  new DOMException("Aborted", "AbortError"),
              ),
            );
          }),
      ),
    );

    const provider = new YuxiKnowledgeProvider({
      baseUrl: "http://yuxi.test",
      apiKey: "test",
      timeoutMs: 50,
    });
    const pending = provider.search({
      query: "介绍项目",
      projectId: "ydjm",
      sessionId: "session-timeout",
    });
    const assertion = expect(pending).rejects.toThrow(
      "Yuxi request timed out after 50ms",
    );

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    vi.useRealTimers();
  });
});
