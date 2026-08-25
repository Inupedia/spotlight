import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { FakeToolCallingModel } from "langchain";
import type {
  FrontendToolDescriptorV1,
  HostToolResultRequest,
} from "@inupedia/spotlight-protocol";
import { RunManager } from "../src/runManager.js";
import type { SpotlightServerRunEvent } from "../src/runManager.js";
import { buildServer } from "../src/server.js";
import type { IntentDecision, IntentRouter, ProjectPack } from "../src/index.js";

const openVideo: FrontendToolDescriptorV1 = {
  name: "panel.playVideoMonitoringFullscreenByName",
  version: "1.0.0",
  description: "按名称打开视频监控",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  sideEffect: "ui",
  replayPolicy: "never",
  riskLevel: "low",
};

const knowledgeDecision: IntentDecision = {
  route: "knowledge",
  confidence: 1,
  reason: "test",
  requestedToolNames: [],
  explicitActionEvidence: null,
  matchedSkillNames: [],
};

const actionDecision: IntentDecision = {
  route: "action",
  confidence: 1,
  reason: "test",
  requestedToolNames: [openVideo.name],
  requestedToolInput: { name: "1号洞口" },
  explicitActionEvidence: "打开",
  matchedSkillNames: ["skill.monitoring"],
};

function router(decision: IntentDecision): IntentRouter {
  return { async route() { return decision; } };
}

function pack(): ProjectPack {
  return { projectId: "test-project", serverTools: [] };
}

function manager(decision: IntentDecision): RunManager {
  return new RunManager({
    project: pack(),
    model: new FakeToolCallingModel({}),
    router: router(decision),
    checkpointer: new MemorySaver(),
    store: new InMemoryStore(),
    hostActionTimeoutMs: 30_000,
    hostActionMaxWaitMs: 60_000,
  });
}

function runRequest(question: string) {
  return {
    projectId: "test-project",
    sessionId: "session-a",
    userQuestion: question,
    uiContext: { route: "/tunnel", selectedTunnelId: 7 },
    skills: [
      {
        name: "skill.monitoring",
        description: "视频监控",
        allowedTools: [openVideo.name],
      },
    ],
    clientToolManifest: {
      protocolVersion: "spotlight.capabilities/1" as const,
      projectId: "test-project",
      frontendBuildId: "test",
      manifestDigest: "test-digest",
      tools: [openVideo],
    },
  };
}

