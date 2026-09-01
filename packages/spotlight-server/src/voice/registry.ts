import {
  createOpenAiCompatibleStt,
  createOpenAiCompatibleTts,
} from "./openaiCompatible.js";
import { resolveSpeechAudioConfig } from "./config.js";
import type {
  VoiceAudioConfig,
  VoiceProvider,
  VoiceSttAdapter,
  VoiceTtsAdapter,
} from "./types.js";
import { createVolcengineStt } from "./volcengineStt.js";
import { createVolcengineTts } from "./volcengineTts.js";

function createSttAdapter(config: VoiceAudioConfig): VoiceSttAdapter {
  if (config.kind === "volcengine") return createVolcengineStt(config);
  return createOpenAiCompatibleStt(config);
}

function createTtsAdapter(config: VoiceAudioConfig): VoiceTtsAdapter {
  if (config.kind === "volcengine") return createVolcengineTts(config);
  return createOpenAiCompatibleTts(config);
}

export function createVoiceProvider(
  env: NodeJS.ProcessEnv = process.env,
  override?: Partial<VoiceAudioConfig>,
): VoiceProvider {
  const stt = resolveSpeechAudioConfig(env, "stt");
  const tts = { ...resolveSpeechAudioConfig(env, "tts"), ...override };
  return {
    id: stt.kind === tts.kind ? stt.kind : `${stt.kind}+${tts.kind}`,
    stt: createSttAdapter(stt),
    tts: createTtsAdapter(tts),
  };
}
