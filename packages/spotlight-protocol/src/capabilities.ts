export const SPOTLIGHT_CAPABILITY_PROTOCOL_V1 =
  "spotlight.capabilities/1" as const;

export const CAPABILITY_ERROR_CODES_V1 = [
  "PROTOCOL_VERSION_UNSUPPORTED",
  "PROJECT_FORBIDDEN",
  "TOOL_NOT_REGISTERED",
  "TOOL_INPUT_INVALID",
  "TOOL_OUTPUT_INVALID",
  "TOOL_TIER_UNSUPPORTED",
  "RESOURCE_MIME_UNSUPPORTED",
  "HOST_OFFLINE",
  "HOST_ACTION_TIMEOUT",
] as const;

export type CapabilityErrorCodeV1 = (typeof CAPABILITY_ERROR_CODES_V1)[number];
export type JsonSchemaV1 = Record<string, unknown>;
export type ToolExecutionTargetV1 = "browser" | "server" | "mcp";
export type ToolSideEffectV1 = "none" | "ui" | "external";
export type ToolReplayPolicyV1 = "safe" | "idempotency-key" | "never";
export type ToolRiskLevelV1 = "low" | "medium" | "high";

/**
 * The single enforced capability dimension, ordered by what the runtime must
 * guarantee before a call may be dispatched.
 *
 * - `observe`  read browser/UI state. No network, no mutation, replay-safe.
 * - `query`    read a business backend. Idempotent, replay-safe.
 * - `navigate` change UI state. Locally reversible, replay-safe.
 * - `mutate`   change an external system. NOT replay-safe.
 *
 * Everything below `mutate` can simply be re-dispatched when a result is lost,
 * which is why the runtime needs no acknowledgement or reconciliation protocol
 * for those tiers. `mutate` is gated at registration until one exists; see
 * `docs/design/capability-protocol-v2.md`.
 */
export const TOOL_TIERS_V1 = [
  "observe",
  "query",
  "navigate",
  "mutate",
] as const;

export type ToolTierV1 = (typeof TOOL_TIERS_V1)[number];

export function toolTierRank(tier: ToolTierV1): number {
  return TOOL_TIERS_V1.indexOf(tier);
}

export function isToolTierReplaySafe(tier: ToolTierV1): boolean {
  return tier !== "mutate";
}

export interface CapabilityProtocolErrorV1 {
  error: {
    code: CapabilityErrorCodeV1;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export interface FrontendToolDescriptorV1 {
  name: string;
  /** Logical capability namespace used for grouping and deferred discovery. */
  namespace?: string;
  /** Keep the full schema out of the default action surface until its Skill is selected. */
  deferLoading?: boolean;
  version: string;
  description: string;
  inputSchema: JsonSchemaV1;
  outputSchema?: JsonSchemaV1;
  maxOutputBytes?: number;
  /** Authoritative capability tier. Derived from the legacy fields when absent. */
  tier?: ToolTierV1;
  sideEffect: ToolSideEffectV1;
  replayPolicy: ToolReplayPolicyV1;
  riskLevel?: ToolRiskLevelV1;
  requiresConfirmation?: boolean;
  /** Optional resource semantics understood by the generic Spotlight router. */
  resource?: {
    namespace: string;
    operation: "search" | "get" | "action";
    action?: string;
    inputKey?: string;
  };
}

/**
 * Resolve a descriptor's tier, falling back to the pre-tier fields so manifests
 * built by an older frontend keep working.
 */
export function deriveToolTier(descriptor: {
  tier?: ToolTierV1;
  sideEffect?: ToolSideEffectV1;
  replayPolicy?: ToolReplayPolicyV1;
  riskLevel?: ToolRiskLevelV1;
  requiresConfirmation?: boolean;
}): ToolTierV1 {
  if (descriptor.tier) return descriptor.tier;
  if (descriptor.sideEffect === "external") return "mutate";
  if (descriptor.riskLevel === "high" || descriptor.requiresConfirmation) {
    return "mutate";
  }
  if (descriptor.sideEffect === "none") {
    return descriptor.replayPolicy === "safe" ? "query" : "navigate";
  }
  return "navigate";
}

/** Build-pinned browser tool manifest. Handlers never leave the browser bundle. */
export interface FrontendToolManifestV1 {
  protocolVersion: typeof SPOTLIGHT_CAPABILITY_PROTOCOL_V1;
  projectId: string;
  frontendBuildId: string;
  manifestDigest: string;
  tools: FrontendToolDescriptorV1[];
}

export interface ResolvedToolRefV1 {
  target: ToolExecutionTargetV1;
  registryId: string;
  name: string;
  version: string;
}
