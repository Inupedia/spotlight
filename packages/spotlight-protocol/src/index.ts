/** Shared Spotlight protocol types (client ↔ spotlight-server). */

import type { FrontendToolManifestV1 } from "./capabilities.js";

export * from "./capabilities.js";
export * from "./capabilitySecurity.js";
export * from "./lifecycle.js";
export * from "./jsonSchema.js";
export * from "./resources.js";
export * from "./schema.js";
export * from "./toolResults.js";

export type ToolExecutionTarget = "runtime" | "host";

export interface HostToolEffect {
  type: string;
  target?: string;
  payload?: Record<string, unknown>;
}

export type AgentToolErrorCode =
  | "UNKNOWN_TOOL"
  | "HOST_TOOL_NOT_MANIFEST"
  | "CIRCULAR_DEPENDENCY"
  | "PREREQUISITE_FAILED"
  | "PRECONDITION_FAILED"
  | "TOOL_APPROVAL_REQUIRED"
  | "TOOL_INPUT_INVALID"
  | "TOOL_OUTPUT_INVALID"
  | "TOOL_RUN_FAILED"
  | "TOOL_TIMEOUT";

export interface ToolTraceEvent {
  phase: "dependency" | "context" | "execution";
  source: "executor" | "spotlight_action" | "spotlight_server";
  type: string;
  tool: string;
  detail?: string;
  at: number;
  elapsedMs: number;
}

export type AgentStepStatus = "pending" | "active" | "done" | "error";

export interface AgentStepToolCall {
  id: string;
  name: string;
  displayName?: string;
  argsText?: string;
  resultText?: string;
  summary?: string;
  errorCode?: string;
  trace?: ToolTraceEvent[];
  status: "pending" | "running" | "done" | "error";
}

export interface AgentStep {
  id: string;
  label: string;
  status: AgentStepStatus;
  content?: string;
  toolCalls?: AgentStepToolCall[];
}

export type SpotlightStepContentChannel =
  "body" | "planning" | "answer" | "tool" | "trace";

/** Host-reported UI context; keep generic for SaaS consumers. */
export type AgentUiContext = Record<string, unknown>;

export type ConversationTurn = {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  purpose?: string;
};

export interface PendingTask {
  id: string;
  type: string;
  pauseReason?: string | null;
  pausedAt?: number | null;
}

export interface SpotlightSessionInvokedSkill {
  skillName: string;
  invokedAt: number;
  args?: string;
}

export interface SpotlightSessionState {
  sessionId?: string;
  activeTaskId?: string | null;
  activeTopic?: string | null;
  pendingTask?: PendingTask | null;
  conversationSummary?: string;
  summarizedTurnCount?: number;
  conversationHistory?: ConversationTurn[];
  lastAssistantReply?: string | null;
  invokedSkills?: SpotlightSessionInvokedSkill[];
  skillPermissionGrants?: string[];
  /** 是否参考长期记忆作答；默认 true。关闭后仍可显式“记住/忘记”。 */
  memoryEnabled?: boolean;
  /** Vue 0.5.12 发送的读记忆开关，等价于 memoryEnabled。 */
  memoryReadEnabled?: boolean;
  /** 多租户命名空间（可选）。 */
  tenantId?: string;
}

export interface SpotlightRuntimeState {
  activeDomain?: string | null;
  activeTarget?: string | null;
  activeAction?: string | null;
  resumableAction?: string | null;
  lastResolvedTarget?: string | null;
  [key: string]: unknown;
}

export interface ClientToolDescriptor {
  name: string;
  displayName?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  executionTarget?: ToolExecutionTarget;
}

export type AssetType =
  | "video_channel"
  | "bim_model"
  | "device"
  | "sensor"
  | "panel"
  | "scene_target";

export type SpotlightSkillResponseStrategy =
  "direct_answer" | "tool_answer" | "clarify";

export interface SpotlightSkillToolDependency {
  type: "browser" | "server" | "mcp" | string;
  value: string;
  description?: string;
  transport?: string;
  url?: string;
}

