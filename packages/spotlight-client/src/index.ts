export type { SpotlightClientConfig } from "./http.js";
export {
  CLIENT_TOOL_META,
  createClientToolManifest,
  createClientToolRegistry,
  defineClientTool,
  getClientToolDescriptor,
  type ClientTool,
  type ClientToolHandler,
  type ClientToolOptions,
  type ClientToolSchemaOverride,
  type GeneratedClientToolMeta,
} from "./clientTool.js";
export {
  appendProjectQuery,
  buildJsonHeaders,
  createSpotlightHttp,
  normalizeServerUrl,
  resolveSpotlightClientConfig,
  SpotlightHttpError,
  type SpotlightHttp,
} from "./http.js";
export {
  fetchDefaultCommandCatalog,
  mergeCommandCatalogs,
  serializeSkillsForRemote,
} from "./host.js";
export {
  validateSkillFrontmatter,
  describeCapabilitySurface,
  SPOTLIGHT_LAYOUT,
  SPOTLIGHT_SKILL_LOAD_LEVELS,
  spotlightSkillsGlobPattern,
  type SkillValidationResult,
  type SpotlightSkillFrontmatter,
} from "./skillServiceStandard.js";
export {
  substituteSkillPlaceholders,
  executeInlineShellInMarkdown,
  prepareSkillMarkdownContent,
} from "./skillPrompt.js";
export {
  joinSkillScriptPath,
  type SkillScriptRunResult,
} from "./skillScriptPath.js";
export * from "./appClient.js";
