import { describe, expect, it } from "vitest";
import { VoiceTurnController } from "@inupedia/spotlight-protocol";

describe("Vue VoiceTurnController abort", () => {
  it("cancels pipeline and TTS together", async () => {
    const controller = new VoiceTurnController();
    const calls: string[] = [];
    controller.onAbort(async (reason) => {
      calls.push(`pipeline:${reason}`);
    });
    controller.onAbort(() => {
      calls.push("tts");
    });
    controller.setPhase("speaking");
    await controller.abort("escape");
    expect(controller.phase).toBe("interrupted");
    expect(calls).toEqual(["pipeline:escape", "tts"]);
  });
});

describe("panel hide during text submit", () => {
  it("does not treat thinking-bar takeover as a user cancel", async () => {
    const { shouldAbortVoiceOnPanelHide } = await import(
      "../src/avatar/voice/panelHidePolicy.js"
    );
    expect(
      shouldAbortVoiceOnPanelHide({ loading: true, pipelinePhase: "running" }),
    ).toBe(false);
    expect(
      shouldAbortVoiceOnPanelHide({ loading: false, pipelinePhase: "idle" }),
    ).toBe(true);
  });
});
