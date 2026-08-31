import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type {
  EvidenceBundle,
  IntentDecision,
  WorkflowLane,
} from "../contracts.js";
import {
  emptyEvidenceBundle,
  applyEvidenceUpdate,
  resetEvidenceBundle,
} from "./evidence.js";

export const INVOKED_TOOLS_TURN_RESET = "__spotlight_turn_reset__";

export const RuntimeState = Annotation.Root({
  question: Annotation<string>(),
  decision: Annotation<IntentDecision>(),
  lane: Annotation<WorkflowLane>(),
  skipGather: Annotation<boolean>(),
  skipMemoryRecall: Annotation<boolean>(),
  memoryContext: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  assistantReply: Annotation<string>(),
  voiceBriefing: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  invokedClientTools: Annotation<string[]>({
    reducer: (left, right) => {
      if (right[0] === INVOKED_TOOLS_TURN_RESET) return right.slice(1);
      return [...left, ...right];
    },
    default: () => [],
  }),
  evidenceBundle: Annotation<EvidenceBundle>({
    reducer: applyEvidenceUpdate,
    default: emptyEvidenceBundle,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

export type RuntimeStateType = typeof RuntimeState.State;

export function messageText(message: BaseMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) =>
      typeof part === "string" ? part : "text" in part ? String(part.text) : "",
    )
    .join("");
}

function isAiMessage(message: BaseMessage | undefined): boolean {
  if (!message) return false;
  if (message instanceof AIMessage) return true;
  const typed = message as BaseMessage & {
    getType?: () => string;
    _getType?: () => string;
  };
  return (typed.getType?.() ?? typed._getType?.()) === "ai";
}

function hasMessages(
  result: unknown,
): result is { messages: BaseMessage[] } {
  return Boolean(
    result &&
      typeof result === "object" &&
      Array.isArray((result as { messages?: unknown }).messages),
  );
}

/** Last non-empty AI text; skip tool results and tool-call-only AI messages. */
export function finalAgentText(
  result: BaseMessage | { messages?: BaseMessage[] } | undefined,
): string {
  if (!result) return "";
  const messages: BaseMessage[] = hasMessages(result)
    ? result.messages
    : [result as BaseMessage];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAiMessage(message)) continue;
    const text = messageText(message).trim();
    if (text) return text;
  }
  return "";
}

export function compactText(value: string, maxLength = 72): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function initialRuntimeState(
  question: string,
  messages?: BaseMessage[],
): Partial<RuntimeStateType> {
  return {
    question,
    messages: messages ?? [new HumanMessage(question)],
    invokedClientTools: [INVOKED_TOOLS_TURN_RESET],
    assistantReply: "",
    voiceBriefing: [],
    skipGather: false,
    skipMemoryRecall: false,
    memoryContext: "",
    evidenceBundle: resetEvidenceBundle(),
  };
}

export function assistantUpdate(reply: string) {
  return {
    assistantReply: reply,
    messages: [new AIMessage(reply)],
  };
}
