import type { RunManager } from "../src/runManager.js";
import { buildServer } from "../src/server.js";
import {
  normalizeSpeechText,
  synthesizeSpotlightSpeech,
  transcribeSpotlightAudio,
} from "../src/audio.js";

describe("Spotlight audio adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes rich answer text before TTS", () => {
    expect(
      normalizeSpeechText(
        "## 结果\n[泸定](https://example.test) `BIM` **已打开**",
      ),
    ).toBe("结果 泸定 BIM 已打开");
  });

  it("forwards browser audio to SiliconFlow STT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "介绍一下引大济岷" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeSpotlightAudio(
      {
        file: Buffer.from("fake-webm").toString("base64"),
        mimeType: "audio/webm",
        filename: "voice.webm",
      },
      {
        SILICONFLOW_API_KEY: "test-key",
        SILICONFLOW_API_BASE: "https://voice.example/v1/",
        SILICONFLOW_STT_MODEL: "test-stt",
      },
    );

    expect(result.text).toBe("介绍一下引大济岷");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://voice.example/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((request.body as FormData).get("model")).toBe("test-stt");
  });

  it("returns synthesized audio bytes from SiliconFlow TTS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeSpotlightSpeech(
      { input: "**你好**，小滴" },
      {
        SILICONFLOW_API_KEY: "test-key",
        SILICONFLOW_API_BASE: "https://voice.example/v1",
      },
    );

    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(result.contentType).toBe("audio/mpeg");
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      input: "你好，小滴",
      model: "FunAudioLLM/CosyVoice2-0.5B",
    });
  });

  it("exposes authenticated STT/TTS routes and clear configuration errors", async () => {
    const previousKey = process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    const app = await buildServer({
      runManager: {
        listServerToolNames: () => [],
        providerIds: () => ({ knowledge: "none", webSearch: "none" }),
      } as unknown as RunManager,
      projectId: "voice-test",
      apiKeys: ["client-key"],
    });

    try {
      const unauthorized = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        payload: { input: "你好" },
      });
      expect(unauthorized.statusCode).toBe(401);

      const unconfigured = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "x-spotlight-api-key": "client-key" },
        payload: { input: "你好" },
      });
      expect(unconfigured.statusCode).toBe(503);
      expect(unconfigured.json()).toMatchObject({
        error: { code: "SPEECH_NOT_CONFIGURED" },
      });
    } finally {
      await app.close();
      if (previousKey === undefined) delete process.env.SILICONFLOW_API_KEY;
      else process.env.SILICONFLOW_API_KEY = previousKey;
    }
  });

  it("rejects missing audio bodies without throwing an internal error", async () => {
    await expect(transcribeSpotlightAudio(undefined, {})).rejects.toMatchObject(
      {
        statusCode: 400,
        code: "BAD_REQUEST",
      },
    );
    await expect(
      synthesizeSpotlightSpeech(undefined, {}),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  });
});
