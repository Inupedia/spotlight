import { SpotlightAudioError, readBoolean, readNumber } from "../audioCore.js";
import type {
  VoiceAudioConfig,
  VoiceProviderKind,
  VoiceRuntimeConfig,
  VoiceSpeechRole,
} from "./types.js";

function trim(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() || "";
}

function first(env: NodeJS.ProcessEnv, names: string[], fallback = ""): string {
  for (const name of names) {
    const value = trim(env, name);
    if (value) return value;
  }
  return fallback;
}

function normalizeKind(value: string): VoiceProviderKind | null {
  const kind = value.trim().toLowerCase();
  if (kind === "qwen" || kind === "dashscope") return "qwen";
  if (kind === "siliconflow") return "siliconflow";
  if (
    kind === "volcengine" ||
    kind === "volc" ||
    kind === "doubao" ||
    kind === "bytedance"
  ) {
    return "volcengine";
  }
  if (
    kind === "openai" ||
    kind === "openai-compatible" ||
    kind === "compatible"
  ) {
    return "openai-compatible";
  }
  return null;
}

function fallbackKindFromLlm(env: NodeJS.ProcessEnv): VoiceProviderKind {
  const llm = trim(env, "SPOTLIGHT_LLM_PROVIDER").toLowerCase();
  if (llm === "qwen") return "qwen";
  if (trim(env, "QWEN_API_KEY") && !trim(env, "SILICONFLOW_API_KEY")) {
    return "qwen";
  }
  if (trim(env, "SILICONFLOW_API_KEY")) return "siliconflow";
  if (trim(env, "QWEN_API_KEY") || trim(env, "DASHSCOPE_API_KEY")) return "qwen";
  return "openai-compatible";
}

export function resolveVoiceProviderKind(
  env: NodeJS.ProcessEnv = process.env,
  role: VoiceSpeechRole = "stt",
): VoiceProviderKind {
  const roleProvider =
    role === "tts" ? "SPOTLIGHT_TTS_PROVIDER" : "SPOTLIGHT_STT_PROVIDER";
  const explicit = normalizeKind(
    first(env, [roleProvider, "SPOTLIGHT_VOICE_PROVIDER"]),
  );
  if (explicit) return explicit;
  return fallbackKindFromLlm(env);
}

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function kindApiKeyNames(kind: VoiceProviderKind): string[] {
  if (kind === "qwen") return ["QWEN_API_KEY", "DASHSCOPE_API_KEY"];
  if (kind === "siliconflow") return ["SILICONFLOW_API_KEY"];
  if (kind === "volcengine") {
    return [
      "VOLCENGINE_TTS_API_KEY",
      "VOLCENGINE_STT_API_KEY",
      "VOLCENGINE_API_KEY",
      "DOUBAO_TTS_API_KEY",
      "DOUBAO_STT_API_KEY",
    ];
  }
  return [];
}

function kindBaseUrl(kind: VoiceProviderKind): string {
  if (kind === "qwen") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  if (kind === "siliconflow") return "https://api.siliconflow.cn/v1";
  if (kind === "volcengine") return "https://openspeech.bytedance.com";
  return "https://api.openai.com/v1";
}

