import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVolcengineStt,
  extractVolcengineTranscript,
  volcengineAudioFormat,
  volcengineSttUrl,
} from "../src/voice/volcengineStt.js";
import type { VoiceAudioConfig } from "../src/voice/types.js";

const config: VoiceAudioConfig = {
  kind: "volcengine",
  apiKey: "volc-key",
  baseUrl: "https://openspeech.bytedance.com",
  sttModel: "volc.seedasr.auc",
  ttsModel: "seed-tts-2.0",
  ttsResponseFormat: "mp3",
  ttsStream: false,
  ttsSpeed: 1,
  ttsGain: 0,
  sttTimeoutMs: 30_000,
  ttsTimeoutMs: 45_000,
};

describe("volcengine STT", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps browser recordings onto SeedASR containers", () => {
    expect(volcengineAudioFormat("audio/webm;codecs=opus", "voice.webm")).toEqual({
      format: "ogg",
      codec: "opus",
    });
    expect(volcengineAudioFormat("audio/mpeg")).toEqual({ format: "mp3" });
    expect(volcengineSttUrl("https://openspeech.bytedance.com", "submit")).toBe(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",
    );
  });

  it("reads the transcript from a query payload", () => {
    expect(
      extractVolcengineTranscript({
        result: { text: "介绍一下引大济岷。" },
      }),
    ).toBe("介绍一下引大济岷。");
  });

  it("submits audio then polls until SeedASR finishes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "x-api-status-code": "20000000" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "x-api-status-code": "20000001" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { text: "打开建设程序" } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-api-status-code": "20000000",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createVolcengineStt(config, { pollIntervalMs: 0 }).transcribe({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
      filename: "voice.webm",
    });

    expect(result).toEqual({ text: "打开建设程序", isFinal: true });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",
    );
    expect(fetchMock.mock.calls[2]![0]).toBe(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query",
    );
    const submit = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = submit.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("volc-key");
    expect(headers["X-Api-Resource-Id"]).toBe("volc.seedasr.auc");
    expect(JSON.parse(String(submit.body))).toMatchObject({
      audio: { format: "ogg", codec: "opus" },
      request: { model_name: "bigmodel", enable_punc: true },
    });
  });
});
