import { padSpokenTextForTts } from "@inupedia/spotlight-protocol";
import {
  SpotlightAudioError,
  extractTranscriptionText,
  normalizeSpeechText,
} from "../audioCore.js";
import { timeoutSignal, upstreamError } from "./http.js";
import type {
  VoiceAudioConfig,
  VoiceSttAdapter,
  VoiceSttResult,
  VoiceTtsAdapter,
  VoiceTtsChunk,
} from "./types.js";

export function createOpenAiCompatibleStt(
  config: VoiceAudioConfig,
): VoiceSttAdapter {
  return {
    id: config.kind,
    async transcribe(input, signal): Promise<VoiceSttResult> {
      const request = timeoutSignal(config.sttTimeoutMs, signal);
      const form = new FormData();
      form.append(
        "file",
        new Blob([Buffer.from(input.bytes)], {
          type: input.mimeType || "audio/wav",
        }),
        input.filename?.trim() || "spotlight-utterance.wav",
      );
      form.append("model", config.sttModel);
      try {
        const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
          signal: request.signal,
        });
        if (!response.ok) {
          throw new SpotlightAudioError(
            response.status,
            "STT_FAILED",
            `${config.kind} STT failed: ${await upstreamError(response)}`,
          );
        }
        const payload = await response.json().catch(() => null);
        const text = extractTranscriptionText(payload);
        return { text, isFinal: true };
      } catch (error) {
        if (error instanceof SpotlightAudioError) throw error;
        if (request.signal.aborted) {
          throw new SpotlightAudioError(
            504,
            "STT_TIMEOUT",
            "STT request timed out or was aborted",
          );
        }
        throw error;
      } finally {
        request.cleanup();
      }
    },
  };
}

function ttsBody(config: VoiceAudioConfig, spokenText: string, stream: boolean) {
  return {
    model: config.ttsModel,
    input: spokenText,
    voice: config.ttsVoice,
    response_format: config.ttsResponseFormat,
    stream,
    speed: config.ttsSpeed,
    gain: config.ttsGain,
    ...(config.ttsLanguage ? { language_type: config.ttsLanguage } : {}),
  };
}

export function createOpenAiCompatibleTts(
  config: VoiceAudioConfig,
): VoiceTtsAdapter {
  return {
    id: config.kind,
    async synthesize(text, signal) {
      const spokenText = normalizeSpeechText(text);
      if (!spokenText) {
        throw new SpotlightAudioError(
          400,
          "BAD_REQUEST",
          'Non-empty field "input" is required',
        );
      }
      const request = timeoutSignal(config.ttsTimeoutMs, signal);
      try {
        const response = await fetch(`${config.baseUrl}/audio/speech`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(ttsBody(config, padSpokenTextForTts(spokenText), false)),
          signal: request.signal,
        });
        if (!response.ok) {
          throw new SpotlightAudioError(
            response.status,
            "TTS_FAILED",
            `${config.kind} TTS failed: ${await upstreamError(response)}`,
          );
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) {
          throw new SpotlightAudioError(
            502,
            "TTS_FAILED",
            `${config.kind} TTS returned empty audio`,
          );
        }
        return {
          buffer,
          contentType: response.headers.get("content-type") || "audio/mpeg",
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
      const spokenText = normalizeSpeechText(text);
      if (!spokenText) {
        throw new SpotlightAudioError(
          400,
          "BAD_REQUEST",
          'Non-empty field "input" is required',
        );
      }
      const request = timeoutSignal(config.ttsTimeoutMs, signal);
      try {
        const response = await fetch(`${config.baseUrl}/audio/speech`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            ttsBody(config, padSpokenTextForTts(spokenText), true),
          ),
          signal: request.signal,
        });
        if (!response.ok) {
          throw new SpotlightAudioError(
            response.status,
            "TTS_FAILED",
            `${config.kind} TTS failed: ${await upstreamError(response)}`,
          );
        }
        const contentType =
          response.headers.get("content-type") || "application/octet-stream";
        if (!response.body) {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 0) {
            yield { bytes: buffer, contentType };
          }
          return;
        }
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            yield { bytes: value, contentType };
          }
        }
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
  };
}
