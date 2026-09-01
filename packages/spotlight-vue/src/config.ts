import type {
  AgentUiContext,
  SpotlightCommandCatalog,
  SpotlightCommandCatalogVideoChannel,
  SpotlightSkill,
} from "@inupedia/spotlight-protocol";
import type {
  ClientTool,
  SpotlightClientConfig,
  SpotlightResourceProvider,
} from "@inupedia/spotlight-client";
import type { SpotlightUiPrompts } from "./remote/meta.js";
import type { ToolResult } from "./types/toolResult.js";

export type SpotlightConfig = SpotlightClientConfig & {
  /** Browser tools registered with defineClientTool(). */
  tools?: ClientTool[] | (() => ClientTool[]);
  /** Large dynamic business catalogs exposed through generated Resource Tools. */
  resources?: SpotlightResourceProvider[] | (() => SpotlightResourceProvider[]);
  /** Immutable frontend build identifier used to bind the production manifest. */
  frontendBuildId?: string;
  /** Consumer-owned Skills sent to the server for LangGraph planning. */
  skills?: SpotlightSkill[] | (() => SpotlightSkill[]);
  /** Preferred: host resolves bundled + inline skills per run. */
  getSkillsForRun?: () => SpotlightSkill[];
  /** Optional dynamic catalog overlay (e.g. live video channels). */
  catalogOverlay?: () => SpotlightCommandCatalog | null | undefined;
  /** Optional static video channel metadata for catalog merge / meta fallback. */
  videoChannels?: SpotlightCommandCatalogVideoChannel[];
  /** Called when video channel meta is loaded from server or fallback. */
  onVideoChannelsLoaded?: (
    channels: SpotlightCommandCatalogVideoChannel[],
  ) => void;
  /** Bundled ui-prompts when server meta is unavailable. */
  uiPromptsFallback?: SpotlightUiPrompts;
  /** Per-run UI context reported to server. */
  getUiContext?: () => AgentUiContext;
  /** Stable authenticated subject id. Omit to disable cross-session memory. */
  getMemorySubjectId?: () => string | null | undefined;
  /** Required for high-risk or external-state Tools unless pre-approved by Turn policy. */
  approveTool?: (request: {
    name: string;
    displayName: string;
    input: Record<string, unknown>;
    reason?: string;
  }) => boolean | Promise<boolean>;
  /** Optional UI-only quick actions. */
  quickPanelActions?: SpotlightQuickPanelActions;
  /** Override suggested question chips (defaults use server ui-prompts). */
  getSuggestedQuestions?: (params: {
    sceneLevel: number | null | undefined;
    smallTab?: string | null;
    activeTarget?: string | null;
  }) => string[];
};

export type SpotlightQuickPanelActions = {
  triggerProgressAction?: () => Promise<ToolResult<void>>;
  triggerSimulationProgressAction?: () => Promise<ToolResult<void>>;
};

/** Validate a flat Client Tool configuration. */
export function defineSpotlightConfig(input: SpotlightConfig): SpotlightConfig {
  const config = input;
  if (!config.projectId?.trim()) {
    throw new Error("Spotlight config: projectId is required");
  }
  if (!config.serverUrl?.trim()) {
    throw new Error("Spotlight config: serverUrl is required");
  }
  if (!config.tools && !config.resources) {
    throw new Error("Spotlight config: tools or resources are required");
  }
  if (config.tools && typeof config.tools !== "function") {
    const tools = config.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error(
        "Spotlight config: tools must not be empty when provided",
      );
    }
  }
  return config;
}

export const SPOTLIGHT_CONFIG_KEY = Symbol("spotlight-config");

import type { SpotlightAvatarConfig } from "./avatar/config.js";
import type { SpotlightVoiceConfig } from "@inupedia/spotlight-protocol";

export type SpotlightVueUiOptions = {
  /** Mount command panel + thinking UI (default: true). */
  enabled?: boolean;
  /** Enable digital-human overlay, ⌘/Ctrl+L, and answer TTS (default: false). */
  avatarEnabled?: boolean;
  /** Avatar copy + Spine asset paths (when avatarEnabled). */
  avatar?: SpotlightAvatarConfig;
  /** HTTP speech (STT/TTS). Independent of the LLM provider. */
  voice?: SpotlightVoiceConfig;
};

/** `app.use(SpotlightVue, config)` is preferred; nested config remains source-compatible. */
export type SpotlightVuePluginOptions =
  | (SpotlightVueUiOptions & { config: SpotlightConfig })
  | (SpotlightConfig & SpotlightVueUiOptions & { config?: never });
