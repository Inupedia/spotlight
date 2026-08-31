import {
  SPOTLIGHT_APP_PROTOCOL_V1,
  defaultSpotlightClientCapabilities,
  type SpotlightInitializeRequest,
  type SpotlightTurnEvent,
} from "../src/index.js";

describe("Spotlight application lifecycle protocol", () => {
  it("advertises the complete stable Item catalog", () => {
    expect(defaultSpotlightClientCapabilities()).toEqual({
      transports: ["sse"],
      itemTypes: [
        "reasoning",
        "skill_use",
        "tool_call",
        "knowledge_search",
        "memory",
        "agent_message",
        "voice_sentence",
        "error",
      ],
      toolResultSubmission: true,
      reconnectFromSequence: true,
    });
  });

  it("binds initialization to a build-pinned manifest", () => {
    const request: SpotlightInitializeRequest = {
      protocolVersion: SPOTLIGHT_APP_PROTOCOL_V1,
      projectId: "demo",
      clientInfo: { name: "test", version: "1" },
      capabilities: defaultSpotlightClientCapabilities(),
      toolManifest: {
        protocolVersion: "spotlight.capabilities/1",
        projectId: "demo",
        frontendBuildId: "sha",
        manifestDigest: "digest",
        tools: [],
      },
    };
    expect(request.toolManifest.frontendBuildId).toBe("sha");
  });

  it("uses one envelope for every intermediate and terminal event", () => {
    const event: SpotlightTurnEvent = {
      type: "item.completed",
      at: 1,
      seq: 2,
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "skill-1",
        type: "skill_use",
        skill: "video-monitoring",
        displayName: "视频监控",
        source: "router",
        status: "completed",
        startedAt: 1,
        completedAt: 1,
      },
    };
    expect(event.type).toBe("item.completed");
    expect(event.item.type).toBe("skill_use");
  });
});
