import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SpotlightDurableState } from "../src/durableState.js";

describe("SpotlightDurableState", () => {
  it("restores capability snapshots, Threads and completed Turns", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "spotlight-state-"));
    const first = new SpotlightDurableState(stateDir);
    const capability = first.createCapability({
      projectId: "demo",
      manifest: {
        protocolVersion: "spotlight.capabilities/1",
        projectId: "demo",
        frontendBuildId: "sha",
        manifestDigest: "digest",
        tools: [],
      },
      registrations: [],
      skills: [],
    });
    first.createThread("demo", "thread-1");
    first.startTurn({
      id: "turn-1",
      threadId: "thread-1",
      request: { projectId: "demo", userQuestion: "hello" },
      startedAt: 1,
      status: "in_progress",
      events: [],
    });
    first.appendTurnEvent("turn-1", { type: "assistant_response", content: "ok" });
    first.finishTurn("turn-1", "completed", "ok");

    const restored = new SpotlightDurableState(stateDir);
    expect(restored.getCapability(capability.id)?.manifestDigest).toBe("digest");
    expect(restored.getThread("thread-1")?.status).toBe("idle");
    expect(restored.getTurn("turn-1")).toMatchObject({
      status: "completed",
      finalResponse: "ok",
      events: [{ type: "assistant_response", content: "ok" }],
    });
    expect(JSON.parse(readFileSync(join(stateDir, "spotlight-state.json"), "utf8"))).toBeTruthy();
  });
});
