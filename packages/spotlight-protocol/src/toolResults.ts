import type { SpotlightResourceRef } from "./resources.js";

export type SpotlightContentItem =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; alt?: string }
  | { type: "audio"; audioUrl: string }
  | { type: "resource"; resource: SpotlightResourceRef }
  | { type: "structured_data"; data: unknown };

export interface SpotlightToolSuccess<TData = unknown> {
  success: true;
  content: SpotlightContentItem[];
  data?: TData;
}

export interface SpotlightToolFailure {
  success: false;
  content?: SpotlightContentItem[];
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

export type SpotlightToolResultEnvelope<TData = unknown> =
  SpotlightToolSuccess<TData> | SpotlightToolFailure;

export function isSpotlightToolResultEnvelope(
  value: unknown,
): value is SpotlightToolResultEnvelope {
  return Boolean(
    value &&
    typeof value === "object" &&
    "success" in value &&
    typeof (value as { success?: unknown }).success === "boolean" &&
    ((value as { success: boolean }).success
      ? Array.isArray((value as { content?: unknown }).content)
      : Boolean((value as { error?: unknown }).error)),
  );
}

export function normalizeSpotlightToolOutput<T>(
  value: T | SpotlightToolResultEnvelope<T>,
): SpotlightToolResultEnvelope<T> {
  if (isSpotlightToolResultEnvelope(value))
    return value as SpotlightToolResultEnvelope<T>;
  if (value === undefined) return { success: true, content: [] };
  if (typeof value === "string") {
    return {
      success: true,
      content: [{ type: "text", text: value }],
      data: value,
    };
  }
  return {
    success: true,
    content: [{ type: "structured_data", data: value }],
    data: value,
  };
}
