export type { SpotlightClientConfig } from "./http.js";
export {
  CLIENT_TOOL_META,
  createClientToolManifest,
  createClientToolRegistry,
  defineClientTool,
  defineTool,
  getClientToolDescriptor,
  type ClientTool,
  type ClientToolHandler,
  type ClientToolOptions,
  type ClientToolSchemaOverride,
  type GeneratedClientToolMeta,
  type DefineToolOptions,
  SpotlightToolValidationError,
} from "./clientTool.js";
export {
  defineResourceProvider,
  type SpotlightResourceAction,
  type SpotlightResourceProvider,
  type SpotlightResourceProviderOptions,
} from "./resourceProvider.js";
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
export type {
  SpotlightResourceRef,
  SpotlightResourceSearchInput,
  SpotlightResourceSearchResult,
  SpotlightResourceStatus,
  SpotlightToolResultEnvelope,
  SpotlightContentItem,
} from "@inupedia/spotlight-protocol";