export interface SpotlightSkillDependencies {
  tools: Array<string | SpotlightSkillToolDependency>;
}

export interface SpotlightSkillPolicy {
  allowImplicitInvocation?: boolean;
}

export interface SpotlightSkillInterface {
  displayName?: string;
  shortDescription?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  defaultPrompt?: string;
}

export interface SpotlightSkill {
  name: string;
  displayName?: string;
  description: string;
  whenToUse?: string;
  allowedTools?: string[];
  /** Codex-style capability requirements. Prefer this for new Skills. */
  dependencies?: SpotlightSkillDependencies;
  policy?: SpotlightSkillPolicy;
  interface?: SpotlightSkillInterface;
  argumentHint?: string;
  argNames?: string[];
  keywords?: string[];
  responseStrategy?: SpotlightSkillResponseStrategy;
  assetTypes?: AssetType[];
  capabilityExamples?: string[];
  /** Exact consumer examples bound to one registered tool for ambiguous sibling tools. */
  toolExamples?: Array<{ example: string; toolName: string }>;
  version?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  paths?: string[];
  executionContext?: "inline" | "fork";
  agent?: string;
  effort?: string;
  hooks?: Record<string, unknown>;
  shell?: string;
  skillPackAppendix?: string;
  skillInstructionBody?: string;
  loadedFrom?: string;
  sourcePath?: string;
  /** Skill 目录（相对项目根或绝对路径），用于 scripts/ 与占位符 */
  skillRoot?: string;
}

export function spotlightSkillToolNames(
  skill: Pick<SpotlightSkill, "allowedTools" | "dependencies">,
): string[] {
  const dependencies =
    skill.dependencies?.tools.map((tool) =>
      typeof tool === "string" ? tool : tool.value,
    ) ?? [];
  return Array.from(new Set([...dependencies, ...(skill.allowedTools ?? [])]));
}

export interface SpotlightCommandCatalogAction {
  domain: string;
  action: string;
  description: string;
}

export interface SpotlightCommandCatalogTarget {
  id: string;
  label: string;
  aliases?: string[];
}

export interface SpotlightCommandCatalogVideoChannel {
  id: string;
  label?: string;
  aliases?: string[];
}

export interface SpotlightCommandActionBinding {
  action: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}

export interface SpotlightCommandCatalog {
  actions: SpotlightCommandCatalogAction[];
  targets: SpotlightCommandCatalogTarget[];
  videoChannels?: SpotlightCommandCatalogVideoChannel[];
  domainLabels?: Record<string, string>;
  actionBindings: SpotlightCommandActionBinding[];
  scopes: string[];
  useBundledGuards?: boolean;
}

export interface CreateRunRequest {
  projectId?: string;
  sessionId?: string;
  /** Stable authenticated subject id for opt-in cross-session memory. */
  memorySubjectId?: string;
  userQuestion: string;
  /** One-shot override: bypass reusable memory and verify against sources. */
  memoryRefreshRequested?: boolean;
  uiContext?: AgentUiContext;
  sessionState?: SpotlightSessionState;
  runtimeState?: SpotlightRuntimeState;
  clientTools?: ClientToolDescriptor[];
  clientToolsManifestVersion?: string;
  /** Build-pinned browser capability manifest used by the LangGraph Action Agent. */
  clientToolManifest?: FrontendToolManifestV1;
  skills?: SpotlightSkill[];
  commandCatalog?: SpotlightCommandCatalog;
  /** Browser build id for memory invalidation (from client manifest). */
  frontendBuildId?: string;
  /** Capability snapshot negotiated by /v1/initialize. */
  capabilitySessionId?: string;
  /** Optional JSON Schema for callers that require structured final output. */
  outputSchema?: Record<string, unknown>;
  /** Bounded caller-provided context, separated by trust class. */
  additionalContext?: Record<
    string,
    import("./lifecycle.js").SpotlightAdditionalContextEntry
  >;
  policy?: import("./lifecycle.js").SpotlightTurnPolicy;
}

