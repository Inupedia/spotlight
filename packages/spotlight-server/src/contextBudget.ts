import type { CreateRunRequest } from "@inupedia/spotlight-protocol";

export interface SpotlightContextMetrics {
  characters: number;
  compacted: boolean;
  estimatedInputTokens: number;
}

function clipped(value: string | undefined, max: number): string | undefined {
  if (!value) return value;
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Deterministic pre-model budget. Untrusted context is bounded independently. */
export function prepareRunContext<T extends CreateRunRequest>(
  input: T,
  maxCharacters = 24_000,
): { request: T; metrics: SpotlightContextMetrics } {
  const request = structuredClone(input);
  const capabilityCharacters =
    request.userQuestion.length +
    JSON.stringify(request.skills ?? []).length +
    JSON.stringify(request.clientToolManifest?.tools ?? []).length +
    JSON.stringify(request.outputSchema ?? {}).length;
  let remaining = Math.max(4_000, maxCharacters);
  let compacted = false;
  const summary = clipped(request.sessionState?.conversationSummary, Math.min(6_000, remaining));
  if (summary !== request.sessionState?.conversationSummary) compacted = true;
  if (request.sessionState) request.sessionState.conversationSummary = summary;
  remaining -= summary?.length ?? 0;

  const history = request.sessionState?.conversationHistory ?? [];
  const retained = [] as typeof history;
  for (const turn of [...history].reverse()) {
    const content = clipped(turn.content, 2_000) ?? "";
    if (content.length > remaining) {
      compacted = true;
      continue;
    }
    retained.unshift({ ...turn, content });
    remaining -= content.length;
  }
  if (retained.length !== history.length) compacted = true;
  if (request.sessionState) request.sessionState.conversationHistory = retained;

  for (const [key, entry] of Object.entries(request.additionalContext ?? {})) {
    const perEntry = entry.kind === "untrusted" ? 2_000 : 4_000;
    const value = clipped(entry.value, Math.min(perEntry, Math.max(0, remaining))) ?? "";
    if (value !== entry.value) compacted = true;
    if (!value) {
      delete request.additionalContext?.[key];
      continue;
    }
    request.additionalContext![key] = { ...entry, value };
    remaining -= value.length;
  }
  const characters = capabilityCharacters + (maxCharacters - remaining);
  return {
    request,
    metrics: {
      characters,
      compacted,
      estimatedInputTokens: Math.ceil(characters / 4),
    },
  };
}

export function structuredOutputQuestion(
  question: string,
  schema: Record<string, unknown> | undefined,
): string {
  if (!schema) return question;
  return `${question}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(schema)}`;
}

export function validateStructuredOutput(
  content: string,
  schema: Record<string, unknown> | undefined,
): string {
  if (!schema) return content;
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new Error("STRUCTURED_OUTPUT_INVALID: model response is not valid JSON");
  }
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("STRUCTURED_OUTPUT_INVALID: expected a JSON object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (typeof key === "string" && !(key in record)) {
      throw new Error(`STRUCTURED_OUTPUT_INVALID: missing required property ${key}`);
    }
  }
  return JSON.stringify(value);
}
