import type {
  ConversationTurn,
  CreateRunRequest,
} from "@inupedia/spotlight-protocol";
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";

const REFERENTIAL_PATTERN =
  /(?:刚才|刚刚|上次|之前|那个|这个|它|继续|再来|再帮我|再说一遍|同一个|上一条|上一)/u;

export interface SessionContext {
  summaryText: string;
  recentTurnsText: string;
  fullContextText: string;
  isReferential: boolean;
  lastAssistantReply: string | null;
  historyMessages: BaseMessage[];
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function summarizeTurn(turn: ConversationTurn): string {
  const roleLabel =
    turn.role === "user"
      ? "用户"
      : turn.role === "assistant"
        ? "助手"
        : "工具";
  return `${roleLabel}：${truncate(turn.content, 120)}`;
}

export function buildSessionContext(request: CreateRunRequest): SessionContext {
  const session = request.sessionState ?? {};
  const summary = session.conversationSummary?.trim() ?? "";
  const summarizedCount = session.summarizedTurnCount ?? 0;
  const recentTurns = (session.conversationHistory ?? []).slice(-6);
  const lastAssistant =
    session.lastAssistantReply?.trim() ||
    recentTurns
      .slice()
      .reverse()
      .find((turn) => turn.role === "assistant")
      ?.content?.trim() ||
    null;

  const summaryText = summary
    ? `历史摘要（已压缩 ${summarizedCount} 条）：\n${summary}`
    : "";
  const recentTurnsText = recentTurns.length
    ? `最近对话：\n${recentTurns.map(summarizeTurn).join("\n")}`
    : "";
  const fullContextText = [summaryText, recentTurnsText]
    .concat(
      Object.entries(request.additionalContext ?? {}).map(([name, entry]) =>
        `${entry.kind === "untrusted" ? "Untrusted" : "Application"} context (${name}):\n${entry.value}`,
      ),
    )
    .filter(Boolean)
    .join("\n\n");

  const historyMessages: BaseMessage[] = [];
  for (const turn of recentTurns.slice(-4)) {
    const content = turn.content?.trim();
    if (!content) continue;
    if (turn.role === "user") {
      historyMessages.push(new HumanMessage(content));
    } else if (turn.role === "assistant") {
      historyMessages.push(new AIMessage(content));
    }
  }

  return {
    summaryText,
    recentTurnsText,
    fullContextText,
    isReferential: REFERENTIAL_PATTERN.test(request.userQuestion),
    lastAssistantReply: lastAssistant,
    historyMessages,
  };
}

export function buildRouterContextPayload(
  session: SessionContext,
  observedState?: string,
) {
  return {
    isReferential: session.isReferential,
    lastAssistantReply: session.lastAssistantReply,
    conversationContext: session.fullContextText || undefined,
    observedState,
  };
}

export function sessionContextPromptBlock(session: SessionContext): string {
  if (!session.fullContextText) return "";
  return [
    "Conversation context from the browser session (not verified evidence):",
    session.fullContextText,
    session.isReferential
      ? "The latest user message may refer to the previous turn. Resolve targets from this context before routing or acting."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function initialMessagesForRun(
  question: string,
  session: SessionContext,
  checkpointMessageCount: number,
): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (checkpointMessageCount === 0 && session.historyMessages.length > 0) {
    messages.push(...session.historyMessages);
  }
  messages.push(new HumanMessage(question));
  return messages;
}
