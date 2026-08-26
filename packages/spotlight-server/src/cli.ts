#!/usr/bin/env node
import { createAgentModel, createRouterModel } from "./model.js";
import { createMemoryRuntime } from "./memory.js";
import { loadProjectPack } from "./project.js";
import { LangChainIntentRouter } from "./router.js";
import { RunManager } from "./runManager.js";
import { buildServer } from "./server.js";
import { SpotlightDurableState } from "./durableState.js";

function required(env: NodeJS.ProcessEnv, name: string, fallbackName?: string): string {
  const value = env[name]?.trim() || (fallbackName ? env[fallbackName]?.trim() : "");
  if (!value) throw new Error(`${name}${fallbackName ? ` or ${fallbackName}` : ""} is required`);
  return value;
}

export function resolveModelConfigs(env: NodeJS.ProcessEnv = process.env) {
  const useQwen = env.SPOTLIGHT_LLM_PROVIDER?.trim().toLowerCase() === "qwen";
  const modelConfig = {
    apiKey: required(
      env,
      "SPOTLIGHT_LLM_API_KEY",
      useQwen ? "QWEN_API_KEY" : "SILICONFLOW_API_KEY",
    ),
    baseURL:
      env.SPOTLIGHT_LLM_BASE_URL ??
      (useQwen ? env.QWEN_API_BASE : env.SILICONFLOW_API_BASE),
    model:
      env.SPOTLIGHT_LLM_MODEL ??
      (useQwen ? env.QWEN_MODEL : env.SILICONFLOW_MODEL) ??
      "gpt-4.1-mini",
    routerModel: env.SPOTLIGHT_ROUTER_MODEL,
    timeoutMs: Number(env.SPOTLIGHT_LLM_TIMEOUT_MS ?? 45_000),
  };
  const routerConfig = {
    apiKey:
      env.SPOTLIGHT_ROUTER_API_KEY?.trim() ||
      modelConfig.apiKey,
    baseURL:
      env.SPOTLIGHT_ROUTER_BASE_URL ??
      modelConfig.baseURL,
    model:
      env.SPOTLIGHT_ROUTER_MODEL ??
      modelConfig.model,
    timeoutMs: Number(env.SPOTLIGHT_ROUTER_TIMEOUT_MS ?? 20_000),
  };
  return { modelConfig, routerConfig };
}

export async function main(): Promise<void> {
  const projectConfigPath = required(process.env, "SPOTLIGHT_PROJECT_CONFIG");
  const project = await loadProjectPack(projectConfigPath);
  const { modelConfig, routerConfig } = resolveModelConfigs();
  const memory = createMemoryRuntime(process.env.SPOTLIGHT_DATABASE_URL);
  await memory.setup();
  const durableState = new SpotlightDurableState(
    process.env.SPOTLIGHT_STATE_DIR?.trim() || ".spotlight/state",
  );
  const manager = new RunManager({
    project,
    model: createAgentModel(modelConfig),
    router: new LangChainIntentRouter(createRouterModel(routerConfig), {
      namedTargetCatalogs: project.namedTargetCatalogs,
    }),
    checkpointer: memory.checkpointer,
    store: memory.store,
    durableState,
    hostActionTimeoutMs: Number(process.env.SPOTLIGHT_HOST_ACTION_TIMEOUT_MS ?? 30_000),
  });
  const app = await buildServer({
    runManager: manager,
    projectId: project.projectId,
    apiKeys: (process.env.SPOTLIGHT_API_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    uiPrompts: project.uiPrompts,
    videoChannels: project.videoChannels,
    durableState,
    capabilitySessionTtlMs: Number(
      process.env.SPOTLIGHT_CAPABILITY_SESSION_TTL_MS ?? 24 * 60 * 60_000,
    ),
  });
  await app.listen({
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 8787),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
