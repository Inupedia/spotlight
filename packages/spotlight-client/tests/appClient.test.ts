import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpotlightAppClient } from "../src/appClient.js";

const manifest = {
  protocolVersion: "spotlight.capabilities/1" as const,
  projectId: "demo",
  frontendBuildId: "sha",
  manifestDigest: "digest",
  tools: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("SpotlightAppClient", () => {
  it("initializes once, starts a Thread/Turn, and streams typed Items", async () => {
    const encoder = new TextEncoder();
    const events = [
      {
        type: "turn.started",
        at: 1,
        seq: 1,
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", threadId: "thread-1", status: "in_progress", startedAt: 1 },
      },
      {
        type: "turn.completed",
        at: 2,
        seq: 2,
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", threadId: "thread-1", status: "completed", startedAt: 1 },
        finalResponse: "完成",
        summary: { items: 0, toolCalls: 0, hostDispatches: 0, hostRedispatches: 0, elapsedMs: 1 },
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        protocolVersion: "spotlight.app/1",
        serverInfo: { name: "@inupedia/spotlight-server", version: "1", runtime: "langchain-langgraph" },
        projectId: "demo",
        acceptedManifestDigest: "digest",
        capabilitySession: {
          id: "capability-1",
          projectId: "demo",
          manifestDigest: "digest",
          createdAt: 1,
          expiresAt: 2,
        },
        capabilities: { transports: ["sse"], cancellation: true, threadResume: true, eventReplay: true },
        tools: [],
        skills: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        thread: { id: "thread-1", projectId: "demo", status: "idle", createdAt: 1 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        turn: { id: "turn-1", threadId: "thread-1", status: "in_progress", startedAt: 1 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSpotlightAppClient({
      serverUrl: "http://spotlight.test",
      projectId: "demo",
      toolManifest: manifest,
    });
    const thread = await client.startThread("thread-1");
    const turn = await client.startTurn(thread.id, { projectId: "demo", input: "你好" });
    const seen = [];
    for await (const event of client.streamTurn(turn.id)) seen.push(event.type);

    expect(seen).toEqual(["turn.started", "turn.completed"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://spotlight.test/v1/initialize");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      capabilitySessionId: "capability-1",
      input: "你好",
    });
  });
});
