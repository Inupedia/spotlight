import { ChatOpenAI } from "@langchain/openai";

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
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.routerModel ?? config.model,
    temperature: 0,
    timeout: config.timeoutMs ?? 20_000,
    maxRetries: 1,
    configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
  });
}
