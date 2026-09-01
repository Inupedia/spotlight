import { describe, expect, it } from "vitest";
import {
  resolveSpeechAudioConfig,
  resolveVoiceAudioConfig,
  resolveVoiceProviderKind,
} from "../src/voice/config.js";

describe("voice provider selection", () => {
  it("follows the LLM provider instead of defaulting to SiliconFlow", () => {
    expect(
      resolveVoiceProviderKind({
        SPOTLIGHT_LLM_PROVIDER: "qwen",
        SILICONFLOW_API_KEY: "sf-key",
        QWEN_API_KEY: "qwen-key",
      }),
    ).toBe("qwen");
  });

  it("lets STT/TTS be chosen independently of the chat model", () => {
    const env = {
      SPOTLIGHT_LLM_PROVIDER: "siliconflow",
      SPOTLIGHT_STT_PROVIDER: "qwen",
      SILICONFLOW_API_KEY: "sf-key",
      QWEN_API_KEY: "qwen-key",
    };
    expect(resolveVoiceProviderKind(env, "stt")).toBe("qwen");
    expect(resolveVoiceProviderKind(env, "tts")).toBe("siliconflow");
  });

  it("does not share STT credentials with TTS", () => {
    const env = {
      SPOTLIGHT_STT_PROVIDER: "qwen",
      SPOTLIGHT_TTS_PROVIDER: "siliconflow",
      SPOTLIGHT_STT_API_KEY: "stt-only",
      QWEN_API_KEY: "qwen-key",
      SILICONFLOW_API_KEY: "sf-key",
    };
    expect(resolveSpeechAudioConfig(env, "stt")).toMatchObject({
      kind: "qwen",
      apiKey: "stt-only",
    });
    expect(resolveSpeechAudioConfig(env, "tts")).toMatchObject({
      kind: "siliconflow",
      apiKey: "sf-key",
    });
  });

  it("uses Volcengine for STT and TTS with the same key", () => {
    const env = {
      SPOTLIGHT_LLM_PROVIDER: "siliconflow",
      SPOTLIGHT_STT_PROVIDER: "volcengine",
      SPOTLIGHT_TTS_PROVIDER: "volcengine",
      SPOTLIGHT_TTS_API_KEY: "volc-key",
      SILICONFLOW_API_KEY: "sf-key",
    };
    expect(resolveVoiceProviderKind(env, "stt")).toBe("volcengine");
    expect(resolveVoiceProviderKind(env, "tts")).toBe("volcengine");
    expect(resolveSpeechAudioConfig(env, "stt")).toMatchObject({
      kind: "volcengine",
      apiKey: "volc-key",
      sttModel: "volc.seedasr.auc",
    });
    expect(resolveSpeechAudioConfig(env, "tts")).toMatchObject({
      kind: "volcengine",
      apiKey: "volc-key",
      baseUrl: "https://openspeech.bytedance.com",
      ttsModel: "seed-tts-2.0",
      ttsVoice: "zh_female_peiqi_uranus_bigtts",
    });
  });

  it("uses Qwen ASR/TTS when the voice provider is qwen", () => {
    expect(
      resolveVoiceAudioConfig({
        SPOTLIGHT_VOICE_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-key",
      }),
    ).toMatchObject({
      kind: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      sttModel: "qwen3-asr-flash",
      ttsModel: "qwen3-tts-flash",
      ttsVoice: "Cherry",
    });
  });
});
