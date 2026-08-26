/**
 * Legacy answer-cache types. The Spotlight Server Agent lifecycle no longer
 * writes or replays these entries; cross-session user memory lives in the
 * LangGraph Store and is recalled as bounded context after routing.
 */

export type SpotlightMemoryEntryKind =
  "qa_answer" | "action_plan" | "routing_hint" | "data_snapshot";

export type SpotlightMemoryHitSource = "exact" | "semantic" | "session";
export type SpotlightMemoryScope = "project" | "session";
export type SpotlightMemoryMatchKind = "exact" | "semantic";
export type SpotlightMemoryRecordType =
  | "answer_artifact"
  | "atomic_fact"
  | "dynamic_snapshot"
  | "candidate"
  | "operation_observation";
export type SpotlightMemoryStatus =
  "active" | "pending" | "superseded" | "invalid";
export type SpotlightMemoryEvidenceKind =
  | "knowledge"
  | "project_api"
  | "project_pack"
  | "user_confirmed"
  | "external"
  | "derived"
  | "historical";

export interface SpotlightMemoryEvidence {
  id: string;
  kind: SpotlightMemoryEvidenceKind;
  source: string;
  sourceVersion?: string;
  capturedAt: number;
  uri?: string;
}

export type SpotlightMemoryDecisionAction =
  "reuse" | "augment" | "refresh" | "ignore";

export interface SpotlightMemoryDecision {
  action: SpotlightMemoryDecisionAction;
  reasonCode: string;
  confidence: number;
  memoryIds: string[];
  sourceLabel?: string;
  verifiedAt?: number;
  canForceRefresh: boolean;
}

/** Version pins — entry invalid when context versions diverge. */
export interface SpotlightMemoryInvalidationContext {
  assetsVersion?: string | null;
  catalogVersion?: string | null;
  knowledgeIndexVersion?: string | null;
}

export interface SpotlightMemoryPlan {
  kind: "direct_plan" | "query_loop" | "command";
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  command?: Record<string, unknown>;
  skillNames?: string[];
}

/** One persisted memory row (exact jsonl or semantic sqlite). */
export interface SpotlightMemoryEntry {
  id: string;
  schemaVersion?: 2;
  projectId: string;
  scope?: SpotlightMemoryScope;
  sessionId?: string;
  recordType?: SpotlightMemoryRecordType;
  status?: SpotlightMemoryStatus;
  questionNorm: string;
  questionRaw?: string;
  kind: SpotlightMemoryEntryKind;
  /** Text answer for qa_answer / data_snapshot. */
  answer?: string;
  plan?: SpotlightMemoryPlan;
  invalidation: SpotlightMemoryInvalidationContext;
  ttlSec: number;
  createdAt: number;
  lastHitAt?: number;
  hitCount: number;
  confidence: number;
  sourceRunId?: string;
  evidence?: SpotlightMemoryEvidence[];
  sourceVersion?: string;
  verifiedAt?: number;
  supersedes?: string[];
}

export interface SpotlightMemoryLookupInput {
  projectId: string;
  question: string;
  invalidation: SpotlightMemoryInvalidationContext;
  scope?: SpotlightMemoryScope;
  sessionId?: string;
  /** Skip semantic layer (e.g. tests). */
  exactOnly?: boolean;
}

export interface SpotlightMemoryHit {
  /** @deprecated Compatibility label. Prefer matchKind + scope. */
  source: SpotlightMemoryHitSource;
  matchKind?: SpotlightMemoryMatchKind;
  scope?: SpotlightMemoryScope;
  entry: SpotlightMemoryEntry;
  confidence: number;
  lookupLatencyMs: number;
}

export interface SpotlightMemoryMiss {
  reason:
    "disabled" | "not_found" | "stale" | "below_threshold" | "kind_blocked";
  lookupLatencyMs: number;
}

export type SpotlightMemoryGateResult =
  | { hit: true; result: SpotlightMemoryHit }
  | { hit: false; miss: SpotlightMemoryMiss };

export interface SpotlightMemoryWriteInput {
  projectId: string;
  question: string;
  scope?: SpotlightMemoryScope;
  sessionId?: string;
  kind: SpotlightMemoryEntryKind;
  answer?: string;
  plan?: SpotlightMemoryPlan;
  invalidation: SpotlightMemoryInvalidationContext;
  ttlSec?: number;
  confidence: number;
  sourceRunId?: string;
  schemaVersion?: 2;
  recordType?: SpotlightMemoryRecordType;
  status?: SpotlightMemoryStatus;
  evidence?: SpotlightMemoryEvidence[];
  sourceVersion?: string;
  verifiedAt?: number;
  supersedes?: string[];
}

export interface SpotlightMemoryWriteResult {
  written: boolean;
  entryId?: string;
  skippedReason?: "below_confidence" | "kind_blocked" | "duplicate";
}

/** SSE / run meta — optional cache attribution. */
export interface SpotlightMemoryReplayMeta {
  source: SpotlightMemoryHitSource;
  matchKind?: SpotlightMemoryMatchKind;
  scope?: SpotlightMemoryScope;
  entryId: string;
  replayedAt: number;
  kind: SpotlightMemoryEntryKind;
}

/** Default TTL seconds by kind. */
export const SPOTLIGHT_MEMORY_DEFAULT_TTL_SEC: Record<
  SpotlightMemoryEntryKind,
  number
> = {
  qa_answer: 86_400,
  action_plan: 604_800,
  routing_hint: 604_800,
  data_snapshot: 1_800,
};
