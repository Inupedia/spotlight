import { afterEach, describe, expect, it, vi } from "vitest";
import { SpotlightAudioError } from "../src/audioCore.js";
import {
  audioBytesFromVolcengineEvents,
  createVolcengineTts,
  parseVolcengineNdjson,
  volcengineResourceId,
  volcengineSpeechRate,
  volcengineTtsUrl,
} from "../src/voice/volcengineTts.js";
import type { VoiceAudioConfig } from "../src/voice/types.js";

const config: VoiceAudioConfig = {
  kind: "volcengine",
  apiKey: "volc-key",
  baseUrl: "https://openspeech.bytedance.com",
  sttModel: "",
  ttsModel: "seed-tts-2.0",
  ttsVoice: "zh_female_peiqi_uranus_bigtts",
  ttsResponseFormat: "mp3",
  ttsStream: false,
  ttsSpeed: 1,
  ttsGain: 0,
  sttTimeoutMs: 30_000,
  ttsTimeoutMs: 45_000,
};

describe("volcengine TTS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes official 2.0 voices to seed-tts-2.0", () => {
    expect(volcengineResourceId("zh_female_peiqi_uranus_bigtts")).toBe(
      "seed-tts-2.0",
    );
    expect(volcengineTtsUrl("https://openspeech.bytedance.com/")).toBe(
      "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
    );
    expect(volcengineSpeechRate(1.2)).toBe(20);
  });

  it("concatenates NDJSON audio chunks and stops at the done code", () => {
    const events = parseVolcengineNdjson(
      [
        `{"code":0,"data":"${Buffer.from("abc").toString("base64")}"}`,
        `{"code":0,"data":"${Buffer.from("def").toString("base64")}"}`,
        '{"code":20000000}',
      ].join("\n"),
    );
    expect(audioBytesFromVolcengineEvents(events).toString()).toBe("abcdef");
  });

  it("synthesizes through the unidirectional HTTP API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          `{"code":0,"data":"${Buffer.from("ID3mp3").toString("base64")}"}`,
          '{"code":20000000}',
        ].join("\n"),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createVolcengineTts(config).synthesize("你好，小滴。");
    expect(result.buffer.toString()).toBe("ID3mp3");
    expect(result.contentType).toBe("audio/mpeg");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("volc-key");
    expect(headers["X-Api-Resource-Id"]).toBe("seed-tts-2.0");
    expect(JSON.parse(String(request.body))).toMatchObject({
      req_params: {
        text: "你好，小滴。",
        speaker: "zh_female_peiqi_uranus_bigtts",
      },
    });
  });

  it("surfaces Volcengine error codes", () => {
    expect(() =>
      audioBytesFromVolcengineEvents([
        { code: 45000000, message: "app key not found" },
      ]),
    ).toThrow(SpotlightAudioError);
  });
});
