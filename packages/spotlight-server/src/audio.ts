import { SpotlightAudioError, normalizeSpeechText } from "./audioCore.js";
import { createVoiceProvider } from "./voice/registry.js";

export {
  SpotlightAudioError,
  extractTranscriptionText,
  normalizeSpeechText,
} from "./audioCore.js";

export type SpotlightTranscriptionInput = {
  file: string;
  mimeType?: string;
  filename?: string;
};

export type SpotlightSpeechInput = {
  input: string;
};

export async function transcribeSpotlightAudio(
  input: SpotlightTranscriptionInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const encoded = input?.file?.trim();
  if (!encoded) {
    throw new SpotlightAudioError(
      400,
      "BAD_REQUEST",
      'Base64 field "file" is required',
    );
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    throw new SpotlightAudioError(400, "BAD_REQUEST", "Decoded audio is empty");
  }
  const provider = createVoiceProvider(env);
  const result = await provider.stt.transcribe(
    {
      bytes,
      mimeType: input?.mimeType?.trim() || "audio/webm",
      filename: input?.filename?.trim() || "spotlight-recording.webm",
    },
    signal,
  );
  if (!result.text) {
    throw new SpotlightAudioError(
      502,
      "STT_FAILED",
      `${provider.id} STT returned empty text`,
    );
  }
  return { text: result.text };
}

export async function synthesizeSpotlightSpeech(
  input: SpotlightSpeechInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; contentType: string; spokenText: string }> {
  const spokenText = normalizeSpeechText(input?.input ?? "");
  if (!spokenText) {
    throw new SpotlightAudioError(
      400,
      "BAD_REQUEST",
      'Non-empty field "input" is required',
    );
  }
  const provider = createVoiceProvider(env);
  return provider.tts.synthesize(spokenText, signal);
}
