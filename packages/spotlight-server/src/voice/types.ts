export type VoiceSttResult = {
  text: string;
  isFinal: boolean;
};

export type VoiceTtsChunk = {
  bytes: Uint8Array;
  contentType: string;
};

export interface VoiceSttAdapter {
  readonly id: string;
  transcribe(
    input: {
      bytes: Uint8Array;
      mimeType: string;
      filename?: string;
      sampleRate?: number;
    },
    signal?: AbortSignal,
  ): Promise<VoiceSttResult>;
}

export interface VoiceTtsAdapter {
  readonly id: string;
  synthesize(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ buffer: Buffer; contentType: string; spokenText: string }>;
  synthesizeStream(
    text: string,
    signal?: AbortSignal,
  ): AsyncIterable<VoiceTtsChunk>;
}

export interface VoiceProvider {
  readonly id: string;
  stt: VoiceSttAdapter;
  tts: VoiceTtsAdapter;
}

export type VoiceProviderKind =
  | "openai-compatible"
  | "qwen"
  | "siliconflow"
  | "volcengine";

export type VoiceAudioConfig = {
  kind: VoiceProviderKind;
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice?: string;
  ttsLanguage?: string;
  ttsResponseFormat: string;
  ttsStream: boolean;
  ttsSpeed: number;
  ttsGain: number;
  sttTimeoutMs: number;
  ttsTimeoutMs: number;
};

export type VoiceRuntimeConfig = {
  stt: VoiceAudioConfig;
  tts: VoiceAudioConfig;
};

export type VoiceSpeechRole = "stt" | "tts";
