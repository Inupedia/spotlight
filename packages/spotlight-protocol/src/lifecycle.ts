import type {
  FrontendToolManifestV1,
  ToolExecutionTargetV1,
  ToolSideEffectV1,
} from "./capabilities.js";

/** Stable application protocol between a Spotlight client and app server. */
export const SPOTLIGHT_APP_PROTOCOL_V1 = "spotlight.app/1" as const;

export type SpotlightClientTransport = "sse" | "websocket";

export interface SpotlightClientInfo {
  name: string;
  version: string;
  title?: string;
}

export interface SpotlightClientCapabilities {
  transports: SpotlightClientTransport[];
  itemTypes: SpotlightItem["type"][];
  toolResultSubmission: boolean;
  reconnectFromSequence: boolean;
}

export interface SpotlightSkillRegistration {
  name: string;
  displayName?: string;
  description: string;
  version?: string;
  allowImplicitInvocation?: boolean;
  userInvocable?: boolean;
  dependencies?: {
    tools?: Array<string | { type: string; value: string; description?: string }>;
  };
}

export interface SpotlightInitializeRequest {
  protocolVersion: typeof SPOTLIGHT_APP_PROTOCOL_V1;
  projectId: string;
  clientInfo: SpotlightClientInfo;
  capabilities: SpotlightClientCapabilities;
  toolManifest: FrontendToolManifestV1;
  skills?: SpotlightSkillRegistration[];
  /** Full consumer Skill definitions captured once for subsequent Turns. */
  skillDefinitions?: import("./index.js").SpotlightSkill[];
}

export interface SpotlightCapabilitySession {
  id: string;
  projectId: string;
  manifestDigest: string;
  createdAt: number;
  expiresAt: number;
}

export type SpotlightCapabilityRuntimeStatus =
  | "ready"
  | "missing"
  | "unsupported"
  | "disabled";

export interface SpotlightToolRuntimeState {
  name: string;
  target: ToolExecutionTargetV1;
  status: SpotlightCapabilityRuntimeStatus;
  reason?: string;
}

export interface SpotlightSkillRuntimeState {
  name: string;
  status: SpotlightCapabilityRuntimeStatus;
  missingTools: string[];
  allowImplicitInvocation: boolean;
  reason?: string;
}

export interface SpotlightInitializeResponse {
  protocolVersion: typeof SPOTLIGHT_APP_PROTOCOL_V1;
  serverInfo: {
    name: "@inupedia/spotlight-server";
    version: string;
    runtime: "langchain-langgraph";
  };
  projectId: string;
  acceptedManifestDigest: string;
  capabilitySession: SpotlightCapabilitySession;
  capabilities: {
    transports: SpotlightClientTransport[];
    cancellation: true;
    threadResume: true;
    eventReplay: true;
  };
  tools: SpotlightToolRuntimeState[];
  skills: SpotlightSkillRuntimeState[];
}

export type SpotlightThreadStatus = "idle" | "running" | "closed";

export interface SpotlightThread {
  id: string;
  projectId: string;
  status: SpotlightThreadStatus;
  createdAt: number;
  updatedAt?: number;
  archivedAt?: number;
}

export interface SpotlightThreadStartRequest {
  projectId: string;
  /** Supplying a stable id resumes the same server-side conversation. */
  threadId?: string;
}

export interface SpotlightThreadStartResponse {
  thread: SpotlightThread;
}

export type SpotlightTurnStatus =
  | "queued"
  | "in_progress"
  | "waiting_for_client"
  | "completed"
  | "failed"
  | "interrupted";

export interface SpotlightTurn {
  id: string;
  threadId: string;
  status: SpotlightTurnStatus;
  startedAt: number;
  completedAt?: number;
}

export type SpotlightApprovalMode = "never" | "on_risk" | "always";

export interface SpotlightTurnPolicy {
  approvalMode?: SpotlightApprovalMode;
  approvedToolNames?: string[];
  deniedToolNames?: string[];
}

