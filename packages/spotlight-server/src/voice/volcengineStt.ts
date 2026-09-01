import { SpotlightAudioError } from "../audioCore.js";
import { timeoutSignal, upstreamError } from "./http.js";
import type { VoiceAudioConfig, VoiceSttAdapter, VoiceSttResult } from "./types.js";

const SUBMITTED = 20_000_000;
const PROCESSING = 20_000_001;
const QUEUED = 20_000_002;
const SILENT = 20_000_003;

export type VolcengineAudioFormat = {
  format: string;
  codec?: string;
};

export function volcengineSttUrl(baseUrl: string, action: "submit" | "query"): string {
  const stripped = baseUrl.replace(/\/$/, "");
  const path = `/api/v3/auc/bigmodel/${action}`;
  if (stripped.endsWith(path)) return stripped;
  return `${stripped}${path}`;
}

export function volcengineAudioFormat(
  mimeType: string,
  filename = "",
): VolcengineAudioFormat {
  const mime = mimeType.toLowerCase();
  const name = filename.toLowerCase();
  if (mime.includes("wav") || name.endsWith(".wav")) return { format: "wav" };
  if (mime.includes("mpeg") || mime.includes("mp3") || name.endsWith(".mp3")) {
    return { format: "mp3" };
  }
  if (mime.includes("ogg") || name.endsWith(".ogg") || name.endsWith(".opus")) {
    return { format: "ogg", codec: "opus" };
  }
  if (mime.includes("webm") || name.endsWith(".webm")) {
    return { format: "ogg", codec: "opus" };
  }
  return { format: "ogg", codec: "opus" };
}

export function extractVolcengineTranscript(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const result = (payload as { result?: unknown }).result;
  if (typeof result === "string") return result.trim();
  if (Array.isArray(result)) {
    return result
      .map((item) =>
        item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : "",
      )
      .join("")
      .trim();
  }
  if (result && typeof result === "object") {
    const text = (result as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();
  }
  return "";
}

export function readVolcengineStatus(response: Response): number {
  const raw = response.headers.get("x-api-status-code")?.trim() || "";
  const code = Number(raw);
  return Number.isFinite(code) ? code : NaN;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function asrHeaders(
  config: VoiceAudioConfig,
  requestId: string,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": config.apiKey,
    "X-Api-Resource-Id": config.sttModel || "volc.seedasr.auc",
    "X-Api-Request-Id": requestId,
    "X-Api-Sequence": "-1",
  };
}

function failStatus(code: number, message: string): never {
  if (code === SILENT) {
    throw new SpotlightAudioError(400, "STT_FAILED", "没有检测到人声，请再试一次。");
  }
  throw new SpotlightAudioError(
    502,
    "STT_FAILED",
    `volcengine STT failed: ${message || `code ${code}`}`,
  );
}

export function createVolcengineStt(
  config: VoiceAudioConfig,
  options?: { pollIntervalMs?: number },
): VoiceSttAdapter {
  const pollIntervalMs = options?.pollIntervalMs ?? 400;
  return {
    id: "volcengine",
    async transcribe(input, signal): Promise<VoiceSttResult> {
      if (!input.bytes.length) {
        throw new SpotlightAudioError(400, "BAD_REQUEST", "Decoded audio is empty");
      }
      const request = timeoutSignal(config.sttTimeoutMs, signal);
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
      const headers = asrHeaders(config, requestId);
      const audio = volcengineAudioFormat(input.mimeType, input.filename);
      try {
        const submit = await fetch(volcengineSttUrl(config.baseUrl, "submit"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            user: { uid: "ydjm-spotlight" },
            audio: {
              data: Buffer.from(input.bytes).toString("base64"),
              format: audio.format,
              ...(audio.codec ? { codec: audio.codec } : {}),
            },
            request: {
              model_name: "bigmodel",
              enable_itn: true,
              enable_punc: true,
            },
          }),
          signal: request.signal,
        });
        const submitCode = readVolcengineStatus(submit);
        if (!submit.ok || submitCode !== SUBMITTED) {
          failStatus(
            submitCode,
            (await submit.text().catch(() => "")) ||
              submit.headers.get("x-api-message") ||
              (await upstreamError(submit)),
          );
        }

        while (true) {
          await sleep(pollIntervalMs, request.signal);
          const query = await fetch(volcengineSttUrl(config.baseUrl, "query"), {
            method: "POST",
            headers,
            body: "{}",
            signal: request.signal,
          });
          const queryCode = readVolcengineStatus(query);
          if (queryCode === PROCESSING || queryCode === QUEUED) continue;
          const payload = await query.json().catch(() => null);
          if (queryCode === SUBMITTED) {
            const text = extractVolcengineTranscript(payload);
            if (!text) {
              throw new SpotlightAudioError(
                502,
                "STT_FAILED",
                "volcengine STT returned empty text",
              );
            }
            return { text, isFinal: true };
          }
          failStatus(
            queryCode,
            query.headers.get("x-api-message") ||
              (payload && typeof payload === "object"
                ? String((payload as { message?: unknown }).message ?? "")
                : "") ||
              `HTTP ${query.status}`,
          );
        }
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
