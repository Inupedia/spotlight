import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = process.cwd().endsWith("packages/spotlight-vue")
  ? process.cwd()
  : resolve(process.cwd(), "packages/spotlight-vue");
const shell = readFileSync(
  resolve(packageRoot, "src/components/SpotlightShell.vue"),
  "utf8",
);
const panel = readFileSync(
  resolve(packageRoot, "src/components/Live2dPanel.vue"),
  "utf8",
);

describe("Little Drop voice UI contract", () => {
  it("keeps a reopen control wired to the avatar greeting path", () => {
    expect(shell).toContain('class="spotlight-avatar-reopen"');
    expect(shell).toContain('@click="showLive2dAvatar"');
    expect(shell).toContain("void playLive2dGreetingWhenOpened()");
  });

  it("rotates only the microphone outer ring while transcribing", () => {
    expect(panel).toContain('class="live2d-voice-ring"');
    expect(panel).toMatch(
      /\.live2d-voice-button\.is-transcribing \.live2d-voice-ring\s*\{[^}]*animation:\s*voice-ring-spin/u,
    );
    expect(panel).not.toMatch(
      /\.live2d-voice-button\.is-transcribing\s*\{[^}]*animation:/u,
    );
  });

  it("marks avatar submissions as voice turns and consumes streamed sentences", () => {
    expect(shell).toContain('interactionMode: "voice"');
    expect(shell).toContain("onVoiceSentence: enqueueVoiceSentence");
    expect(shell).toContain("await finishVoiceResponseStream()");
    expect(shell).toContain("enqueueFallbackReply");
    expect(shell).toContain("queuedVoiceSentences === 0");
    expect(shell).toContain("packSpokenSentences");
    expect(shell).toContain("drainSpokenClips");
    expect(shell).toContain("sanitizeSpokenText");
    expect(shell).toContain("VoiceTurnController");
    expect(shell).toContain("startLive2dVoiceRecording");
    expect(shell).toContain("stopAndTranscribe");
    expect(panel).toContain("点击说话");
    expect(panel).toContain("点击发送");
    expect(panel).not.toContain("正在听");
    expect(shell).toContain("playTtsAudioBuffer");
    expect(shell).toContain("decodeTtsAudioFromBlob");
    expect(shell).toContain("stopTtsBufferPlayback");
    expect(shell).not.toContain("new Audio(");
    expect(shell).not.toContain("waitForAudioNaturalEnd");
    expect(shell).not.toContain("livekit");
    expect(shell).not.toContain("LiveKit");
  });
});
