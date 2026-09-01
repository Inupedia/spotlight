import { describe, expect, it } from "vitest";
import {
  TTS_CLIP_SILENCE_MS,
  ttsSilenceSampleCount,
} from "../src/avatar/speech/live2dTtsPlayback.js";

describe("tts pcm playback padding", () => {
  it("adds a short silence tail so the next clip does not slam in", () => {
    expect(TTS_CLIP_SILENCE_MS).toBeGreaterThanOrEqual(120);
    expect(ttsSilenceSampleCount(16000, 160)).toBe(2560);
    expect(ttsSilenceSampleCount(24000, 0)).toBe(0);
  });
});
