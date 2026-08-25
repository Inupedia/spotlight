import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import type { ProjectPack, SpotlightServerTool } from "./contracts.js";
import {
  createDefaultProviderRegistry,
  type SpotlightProviderConfig,
  type SpotlightProviderRegistry,
} from "./providerRegistry.js";
import { assertServerToolMetadata } from "./safety.js";

interface ProviderConfig extends SpotlightProviderConfig {
  type: string;
  baseUrl?: string;
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  agentSlug?: string;
  maxAttempts?: number;
  timeoutMs?: number;
}

interface ProjectConfigFile {
  projectId: string;
  module?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  uiPromptsFile?: string;
  videoChannelsFile?: string;
  providers?: {
    knowledge?: ProviderConfig;
    webSearch?: ProviderConfig;
  };
}

type ProjectModule = {
  default?:
    | Partial<ProjectPack>
    | (() => Partial<ProjectPack> | Promise<Partial<ProjectPack>>);
  createProjectPack?: () =>
    Partial<ProjectPack> | Promise<Partial<ProjectPack>>;
  serverTools?: SpotlightServerTool[];
  createServerTools?: () =>
    SpotlightServerTool[] | Promise<SpotlightServerTool[]>;
  registerProviders?: (
    registry: SpotlightProviderRegistry,
  ) => void | Promise<void>;
};

function interpolateEnvironment(source: string): string {
  return source.replace(
    /\$\{([A-Z][A-Z0-9_]*)(:-)?\}/gu,
    (_match, name: string, optional: string | undefined) => {
      const value = process.env[name];
      if (value != null) return value;
      if (optional) return "";
      throw new Error(
        `Environment variable ${name} is required by project config`,
      );
    },
  );
}

function localPath(configPath: string, filePath: string): string {
  return isAbsolute(filePath)
    ? filePath
    : resolve(dirname(configPath), filePath);
}

async function readJson(
  configPath: string,
  filePath?: string,
): Promise<unknown> {
  if (!filePath) return undefined;
  return JSON.parse(await readFile(localPath(configPath, filePath), "utf8"));
}

async function loadModule(
  configPath: string,
  moduleName?: string,
): Promise<ProjectModule | null> {
  if (!moduleName) return null;
  return import(
    pathToFileURL(localPath(configPath, moduleName)).href
  ) as Promise<ProjectModule>;
}

async function modulePack(
  imported: ProjectModule | null,
): Promise<Partial<ProjectPack>> {
  if (!imported) return {};
  const factory = imported.createProjectPack ?? imported.default;
  const fromFactory =
    typeof factory === "function" ? await factory() : (factory ?? {});
  const tools = imported.createServerTools
    ? await imported.createServerTools()
    : (imported.serverTools ?? fromFactory.serverTools ?? []);
  return { ...fromFactory, serverTools: tools };
}

export async function loadProjectPack(
  configPath: string,
  registry: SpotlightProviderRegistry = createDefaultProviderRegistry(),
): Promise<ProjectPack> {
  const raw = interpolateEnvironment(await readFile(configPath, "utf8"));
  const config = parse(raw) as ProjectConfigFile;
  if (!config?.projectId)
    throw new Error("spotlight.project.yml requires projectId");

  const imported = await loadModule(configPath, config.module);
  await imported?.registerProviders?.(registry);
  const extension = await modulePack(imported);
  const systemPrompt = config.systemPromptFile
    ? await readFile(localPath(configPath, config.systemPromptFile), "utf8")
    : config.systemPrompt;
  const uiPrompts = (await readJson(configPath, config.uiPromptsFile)) as
    Record<string, unknown> | undefined;
  const rawChannels = (await readJson(configPath, config.videoChannelsFile)) as
    | {
        videoChannels?: Array<{
          id: string;
          label?: string;
          name?: string;
          aliases?: string[];
        }>;
      }
    | Array<{ id: string; label?: string; name?: string; aliases?: string[] }>
    | undefined;
  const channelItems = Array.isArray(rawChannels)
    ? rawChannels
    : rawChannels?.videoChannels;

  const knowledgeConfig = config.providers?.knowledge;
  const webConfig = config.providers?.webSearch;
  const pack: ProjectPack = {
    ...extension,
    projectId: config.projectId,
    systemPrompt: systemPrompt ?? extension.systemPrompt,
    serverTools: extension.serverTools ?? [],
    uiPrompts: uiPrompts ?? extension.uiPrompts,
    videoChannels:
      channelItems?.map((item) => ({
        id: item.id,
        name: item.name ?? item.label ?? item.id,
        aliases: item.aliases ?? [],
      })) ?? extension.videoChannels,
    knowledgeProvider:
      (await registry.createKnowledge(knowledgeConfig)) ??
      extension.knowledgeProvider,
    webSearchProvider:
      (await registry.createWebSearch(webConfig)) ??
      extension.webSearchProvider,
  };
  for (const item of pack.serverTools) assertServerToolMetadata(item);
  return pack;
}
