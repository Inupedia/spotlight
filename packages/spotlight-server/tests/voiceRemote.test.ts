import { extractTranscriptionText } from "../src/audio.js";
import type { RunManager } from "../src/runManager.js";
import { buildServer } from "../src/server.js";
import {
  VoiceRemoteRegistry,
  isVoiceRemotePublicPath,
} from "../src/voiceRemote.js";

describe("voice remote pairing", () => {
  it("creates a token, accepts an utterance, and lets the desktop drain it once", () => {
    const registry = new VoiceRemoteRegistry();
    const created = registry.create("ydjm-construction-map", 1_000);
    expect(created.token.length).toBeGreaterThan(16);
    expect(registry.publicView(created.token, 1_000)?.phoneConnected).toBe(false);

    const queued = registry.enqueue(created.token, "  打开建设程序。  ", 2_000);
    expect(queued?.text).toBe("打开建设程序。");
    expect(registry.publicView(created.token, 2_000)?.phoneConnected).toBe(true);

    const first = registry.takePending(created.token, 3_000);
    expect(first.map((item) => item.text)).toEqual(["打开建设程序。"]);
    expect(registry.takePending(created.token, 4_000)).toEqual([]);
  });

  it("expires stale tokens", () => {
    const registry = new VoiceRemoteRegistry();
    const created = registry.create("ydjm-construction-map", 1_000);
    expect(registry.get(created.token, created.expiresAt + 1)).toBeNull();
  });

  it("treats token routes as public except session creation", () => {
    expect(isVoiceRemotePublicPath("/v1/voice-remote/sessions")).toBe(false);
    expect(isVoiceRemotePublicPath("/v1/voice-remote/sessions/abc")).toBe(true);
    expect(
      isVoiceRemotePublicPath("/v1/voice-remote/sessions/abc/utterance"),
    ).toBe(true);
    expect(
      isVoiceRemotePublicPath("/v1/voice-remote/sessions/abc/pending"),
    ).toBe(true);
  });

  it("reads STT text from adapter payloads", () => {
    expect(extractTranscriptionText({ text: "打开建设程序。" })).toBe(
      "打开建设程序。",
    );
  });

  it("lets a phone submit text without an API key after the desktop pairs", async () => {
    const app = await buildServer({
      runManager: {} as RunManager,
      projectId: "ydjm-construction-map",
      apiKeys: ["desktop-key"],
    });
    try {
      const unauthorized = await app.inject({
        method: "POST",
        url: "/v1/voice-remote/sessions",
        payload: {},
      });
      expect(unauthorized.statusCode).toBe(401);

      const created = await app.inject({
        method: "POST",
        url: "/v1/voice-remote/sessions",
        headers: { "x-spotlight-api-key": "desktop-key" },
        payload: {},
      });
      expect(created.statusCode).toBe(200);
      const token = created.json().token as string;

      const spoken = await app.inject({
        method: "POST",
        url: `/v1/voice-remote/sessions/${token}/utterance`,
        payload: { text: "打开建设程序。" },
      });
      expect(spoken.statusCode).toBe(200);
      expect(spoken.json()).toMatchObject({ text: "打开建设程序。" });

      const pending = await app.inject({
        method: "GET",
        url: `/v1/voice-remote/sessions/${token}/pending`,
      });
      expect(pending.statusCode).toBe(200);
      expect(pending.json().utterances).toEqual([
        expect.objectContaining({ text: "打开建设程序。" }),
      ]);
    } finally {
      await app.close();
    }
  });
});
