import { sanitizeSpokenText } from "@inupedia/spotlight-protocol";
import { withRequestTimeout } from "../utils/requestTimeout.js";
import {
  buildSpotlightJsonHeaders,
  getSpotlightServerBase,
} from "./httpConfig.js";
import { postSpotlightJson } from "./serverJson.js";

const STT_REQUEST_TIMEOUT_MS = 30_000;
const TTS_REQUEST_TIMEOUT_MS = 45_000;

export function normalizeSpeakText(input: string): string {
  return sanitizeSpokenText(input).slice(0, 3000);
}

export function extractTranscriptionText(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const text = (payload as { text?: unknown }).text;
  if (typeof text === "string") return text.trim();
  return "";
}

export type SpotlightTranscriptionPayload = {
  file: string;
  mimeType: string;
  filename: string;
};

export async function spotlightTranscribeAudio(
  payload: SpotlightTranscriptionPayload,
  signal?: AbortSignal,
): Promise<unknown> {
  const request = withRequestTimeout(STT_REQUEST_TIMEOUT_MS, signal);
  try {
    return await postSpotlightJson<unknown>(
      "/v1/audio/transcriptions",
      payload,
      request.signal,
    );
  } finally {
    request.cleanup();
  }
}

export async function spotlightSynthesizeSpeech(
  text: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; spokenText: string }> {
  const spokenText = normalizeSpeakText(text);
  if (!spokenText) {
    throw new Error("TTS 输入为空。");
  }

  const request = withRequestTimeout(TTS_REQUEST_TIMEOUT_MS, signal);
  try {
    const base = getSpotlightServerBase();
    const response = await fetch(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: buildSpotlightJsonHeaders(),
      body: JSON.stringify({ input: spokenText }),
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (blob.size <= 0) {
      throw new Error("TTS 返回空音频。");
    }
    return { blob, spokenText };
  } finally {
    request.cleanup();
  }
}
