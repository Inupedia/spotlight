import {
  deriveToolTier,
  isToolTierReplaySafe,
  type CreateRunRequest,
  type FrontendToolDescriptorV1,
  type ToolTierV1,
} from "@inupedia/spotlight-protocol";
import type { IntentDecision } from "./contracts.js";
import { attachKnowledgeSource } from "./knowledgeSource.js";

const INFORMATION_PATTERNS = [
  /(?:介绍|说明|讲讲|了解|什么是|是什么|资料|概况|情况|知识|为什么|如何理解)/u,
  /(?:查询|哪些|多少|几个|几路|几人|几台|状态|数据|统计|清单|列表|进度|完成率)/u,
  /(?:introduce|explain|what is|tell me about|overview)/iu,
];

const ACTION_PATTERNS = [
  /(?:打开|关闭|播放|暂停|跳转|进入|退出|返回|开始|停止|继续|恢复|开启|切换|定位|显示|隐藏|查看|巡检)/u,
  /(?:open|close|play|pause|navigate|enter|exit|return|start|stop|resume|enable|switch|show|hide|view)/iu,
];

const MEMORY_CONTROL_PATTERNS = [
  /(?:记住|记得|忘记|别再记|删除.*记忆)/u,
  /(?:remember|forget|delete.*memory)/iu,
];

const UNRESOLVED_TOOL_INPUT_PLACEHOLDERS = new Set([
  "?",
  "？",
  "unknown",
  "undefined",
  "null",
  "n/a",
  "na",
  "tbd",
  "todo",
  "placeholder",
  "<unknown>",
  "<required>",
  "待定",
  "待确认",
  "未知",
  "未提供",
  "不详",
]);

const UNRESOLVED_TOOL_INPUT_EXPLANATIONS = [
  /^(?:需要|需)(?:用户)?(?:提供|指定|选择|确认|补充)/u,
  /^请(?:用户)?(?:提供|指定|选择|确认|补充)/u,
  /^(?:未|尚未)(?:提供|指定|选择|确认|补充)/u,
  /^缺少/u,
  /^待(?:提供|指定|选择|确认|补充)/u,
  /^(?:please\s+)?(?:provide|specify|select|confirm|supply)\b/iu,
  /^(?:need|needs|requires?)\b.*\b(?:provide|specify|select|confirm|supply)\b/iu,
  /^(?:missing|required\s+but\s+missing|not\s+provided|not\s+specified|not\s+selected)\b/iu,
];

export function hasInformationEvidence(question: string): boolean {
  return INFORMATION_PATTERNS.some((pattern) => pattern.test(question));
}

export function extractActionEvidence(question: string): string | null {
  for (const pattern of ACTION_PATTERNS) {
    const match = question.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

export function hasMemoryControlEvidence(question: string): boolean {
  return MEMORY_CONTROL_PATTERNS.some((pattern) => pattern.test(question));
}

export function isMemoryReadEnabled(request: CreateRunRequest): boolean {
  if (request.memoryRefreshRequested === true) return false;
  const session = request.sessionState as
    | (CreateRunRequest["sessionState"] & { memoryReadEnabled?: unknown })
    | undefined;
  if (!session) return true;
  if (typeof session.memoryEnabled === "boolean") return session.memoryEnabled;
  if (typeof session.memoryReadEnabled === "boolean") {
    return session.memoryReadEnabled;
  }
  return true;
}

export function memoryControlMode(
  question: string,
): "remember" | "forget" | null {
  if (/(?:忘记|别再记|删除.*记忆|forget|delete.*memory)/iu.test(question))
    return "forget";
  if (/(?:记住|记得|remember)/iu.test(question)) return "remember";
  return null;
}

function hasUnresolvedToolInputPlaceholder(
  value: unknown,
  question: string,
): boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const normalized = trimmed.toLocaleLowerCase();
    if (UNRESOLVED_TOOL_INPUT_PLACEHOLDERS.has(normalized)) return true;

    const looksLikeExplanation = UNRESOLVED_TOOL_INPUT_EXPLANATIONS.some(
      (pattern) => pattern.test(trimmed),
    );
    if (!looksLikeExplanation) return false;

    // A legitimate business value may itself begin with words such as "需要".
    // Treat it as grounded when the exact value appears in the user's message;
    // otherwise fail closed because it is likely the model explaining a missing
    // argument instead of supplying one.
    return !question.includes(trimmed);
  }
  if (Array.isArray(value)) {
    return value.some((item) =>
      hasUnresolvedToolInputPlaceholder(item, question),
    );
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      hasUnresolvedToolInputPlaceholder(item, question),
    );
  }
  return false;
}

function skillMatchedAction(decision: IntentDecision): boolean {
  return (
    decision.route === "action" &&
    Array.isArray(decision.matchedSkillNames) &&
    decision.matchedSkillNames.length > 0
  );
}