export function resolveSpeechAudioConfig(
  env: NodeJS.ProcessEnv = process.env,
  role: VoiceSpeechRole = "stt",
): VoiceAudioConfig {
  const kind = resolveVoiceProviderKind(env, role);
  const qwen = kind === "qwen";
  const siliconflow = kind === "siliconflow";
  const volcengine = kind === "volcengine";
  const roleKey =
    role === "tts" ? "SPOTLIGHT_TTS_API_KEY" : "SPOTLIGHT_STT_API_KEY";
  const roleBase =
    role === "tts" ? "SPOTLIGHT_TTS_BASE_URL" : "SPOTLIGHT_STT_BASE_URL";
  const apiKey = first(env, [
    roleKey,
    ...kindApiKeyNames(kind),
    ...(volcengine
      ? [
          role === "stt" ? "SPOTLIGHT_TTS_API_KEY" : "SPOTLIGHT_STT_API_KEY",
        ]
      : ["SPOTLIGHT_LLM_API_KEY"]),
  ]);
  if (!apiKey) {
    throw new SpotlightAudioError(
      503,
      "SPEECH_NOT_CONFIGURED",
      role === "tts"
        ? volcengine
          ? "Set SPOTLIGHT_TTS_API_KEY or VOLCENGINE_TTS_API_KEY for Volcengine TTS"
          : "Set SPOTLIGHT_TTS_API_KEY, QWEN_API_KEY, or SILICONFLOW_API_KEY for TTS"
        : volcengine
          ? "Set SPOTLIGHT_STT_API_KEY, SPOTLIGHT_TTS_API_KEY, or VOLCENGINE_TTS_API_KEY for Volcengine STT"
          : "Set SPOTLIGHT_STT_API_KEY, QWEN_API_KEY, or SILICONFLOW_API_KEY for STT",
    );
  }
  const baseUrl = stripSlash(
    first(
      env,
      [
        roleBase,
        qwen ? "QWEN_API_BASE" : "",
        siliconflow ? "SILICONFLOW_API_BASE" : "",
        volcengine ? "" : "SPOTLIGHT_LLM_BASE_URL",
      ].filter(Boolean),
      kindBaseUrl(kind),
    ),
  );
  return {
    kind,
    apiKey,
    baseUrl,
    sttModel: first(
      env,
      ["SPOTLIGHT_STT_MODEL", siliconflow ? "SILICONFLOW_STT_MODEL" : ""],
      qwen
        ? "qwen3-asr-flash"
        : siliconflow
          ? "TeleAI/TeleSpeechASR"
          : volcengine
            ? "volc.seedasr.auc"
            : "whisper-1",
    ),
    ttsModel: first(
      env,
      ["SPOTLIGHT_TTS_MODEL", siliconflow ? "SILICONFLOW_TTS_MODEL" : ""],
      qwen
        ? "qwen3-tts-flash"
        : siliconflow
          ? "FunAudioLLM/CosyVoice2-0.5B"
          : volcengine
            ? "seed-tts-2.0"
            : "tts-1",
    ),
    ttsVoice:
      first(
        env,
        ["SPOTLIGHT_TTS_VOICE", siliconflow ? "SILICONFLOW_TTS_VOICE" : ""],
        qwen
          ? "Cherry"
          : siliconflow
            ? "fishaudio/fish-speech-1.4:diana"
            : volcengine
              ? "zh_female_peiqi_uranus_bigtts"
              : "alloy",
      ) || undefined,
    ttsLanguage:
      first(env, ["SPOTLIGHT_TTS_LANGUAGE", "QWEN_TTS_LANGUAGE"]) || undefined,
    ttsResponseFormat: first(
      env,
      ["SPOTLIGHT_TTS_RESPONSE_FORMAT", "SILICONFLOW_TTS_RESPONSE_FORMAT"],
      "mp3",
    ),
    ttsStream: readBoolean(
      env,
      "SPOTLIGHT_TTS_STREAM",
      readBoolean(env, "SILICONFLOW_TTS_STREAM", true),
    ),
    ttsSpeed: readNumber(
      env,
      "SPOTLIGHT_TTS_SPEED",
      volcengine ? 1 : readNumber(env, "SILICONFLOW_TTS_SPEED", 1.2),
    ),
    ttsGain: Number(env.SPOTLIGHT_TTS_GAIN ?? env.SILICONFLOW_TTS_GAIN ?? 0) || 0,
    sttTimeoutMs: readNumber(
      env,
      "SPOTLIGHT_STT_TIMEOUT_MS",
      readNumber(env, "SILICONFLOW_STT_TIMEOUT_MS", 30_000),
    ),
    ttsTimeoutMs: readNumber(
      env,
      "SPOTLIGHT_TTS_TIMEOUT_MS",
      readNumber(env, "SILICONFLOW_TTS_TIMEOUT_MS", 45_000),
    ),
  };
}

/** @deprecated Use resolveSpeechAudioConfig(env, "stt" | "tts"). */
export function resolveVoiceAudioConfig(
  env: NodeJS.ProcessEnv = process.env,
): VoiceAudioConfig {
  return resolveSpeechAudioConfig(env, "stt");
}

export function resolveVoiceRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): VoiceRuntimeConfig {
  return {
    stt: resolveSpeechAudioConfig(env, "stt"),
    tts: resolveSpeechAudioConfig(env, "tts"),
  };
}