export interface SpotlightAdditionalContextEntry {
  value: string;
  kind: "application" | "untrusted";
}

export type SpotlightItemStatus =
  | "in_progress"
  | "waiting_for_client"
  | "completed"
  | "failed";

interface SpotlightItemBase {
  id: string;
  status: SpotlightItemStatus;
  startedAt: number;
  completedAt?: number;
}

export interface SpotlightReasoningItem extends SpotlightItemBase {
  type: "reasoning";
  category: "routing" | "planning" | "memory" | "voice" | "progress";
  summary: string;
}

export interface SpotlightSkillUseItem extends SpotlightItemBase {
  type: "skill_use";
  skill: string;
  displayName: string;
  source: "model" | "user" | "router";
  summary?: string;
}

export interface SpotlightToolCallItem extends SpotlightItemBase {
  type: "tool_call";
  tool: string;
  displayName: string;
  target: ToolExecutionTargetV1;
  arguments: Record<string, unknown>;
  sideEffect?: ToolSideEffectV1;
  /** Present only while the browser must execute the call. */
  clientRequest?: {
    correlationId: string;
    dispatch: number;
    approvalRequired?: boolean;
    approvalReason?: string;
  };
  summary?: string;
  result?: unknown;
  error?: {
    code?: string;
    message: string;
    retryable: boolean;
  };
  trace?: unknown[];
}

export interface SpotlightKnowledgeSearchItem extends SpotlightItemBase {
  type: "knowledge_search";
  tool: string;
  displayName: string;
  provider: string;
  query: string;
  source: "knowledge" | "web";
  resultCount?: number;
  summary?: string;
  result?: unknown;
}

export interface SpotlightMemoryItem extends SpotlightItemBase {
  type: "memory";
  /** @deprecated Legacy answer-cache decision item. */
  action: "reuse" | "augment" | "refresh" | "ignore";
  summary: string;
  entryIds: string[];
}

export interface SpotlightAgentMessageItem extends SpotlightItemBase {
  type: "agent_message";
  text: string;
}

/** One complete, speakable sentence emitted by the LangGraph voice node. */
export interface SpotlightVoiceSentenceItem extends SpotlightItemBase {
  type: "voice_sentence";
  index: number;
  text: string;
}

export interface SpotlightErrorItem extends SpotlightItemBase {
  type: "error";
  message: string;
  code?: string;
}

export type SpotlightItem =
  | SpotlightReasoningItem
  | SpotlightSkillUseItem
  | SpotlightToolCallItem
  | SpotlightKnowledgeSearchItem
  | SpotlightMemoryItem
  | SpotlightAgentMessageItem
  | SpotlightVoiceSentenceItem
  | SpotlightErrorItem;

interface SpotlightEventBase {
  at: number;
  seq: number;
  threadId: string;
  turnId: string;
}

export type SpotlightTurnEvent =
  | (SpotlightEventBase & { type: "turn.started"; turn: SpotlightTurn })
  | (SpotlightEventBase & { type: "item.started"; item: SpotlightItem })
  | (SpotlightEventBase & { type: "item.updated"; item: SpotlightItem })
  | (SpotlightEventBase & { type: "item.completed"; item: SpotlightItem })
  | (SpotlightEventBase & {
      type: "turn.completed";
      turn: SpotlightTurn;
      finalResponse: string;
      summary: {
        items: number;
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
      };
      metadata?: Record<string, unknown>;
    })
  | (SpotlightEventBase & {
      type: "turn.failed";
      turn: SpotlightTurn;
      error: { message: string; code?: string };
    })
  | (SpotlightEventBase & { type: "ping" });

export function defaultSpotlightClientCapabilities(): SpotlightClientCapabilities {
  return {
    transports: ["sse"],
    itemTypes: [
      "reasoning",
      "skill_use",
      "tool_call",
      "knowledge_search",
      "memory",
      "agent_message",
      "voice_sentence",
      "error",
    ],
    toolResultSubmission: true,
    reconnectFromSequence: true,
  };
}