export interface CreateRunResponse {
  runId: string;
}

/** Codex-style turn input. The server binds it to the thread in the URL. */
export type SpotlightTurnStartRequest = Omit<
  CreateRunRequest,
  "sessionId" | "userQuestion" | "projectId"
> & {
  input: string;
  projectId?: string;
};

export interface SpotlightTurnStartResponse {
  turn: import("./lifecycle.js").SpotlightTurn;
}

export interface HostToolResultRequest {
  correlationId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  errorCode?: string;
  trace?: ToolTraceEvent[];
  /**
   * Observation taken after the handler ran. The browser piggybacks it here so
   * the runtime can refresh its view of the page without a second round trip.
   */
  uiContext?: AgentUiContext;
}

/**
 * A run is not bound to the connection that created it. `waiting_for_host` means
 * the browser went away mid-call; the run stays alive so a reconnect can resume it.
 */
export type SpotlightRunStatus =
  "running" | "waiting_for_host" | "completed" | "failed" | "cancelled";

export interface SpotlightRunSummary {
  steps: number;
  toolCalls: number;
  hostDispatches: number;
  hostRedispatches: number;
  elapsedMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  contextCharacters?: number;
  contextCompacted?: boolean;
}

export interface SpotlightActiveRun {
  runId: string;
  status: SpotlightRunStatus;
  startedAt: number;
  lastEventSeq: number;
}

export interface SpotlightHostToolsManifest {
  version: string;
  tools: Array<{
    name: string;
    displayName?: string;
    description?: string;
    executionTarget?: ToolExecutionTarget;
  }>;
}

export interface RemoteHostToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  displayName: string;
}

export interface HostToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: AgentToolErrorCode;
  trace: ToolTraceEvent[];
  executionTarget: "host";
}

export const SPOTLIGHT_CORE_TOOL_NAMES = {
  skillInvoke: "skill.invoke",
  knowledgeAnswer: "knowledge.answer",
  knowledgeSearchWeb: "knowledge.searchWeb",
} as const;

export {
  SPOTLIGHT_MEMORY_DEFAULT_TTL_SEC,
  type SpotlightMemoryDecision,
  type SpotlightMemoryDecisionAction,
  type SpotlightMemoryEntry,
  type SpotlightMemoryEntryKind,
  type SpotlightMemoryEvidence,
  type SpotlightMemoryEvidenceKind,
  type SpotlightMemoryGateResult,
  type SpotlightMemoryHit,
  type SpotlightMemoryHitSource,
  type SpotlightMemoryInvalidationContext,
  type SpotlightMemoryLookupInput,
  type SpotlightMemoryMatchKind,
  type SpotlightMemoryMiss,
  type SpotlightMemoryPlan,
  type SpotlightMemoryRecordType,
  type SpotlightMemoryReplayMeta,
  type SpotlightMemoryScope,
  type SpotlightMemoryStatus,
  type SpotlightMemoryWriteInput,
  type SpotlightMemoryWriteResult,
} from "./memory.js";

export {
  SPOTLIGHT_LAYOUT,
  SPOTLIGHT_SKILL_FRONTMATTER_KEYS,
  SPOTLIGHT_SKILL_LOAD_LEVELS,
  SPOTLIGHT_SKILLS_SERVICE_SPLIT,
  spotlightSkillsGlobPattern,
  type CapabilitySurface,
  type SpotlightServiceContract,
  type SpotlightSkillFrontmatter,
} from "./standards.js";
export {
  AGENT_SKILLS_LAYOUT,
  INUPEDIA_SHARED_SKILL_FRONTMATTER,
  INUPEDIA_SKILL_EXTENSIONS,
  INUPEDIA_SKILL_LAYOUT,
  INUPEDIA_SKILL_LOAD_MODEL,
  INUPEDIA_SKILL_PLACEHOLDERS,
  INUPEDIA_SKILLS_REFERENCE_MAP,
  INUPEDIA_SKILLS_SERVICE_MODEL,
} from "./inupediaSkillsReference.js";
