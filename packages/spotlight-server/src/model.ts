import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface SpotlightModelConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  routerModel?: string;
  timeoutMs?: number;
}

export interface SpotlightModelCatalogEntry {
  id: string;
  ownedBy?: string;
}

function isDeepSeekModelName(modelName: string): boolean {
  return /^deepseek(?:-|$)/iu.test(modelName);
}

/**
 * DeepSeek's Chat Completions API supports JSON objects and tool calls, but not
 * OpenAI's `response_format: json_schema`. Use function calling for Spotlight's
 * structured routing outputs when the selected model is DeepSeek.
 */
export function structuredOutputOptionsForModel(
  model: BaseChatModel,
): { method: "functionCalling" } | {} {
  const modelName = (model as BaseChatModel & { model?: unknown }).model;
  return typeof modelName === "string" && isDeepSeekModelName(modelName)
    ? { method: "functionCalling" }
    : {};
}

const NON_CHAT_MODEL_ID =
  /(?:embedding|reranker|image|kolors|wan[-/]|cosyvoice|sensevoice|asr|tts|ocr|diffusion|diariz)/iu;

export async function fetchAvailableModels(
  config: SpotlightModelConfig,
): Promise<SpotlightModelCatalogEntry[]> {
  const baseURL = (
    config.baseURL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/$/u, "");
  const response = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
  });
  if (!response.ok) {
    throw new Error(`Model provider returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown; owned_by?: unknown }>;
  };
  if (!Array.isArray(payload.data)) {
    throw new Error("Model provider returned an invalid catalog");
  }
  return payload.data
    .filter(
      (item): item is { id: string; owned_by?: string } =>
        typeof item?.id === "string" &&
        Boolean(item.id.trim()) &&
        !NON_CHAT_MODEL_ID.test(item.id),
    )
    .map((item) => ({
      id: item.id,
      ...(typeof item.owned_by === "string" ? { ownedBy: item.owned_by } : {}),
    }));
}

export function createAgentModel(config: SpotlightModelConfig) {
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0.1,
    timeout: config.timeoutMs ?? 45_000,
    maxRetries: 1,
    configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
  });
}

export function createRouterModel(config: SpotlightModelConfig) {
  const model = config.routerModel ?? config.model;
  // LangChain forces a named function tool for structured output. DeepSeek's
  // thinking mode rejects named tool_choice, so disable it on router calls.
  const modelKwargs = isDeepSeekModelName(model)
    ? ({ thinking: { type: "disabled" } } as unknown as ChatOpenAI["modelKwargs"])
    : undefined;
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model,
    temperature: 0,
    timeout: config.timeoutMs ?? 20_000,
    maxRetries: 1,
    modelKwargs,
    configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
  });
}
