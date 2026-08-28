export type SpotlightTranscriptionInput = {
  file: string;
  mimeType?: string;
  filename?: string;
};

export type SpotlightSpeechInput = {
  input: string;
};

export class SpotlightAudioError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpotlightAudioError";
  }
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function siliconflowConfig(env: NodeJS.ProcessEnv) {
  const apiKey = env.SILICONFLOW_API_KEY?.trim();
  if (!apiKey) {
    throw new SpotlightAudioError(
      503,
      "SPEECH_NOT_CONFIGURED",
      "SILICONFLOW_API_KEY is required for Spotlight STT/TTS",
    );
  }
  return {
    apiKey,
    baseUrl: (
      env.SILICONFLOW_API_BASE?.trim() || "https://api.siliconflow.cn/v1"
    ).replace(/\/$/, ""),
  };
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

async function upstreamError(response: Response): Promise<string> {
  const detail = await response.text().catch(() => "");
  return detail || `HTTP ${response.status}`;
}

export function extractTranscriptionText(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

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

  const provider = siliconflowConfig(env);
  const request = timeoutSignal(
    readNumber(env, "SILICONFLOW_STT_TIMEOUT_MS", 30_000),
    signal,
  );
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: input?.mimeType?.trim() || "audio/webm" }),
    input?.filename?.trim() || "spotlight-recording.webm",
  );
  form.append(
    "model",
    env.SILICONFLOW_STT_MODEL?.trim() || "TeleAI/TeleSpeechASR",
  );

  try {
    const response = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: form,
      signal: request.signal,
    });
    if (!response.ok) {
      throw new SpotlightAudioError(
        response.status,
        "SILICONFLOW_STT_FAILED",
        `SiliconFlow STT failed: ${await upstreamError(response)}`,
      );
    }
    const payload = await response.json().catch(() => null);
    const text = extractTranscriptionText(payload);
    if (!text) {
      throw new SpotlightAudioError(
        502,
        "SILICONFLOW_STT_FAILED",
        "SiliconFlow STT returned empty text",
      );
    }
    return payload && typeof payload === "object"
      ? { ...(payload as Record<string, unknown>), text }
      : { text };
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
}

export function normalizeSpeechText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[#>*_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1")
    .trim()
    .slice(0, 3000);
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

  const provider = siliconflowConfig(env);
  const request = timeoutSignal(
    readNumber(env, "SILICONFLOW_TTS_TIMEOUT_MS", 45_000),
    signal,
  );
  const body = {
    model: env.SILICONFLOW_TTS_MODEL?.trim() || "FunAudioLLM/CosyVoice2-0.5B",
    input: spokenText,
    voice:
      env.SILICONFLOW_TTS_VOICE?.trim() || "fishaudio/fish-speech-1.4:diana",
    response_format: env.SILICONFLOW_TTS_RESPONSE_FORMAT?.trim() || "mp3",
    stream: readBoolean(env, "SILICONFLOW_TTS_STREAM", false),
    speed: readNumber(env, "SILICONFLOW_TTS_SPEED", 1.2),
    gain: Number(env.SILICONFLOW_TTS_GAIN ?? 0) || 0,
  };

  try {
    const response = await fetch(`${provider.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!response.ok) {
      throw new SpotlightAudioError(
        response.status,
        "SILICONFLOW_TTS_FAILED",
        `SiliconFlow TTS failed: ${await upstreamError(response)}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new SpotlightAudioError(
        502,
        "SILICONFLOW_TTS_FAILED",
        "SiliconFlow TTS returned empty audio",
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
}