function waitFor(
  predicate: () => boolean,
  timeoutMs = 4_000,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error("timed out waiting for run state"));
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("run lifecycle across connections", () => {
  it("numbers every event so a reader can resume from a cursor", async () => {
    const runs = manager(knowledgeDecision);
    const run = runs.createRun(runRequest("水库的库容是多少"));
    const seen: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => seen.push(event));
    await waitFor(() => seen.some((event) => event.type === "run_completed"));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.map((event) => event.seq)).toEqual(
      seen.map((_, index) => index + 1),
    );
    expect(runs.cancelRun(run.id)).toBe(false);
  });

  it("resumes a reconnecting reader from its cursor instead of replaying the turn", async () => {
    const runs = manager(knowledgeDecision);
    const run = runs.createRun(runRequest("水库的库容是多少"));
    const full: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => full.push(event));
    await waitFor(() => full.some((event) => event.type === "run_completed"));

    // A reader that already saw event 1 gets everything after it, exactly once.
    const resumed: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => resumed.push(event), 1);

    expect(full.length).toBeGreaterThan(1);
    expect(resumed).toHaveLength(full.length - 1);
    expect(resumed.every((event) => event.seq > 1)).toBe(true);
    expect(resumed.at(-1)?.type).toBe("run_completed");
  });

  it("keeps a run alive when the browser disconnects mid host call", async () => {
    const runs = manager(actionDecision);
    const run = runs.createRun(runRequest("打开1号洞口的视频监控"));
    const first: SpotlightServerRunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => first.push(event));
    await waitFor(() =>
      first.some((event) => event.type === "host_action_request"),
    );
    const dispatched = first.find(
      (event) => event.type === "host_action_request",
    ) as Extract<SpotlightServerRunEvent, { type: "host_action_request" }>;

    unsubscribe?.();
    expect(runs.getRun(run.id)?.status).toBe("waiting_for_host");

    // A fresh connection resuming from the cursor must still be told to run the
    // call, otherwise the run would wait forever for a result nobody produces.
    const resumed: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => resumed.push(event), dispatched.seq);
    const redispatch = resumed.find(
      (event) => event.type === "host_action_request",
    ) as Extract<SpotlightServerRunEvent, { type: "host_action_request" }>;

    expect(redispatch).toBeDefined();
    expect(redispatch.request.correlationId).toBe(
      dispatched.request.correlationId,
    );
    expect(redispatch.request.dispatch).toBe(2);
    expect(runs.getRun(run.id)?.status).toBe("running");

    const result: HostToolResultRequest = {
      correlationId: dispatched.request.correlationId,
      success: true,
      output: { opened: "1号洞口" },
      uiContext: { route: "/tunnel", activeVideoChannel: "1号洞口" },
    };
    expect(runs.completeHostAction(run.id, result)).toBe(true);
    await waitFor(() =>
      resumed.some((event) => event.type === "run_completed"),
    );
  });

  it("does not replay an outstanding host call twice to one reader", async () => {
    const runs = manager(actionDecision);
    const run = runs.createRun(runRequest("打开1号洞口的视频监控"));
    const seen: SpotlightServerRunEvent[] = [];
    const unsubscribe = runs.subscribe(run.id, (event) => seen.push(event));
    await waitFor(() =>
      seen.some((event) => event.type === "host_action_request"),
    );
    unsubscribe?.();

    const replayed: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => replayed.push(event), 0);
    const requests = replayed.filter(
      (event) => event.type === "host_action_request",
    );

    expect(requests).toHaveLength(1);
  });

  it("refreshes the observation from the host result", async () => {
    const runs = manager(actionDecision);
    const run = runs.createRun(runRequest("打开1号洞口的视频监控"));
    const seen: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => seen.push(event));
    await waitFor(() =>
      seen.some((event) => event.type === "host_action_request"),
    );
    const dispatched = seen.find(
      (event) => event.type === "host_action_request",
    ) as Extract<SpotlightServerRunEvent, { type: "host_action_request" }>;

    expect(runs.getRun(run.id)?.observed).toMatchObject({
      selectedTunnelId: 7,
    });
    runs.completeHostAction(run.id, {
      correlationId: dispatched.request.correlationId,
      success: true,
      output: {},
      uiContext: { route: "/tunnel", activeVideoChannel: "1号洞口" },
    });
    expect(runs.getRun(run.id)?.observed).toEqual({
      route: "/tunnel",
      activeVideoChannel: "1号洞口",
    });
  });

  it("reports a real step count rather than a constant", async () => {
    const runs = manager(actionDecision);
    const run = runs.createRun(runRequest("打开1号洞口的视频监控"));
    const seen: SpotlightServerRunEvent[] = [];
    runs.subscribe(run.id, (event) => seen.push(event));
    await waitFor(() => seen.some((event) => event.type === "tool_start"));
    const dispatched = seen.find(
      (event) => event.type === "host_action_request",
    ) as Extract<SpotlightServerRunEvent, { type: "host_action_request" }>;
    runs.completeHostAction(run.id, {
      correlationId: dispatched.request.correlationId,
      success: true,
      output: {},
    });
    await waitFor(() => seen.some((event) => event.type === "run_completed"));
    const completed = seen.find(
      (event) => event.type === "run_completed",
    ) as Extract<SpotlightServerRunEvent, { type: "run_completed" }>;

    expect(completed.summary.toolCalls).toBeGreaterThan(0);
    expect(completed.summary.steps).toBe(completed.summary.toolCalls);
    expect(completed.summary.hostDispatches).toBeGreaterThan(0);
  });
});

