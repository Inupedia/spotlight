import { SpotlightAudioError, normalizeSpeechText } from "../audioCore.js";
import { timeoutSignal, upstreamError } from "./http.js";
import type {
  VoiceAudioConfig,
  VoiceTtsAdapter,
  VoiceTtsChunk,
} from "./types.js";

export type VolcengineTtsEvent = {
  code?: number | string;
  message?: string;
  data?: string | null;
};

const VOLCENGINE_DONE_CODE = 20_000_000;

export function volcengineTtsUrl(baseUrl: string): string {
  const stripped = baseUrl.replace(/\/$/, "");
  if (stripped.endsWith("/api/v3/tts/unidirectional")) return stripped;
  return `${stripped}/api/v3/tts/unidirectional`;
}

export function volcengineResourceId(voice: string, model?: string): string {
  const explicit = model?.trim();
  if (explicit) return explicit;
  if (voice.startsWith("S_") || voice.startsWith("icl_")) return "seed-icl-2.0";
  if (voice.includes("_uranus_") || voice.startsWith("saturn_")) {
    return "seed-tts-2.0";
  }
  return "seed-tts-1.0";
}

/** Map OpenAI-style speed (1.0 = normal) to Volcengine speech_rate. */
export function volcengineSpeechRate(speed: number): number {
  if (!Number.isFinite(speed)) return 0;
  return Math.max(-50, Math.min(100, Math.round((speed - 1) * 100)));
}

export function parseVolcengineNdjson(raw: string): VolcengineTtsEvent[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as VolcengineTtsEvent);
}

function eventCode(event: VolcengineTtsEvent): number {
  const code = Number(event.code);
  return Number.isFinite(code) ? code : 0;
}

export function audioBytesFromVolcengineEvents(
  events: VolcengineTtsEvent[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const event of events) {
    const code = eventCode(event);
    if (code === VOLCENGINE_DONE_CODE) break;
    if (code !== 0) {
      throw new SpotlightAudioError(
        502,
        "TTS_FAILED",
        `volcengine TTS failed: ${event.message || `code ${code}`}`,
      );
    }
    if (typeof event.data === "string" && event.data) {
      chunks.push(Buffer.from(event.data, "base64"));
    }
  }
  if (chunks.length === 0) {
    throw new SpotlightAudioError(
      502,
      "TTS_FAILED",
      "volcengine TTS returned empty audio",
    );
  }
  return Buffer.concat(chunks);
}

function ttsHeaders(config: VoiceAudioConfig, voice: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": config.apiKey,
    "X-Api-Resource-Id": volcengineResourceId(voice, config.ttsModel),
    "X-Api-Request-Id": globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
  };
}

function ttsBody(config: VoiceAudioConfig, spokenText: string, voice: string) {
  const format = (config.ttsResponseFormat || "mp3").replace(/^audio\//, "");
  return {
    user: { uid: "ydjm-spotlight" },
    req_params: {
      text: spokenText,
      speaker: voice,
      audio_params: {
        format,
        sample_rate: 24000,
        speech_rate: volcengineSpeechRate(config.ttsSpeed),
      },
      additions: JSON.stringify({
        disable_markdown_filter: true,
        silence_duration: 180,
      }),
    },
  };
}

function contentTypeForFormat(format: string): string {
  if (format === "wav") return "audio/wav";
  if (format === "pcm") return "audio/pcm";
  if (format === "ogg_opus") return "audio/ogg";
  return "audio/mpeg";
}

export function createVolcengineTts(config: VoiceAudioConfig): VoiceTtsAdapter {
  return {
    id: "volcengine",
    async synthesize(text, signal) {
      const spokenText = normalizeSpeechText(text);
      if (!spokenText) {
        throw new SpotlightAudioError(
          400,
          "BAD_REQUEST",
          'Non-empty field "input" is required',
        );
      }
      const voice = config.ttsVoice?.trim();
      if (!voice) {
        throw new SpotlightAudioError(
          400,
          "BAD_REQUEST",
          "SPOTLIGHT_TTS_VOICE is required for Volcengine TTS",
        );
      }
      const request = timeoutSignal(config.ttsTimeoutMs, signal);
      try {
        const response = await fetch(volcengineTtsUrl(config.baseUrl), {
          method: "POST",
          headers: ttsHeaders(config, voice),
          body: JSON.stringify(ttsBody(config, spokenText, voice)),
          signal: request.signal,
        });
        const raw = await response.text();
        if (!response.ok) {
          throw new SpotlightAudioError(
            response.status,
            "TTS_FAILED",
            `volcengine TTS failed: ${raw || (await upstreamError(response))}`,
          );
        }
        return {
          buffer: audioBytesFromVolcengineEvents(parseVolcengineNdjson(raw)),
          contentType: contentTypeForFormat(
            (config.ttsResponseFormat || "mp3").replace(/^audio\//, ""),
          ),
          spokenText,
        };
      } catch (error) {
        if (error instanceof SpotlightAudioError) throw error;
        if (request.signal.aborted) {
          throw new SpotlightAudioError(
            504,
            "TTS_TIMEOUT",
            "TTS request timed out or was aborted",
          );
        }
        throw error;
      } finally {
        request.cleanup();
      }
    },
    async *synthesizeStream(text, signal): AsyncIterable<VoiceTtsChunk> {
      const result = await this.synthesize(text, signal);
      yield { bytes: result.buffer, contentType: result.contentType };
    },
  };
}