export function applyIntentSafetyFence(
  question: string,
  decision: IntentDecision,
): IntentDecision {
  const actionEvidence = extractActionEvidence(question);
  if (hasMemoryControlEvidence(question)) {
    return attachKnowledgeSource(question, {
      route: "knowledge",
      confidence: 1,
      reason: "The latest user message explicitly controls personal memory.",
      requestedToolNames: [],
      explicitActionEvidence: null,
      matchedSkillNames: decision.matchedSkillNames,
    });
  }
  if (
    decision.route === "action" &&
    hasUnresolvedToolInputPlaceholder(decision.requestedToolInput, question)
  ) {
    return {
      ...decision,
      route: "clarify",
      reason:
        "The selected client tool contains an unresolved placeholder or an explanatory substitute instead of a concrete argument.",
      requestedToolNames: [],
      requestedToolInput: undefined,
      explicitActionEvidence:
        actionEvidence ?? decision.explicitActionEvidence ?? null,
    };
  }
  const skillAction = skillMatchedAction(decision);
  const skillKnowledge =
    decision.route === "knowledge" &&
    Array.isArray(decision.matchedSkillNames) &&
    decision.matchedSkillNames.length > 0;
  if (
    hasInformationEvidence(question) &&
    !actionEvidence &&
    !skillAction &&
    !skillKnowledge
  ) {
    return attachKnowledgeSource(question, {
      route: "knowledge",
      confidence: Math.max(decision.confidence, 0.99),
      reason:
        "The user explicitly requested information and supplied no action verb.",
      requestedToolNames: [],
      explicitActionEvidence: null,
      matchedSkillNames: [],
    });
  }
  if (
    decision.route === "action" &&
    !skillAction &&
    (!actionEvidence || decision.confidence < 0.9)
  ) {
    return {
      route: "clarify",
      confidence: decision.confidence,
      reason: actionEvidence
        ? "Action confidence is below the execution threshold."
        : "No explicit action evidence was found in the latest user message.",
      requestedToolNames: [],
      explicitActionEvidence: actionEvidence,
      matchedSkillNames: decision.matchedSkillNames,
    };
  }
  const resolvedEvidence =
    actionEvidence ??
    decision.explicitActionEvidence ??
    (skillAction ? `skill:${decision.matchedSkillNames!.join(",")}` : null);
  return attachKnowledgeSource(question, {
    ...decision,
    explicitActionEvidence: resolvedEvidence,
  });
}

export function clientToolTier(tool: FrontendToolDescriptorV1): ToolTierV1 {
  return deriveToolTier(tool);
}

/** Mutations are accepted only when explicitly marked for confirmation. */
export function isDispatchableClientTool(
  tool: FrontendToolDescriptorV1,
): boolean {
  return isToolTierReplaySafe(clientToolTier(tool)) || tool.requiresConfirmation === true;
}

export class UnsupportedToolTierError extends Error {
  constructor(readonly tools: Array<{ name: string; tier: ToolTierV1 }>) {
    super(
      [
        `Cannot register ${tools.length} capability(ies) at the "mutate" tier: ${tools
          .map((tool) => tool.name)
          .join(", ")}.`,
        "A mutate capability changes an external system, so a lost result is not safely replayable.",
        "The runtime has no call ledger, no acknowledgement channel and no reconciliation slot to make that safe.",
        "See docs/design/capability-protocol-v2.md for what must be built first.",
      ].join(" "),
    );
    this.name = "UnsupportedToolTierError";
  }
}

/**
 * Registration-time gate. Non-replayable Tools must be explicit approval
 * boundaries; the runtime dispatches those at most once.
 */
export function assertRegisterableClientTools(
  tools: readonly FrontendToolDescriptorV1[],
): void {
  const rejected = tools
    .filter((tool) =>
      !isToolTierReplaySafe(clientToolTier(tool)) &&
      tool.requiresConfirmation !== true,
    )
    .map((tool) => ({ name: tool.name, tier: clientToolTier(tool) }));
  if (rejected.length > 0) throw new UnsupportedToolTierError(rejected);
}

export function actionToolAllowlist(
  tools: FrontendToolDescriptorV1[],
  decision: IntentDecision,
): FrontendToolDescriptorV1[] {
  if (decision.route !== "action") return [];
  const hasSkillMatch =
    Array.isArray(decision.matchedSkillNames) &&
    decision.matchedSkillNames.length > 0;
  const hasActionEvidence = decision.explicitActionEvidence != null;
  if (!hasSkillMatch && !hasActionEvidence) return [];
  const requested = new Set(decision.requestedToolNames);
  const filterTool = (tool: FrontendToolDescriptorV1) => {
    if (!isDispatchableClientTool(tool)) return false;
    if (requested.size > 0) return requested.has(tool.name);
    if (hasSkillMatch) return false;
    return true;
  };
  return tools.filter(filterTool);
}

export function assertServerToolMetadata(tool: {
  name: string;
  metadata?: unknown;
}): void {
  const metadata = tool.metadata as Record<string, unknown> | undefined;
  if (
    !metadata ||
    !["knowledge", "web", "project"].includes(String(metadata.domain)) ||
    !["read", "write", "external"].includes(String(metadata.effect)) ||
    !["low", "medium", "high"].includes(String(metadata.risk))
  ) {
    throw new Error(
      `Server tool ${tool.name} must declare valid domain/effect/risk metadata`,
    );
  }
}