describe("Thread / Turn / Item lifecycle API", () => {
  it("runs a browser Tool and exposes structured Skill and Tool items", async () => {
    const runs = manager(actionDecision);
    const app = await buildServer({ runManager: runs, projectId: "test-project" });
    try {
      const threadResponse = await app.inject({
        method: "POST",
        url: "/v1/threads",
        payload: { projectId: "test-project", threadId: "thread-e2e" },
      });
      expect(threadResponse.statusCode).toBe(200);

      const { userQuestion: _userQuestion, ...request } = runRequest(
        "打开1号洞口的视频监控",
      );
      const turnResponse = await app.inject({
        method: "POST",
        url: "/v1/threads/thread-e2e/turns",
        payload: { ...request, input: "打开1号洞口的视频监控" },
      });
      expect(turnResponse.statusCode).toBe(200);
      const turnId = turnResponse.json().turn.id as string;

      let actionRequest: Extract<
        SpotlightServerRunEvent,
        { type: "host_action_request" }
      > | undefined;
      const events: SpotlightServerRunEvent[] = [];
      runs.subscribe(turnId, (event) => {
        events.push(event);
        if (event.type === "host_action_request") actionRequest = event;
      });
      await waitFor(() => actionRequest !== undefined);

      const toolResult = await app.inject({
        method: "POST",
        url: `/v1/turns/${turnId}/tool-results`,
        payload: {
          correlationId: actionRequest!.request.correlationId,
          success: true,
          output: { opened: "1号洞口" },
          uiContext: { route: "/tunnel", activeVideoChannel: "1号洞口" },
        },
      });
      expect(toolResult.statusCode).toBe(200);
      await waitFor(() => events.some((event) => event.type === "run_completed"));

      const stream = await app.inject({
        method: "GET",
        url: `/v1/turns/${turnId}/events`,
      });
      expect(stream.statusCode).toBe(200);
      const lifecycleEvents = stream.body
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
      const items = lifecycleEvents
        .filter((event) => event.type === "item.completed")
        .map((event) => event.item as Record<string, unknown>);

      expect(lifecycleEvents[0]).toMatchObject({
        type: "turn.started",
        threadId: "thread-e2e",
        turnId,
      });
      expect(items).toContainEqual(expect.objectContaining({
        type: "skill_use",
        skill: "skill.monitoring",
      }));
      expect(items).toContainEqual(expect.objectContaining({
        type: "tool_call",
        tool: openVideo.name,
        status: "completed",
      }));
      expect(lifecycleEvents.at(-1)).toMatchObject({
        type: "turn.completed",
        turn: { id: turnId, threadId: "thread-e2e", status: "completed" },
      });
    } finally {
      await app.close();
    }
  });
});

describe("capability tier gate", () => {
  it("rejects a manifest the runtime could not safely re-dispatch", async () => {
    const runs = manager(actionDecision);
    const app = await buildServer({ runManager: runs, projectId: "test-project" });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/runs",
        payload: {
          ...runRequest("提交采购单"),
          clientToolManifest: {
            protocolVersion: "spotlight.capabilities/1",
            projectId: "test-project",
            frontendBuildId: "test",
            manifestDigest: "test-digest",
            tools: [{ ...openVideo, sideEffect: "external" }],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("TOOL_TIER_UNSUPPORTED");
    } finally {
      await app.close();
    }
  });

  it("answers 404 for a run that never existed", async () => {
    const runs = manager(actionDecision);
    const app = await buildServer({ runManager: runs, projectId: "test-project" });
    try {
      const missing = await app.inject({
        method: "GET",
        url: `/v1/runs/${crypto.randomUUID()}/events`,
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("answers 410 for a run that aged out, so the client stops retrying", async () => {
    const retired = new RunManager({
      project: pack(),
      model: new FakeToolCallingModel({}),
      router: router(knowledgeDecision),
      checkpointer: new MemorySaver(),
      store: new InMemoryStore(),
      runTtlMs: 1,
    });
    const run = retired.createRun(runRequest("水库的库容是多少"));
    await waitFor(() => retired.isExpired(run.id));
    const app = await buildServer({
      runManager: retired,
      projectId: "test-project",
    });
    try {
      const gone = await app.inject({
        method: "GET",
        url: `/v1/runs/${run.id}/events`,
      });
      expect(gone.statusCode).toBe(410);
    } finally {
      await app.close();
    }
  });
});
