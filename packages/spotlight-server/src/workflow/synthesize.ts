import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { EvidenceBundle, KnowledgeEvidence } from "../contracts.js";

const EVIDENCE_ITEM_CHARS = 1_200;

export function formatEvidenceForPrompt(items: KnowledgeEvidence[]): string {
  if (items.length === 0) return "No external evidence was gathered.";
  return items
    .map((item, index) => {
      const heading =
        item.title?.trim() || item.url?.trim() || `资料 ${index + 1}`;
      const url = item.url?.trim();
      const urlLine = url && url !== heading ? `\n${url}` : "";
      return `${index + 1}. ${heading}${urlLine}\n${item.content.trim().slice(0, EVIDENCE_ITEM_CHARS)}`;
    })
    .join("\n\n");
}

export function fallbackReplyFromEvidence(evidence: EvidenceBundle): string {
  const items = evidence.items.filter((item) => item.content.trim());
  if (items.length === 0) {
    return "已完成检索，但没有拿到足够的公开资料来回答这个问题。";
  }
  const primary = items[0]!;
  const citations = [
    ...new Set(
      items
        .slice(1)
        .map((item) => item.title?.trim() || item.url?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ].slice(0, 4);
  const body = primary.content.trim();
  if (citations.length === 0) return body;
  return `${body}\n\n参考来源：${citations.join("；")}`;
}

function messageRole(message: BaseMessage): string {
  const typed = message as BaseMessage & {
    getType?: () => string;
    _getType?: () => string;
  };
  return typed.getType?.() ?? typed._getType?.() ?? "";
}

export function buildKnowledgeSynthesizeMessages(input: {
  question: string;
  evidence: EvidenceBundle;
  sessionPrompt: string;
  projectPrompt: string;
  memoryContext: string;
  observedPrompt?: string;
  messages?: BaseMessage[];
}) {
  const evidenceContext = `Evidence bundle (${input.evidence.sufficiency}):\n${formatEvidenceForPrompt(input.evidence.items)}`;
  const conversation = (input.messages ?? []).filter((message) => {
    const role = messageRole(message);
    return role === "human" || role === "ai";
  });
  return [
    new SystemMessage(
      [
        "You are the Spotlight Knowledge synthesizer.",
        "Retrieval already finished. Do not call tools. Write the user-facing answer now.",
        "Answer informational questions using the evidence bundle. Never perform or propose a client UI action.",
        "Write in the same language as the user question. Lead with the answer, then supporting detail.",
        "Cite source titles or URLs when available. If sufficiency is none or partial, say the evidence is insufficient.",
        "Never mention internal labels such as Hikari, Tavily, untitled, or 联网检索证据.",
        "Long-term memory is user-scoped context, not evidence.",
        "The on-screen answer may include Markdown, lists, or tables. A later spoken-rewrite step will compress that for TTS; do not flatten the visual answer into slogans.",
        input.memoryContext,
        evidenceContext,
        input.observedPrompt ?? "",
        input.sessionPrompt,
        input.projectPrompt,
      ]
        .filter((block) => block.trim())
        .join("\n"),
    ),
    ...(conversation.length > 0
      ? conversation
      : [new HumanMessage(input.question)]),
  ];
}
