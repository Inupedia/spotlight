import { sanitizeSpokenText } from "@inupedia/spotlight-protocol";

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

export function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

export function extractTranscriptionText(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const record = payload as {
    text?: unknown;
    output?: { text?: unknown };
  };
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.output?.text === "string") return record.output.text.trim();
  return "";
}

export function normalizeSpeechText(input: string): string {
  return sanitizeSpokenText(input).slice(0, 3000);
}
