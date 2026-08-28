import type { App, InjectionKey } from "vue";
import {
  createClientToolManifest,
  createClientToolRegistry,
  createSpotlightAppClient,
  createSpotlightHttp,
  type ClientTool,
  type SpotlightAppClient,
  type SpotlightHttp,
} from "@inupedia/spotlight-client";
import {
  defineSpotlightConfig,
  SPOTLIGHT_CONFIG_KEY,
  type SpotlightConfig,
  type SpotlightVuePluginOptions,
} from "./config.js";
import {
  mountSpotlightShell,
  unmountSpotlightShellForTests,
} from "./mountShell.js";
import type { SpotlightAvatarConfig } from "./avatar/config.js";

export const SPOTLIGHT_HTTP_KEY: InjectionKey<SpotlightHttp> =
  Symbol("spotlight-http");
export type SpotlightClientToolRegistry = ReturnType<
  typeof createClientToolRegistry
>;
export const SPOTLIGHT_CLIENT_TOOLS_KEY: InjectionKey<SpotlightClientToolRegistry> =
  Symbol("spotlight-client-tools");
export const SPOTLIGHT_APP_CLIENT_KEY: InjectionKey<SpotlightAppClient> =
  Symbol("spotlight-app-client");

let installedConfig: SpotlightConfig | null = null;
let installedHttp: SpotlightHttp | null = null;
let installedClientTools: SpotlightClientToolRegistry | null = null;
let installedAppClient: SpotlightAppClient | null = null;

export function getSpotlightConfig(): SpotlightConfig {
  if (!installedConfig) {
    throw new Error(
      "Spotlight is not installed. Call app.use(SpotlightVue, { config }) in main.ts",
    );
  }
  return installedConfig;
}

export function getSpotlightHttp(): SpotlightHttp {
  if (!installedHttp) {
    const config = getSpotlightConfig();
    installedHttp = createSpotlightHttp(config);
  }
  return installedHttp;
}

export function getSpotlightClientTools(): SpotlightClientToolRegistry {
  if (!installedClientTools) {
    const config = getSpotlightConfig();
    const tools = [
      ...(typeof config.tools === "function"
        ? config.tools()
        : (config.tools ?? [])),
      ...(typeof config.resources === "function"
        ? config.resources()
        : (config.resources ?? [])
      ).flatMap((resource) => resource.tools),
    ];
    installedClientTools = createClientToolRegistry(tools as ClientTool[]);
  }
  return installedClientTools;
}

export function getSpotlightAppClient(): SpotlightAppClient {
  if (!installedAppClient) {
    throw new Error(
      "Spotlight App Client is not initialized. Call app.use(SpotlightVue, { config })",
    );
  }
  return installedAppClient;
}

/** Reset singletons (tests / HMR). */
export function resetSpotlightRuntimeForTests(): void {
  unmountSpotlightShellForTests();
  installedConfig = null;
  installedHttp = null;
  installedClientTools = null;
  installedAppClient = null;
}

export const SpotlightVue = {
  install(appValue: unknown, options: SpotlightVuePluginOptions): void {
    const app = appValue as App;
    const config = defineSpotlightConfig(
      "config" in options && options.config ? options.config : options,
    );
    const directTools =
      typeof config.tools === "function"
        ? config.tools()
        : (config.tools ?? []);
    const resolvedResources =
      typeof config.resources === "function"
        ? config.resources()
        : (config.resources ?? []);
    const resolvedTools = [
      ...directTools,
      ...resolvedResources.flatMap((resource) => resource.tools),
    ];
    if (!Array.isArray(resolvedTools) || resolvedTools.length === 0) {
      throw new Error(
        "Spotlight config: at least one client tool is required after tools() resolves",
      );
    }
    installedConfig = config;
    installedHttp = createSpotlightHttp(config);
    installedClientTools = createClientToolRegistry(resolvedTools);
    const frontendBuildId = config.frontendBuildId?.trim() || "development";
    installedAppClient = createSpotlightAppClient({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      projectId: config.projectId,
      clientInfo: {
        name: "spotlight-vue",
        title: "Spotlight Vue",
        version: "0.8.5",
      },
      toolManifest: () =>
        createClientToolManifest({
          projectId: config.projectId,
          frontendBuildId,
          tools: resolvedTools,
        }),
      skills: () => {
        const skills =
          config.getSkillsForRun?.() ??
          (typeof config.skills === "function"
            ? config.skills()
            : config.skills) ??
          [];
        return [
          ...skills,
          ...resolvedResources.flatMap((resource) =>
            resource.skill ? [resource.skill] : [],
          ),
        ];
      },
    });

    app.provide(SPOTLIGHT_CONFIG_KEY, config);
    app.provide(SPOTLIGHT_HTTP_KEY, installedHttp);
    app.provide(SPOTLIGHT_CLIENT_TOOLS_KEY, installedClientTools);
    app.provide(SPOTLIGHT_APP_CLIENT_KEY, installedAppClient);

    app.config.globalProperties.$spotlightEnabled = options.enabled !== false;
    app.config.globalProperties.$spotlightAvatarEnabled =
      options.avatarEnabled === true;

    mountSpotlightShell(app, options);
  },
};

export {
  defineSpotlightConfig,
  SPOTLIGHT_CONFIG_KEY,
  type SpotlightConfig,
  type SpotlightVuePluginOptions,
  type SpotlightAvatarConfig,
};
