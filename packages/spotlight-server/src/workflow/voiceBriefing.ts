import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { messageText } from "./state.js";

const DEFAULT_MAX_SENTENCES = 5;
const SENTENCE_END = /[。！？!?；;\n]/u;

function normalizeSentence(raw: string): string {
  const text = raw
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/gu, "$1")
    .replace(
      /^\s*(?:(?:\d+|[一二三四五六七八九十]+)[、.．)）]|[-*•])\s*/u,
      "",
    )
    .replace(/\s+/gu, " ")
    .replace(/[；;]$/u, "。")
    .trim();
  if (!text) return "";
  return /[。！？!?]$/u.test(text) ? text : `${text}。`;
}

export function fallbackVoiceBriefing(
  answer: string,
  maxSentences = DEFAULT_MAX_SENTENCES,
): string[] {
  const plain = answer
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/gu, "$1")
    .replace(/[#>*_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return plain
    .match(/[^。！？!?；;\n]+[。！？!?；;]?/gu)
    ?.map(normalizeSentence)
    .filter(Boolean)
    .slice(0, maxSentences) ?? [];
}

function takeCompletedSentences(
  buffer: string,
  remaining: number,
): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  while (sentences.length < remaining) {
    const index = rest.search(SENTENCE_END);
    if (index < 0) break;
    const sentence = normalizeSentence(rest.slice(0, index + 1));
    rest = rest.slice(index + 1);
    if (sentence) sentences.push(sentence);
  }
  return { sentences, rest };
}

export async function streamVoiceBriefing(input: {
  model: BaseChatModel;
  question: string;
  answer: string;
  config?: LangGraphRunnableConfig;
  maxSentences?: number;
  onSentence?: (sentence: { index: number; text: string }) => void;
}): Promise<string[]> {
  const maxSentences = Math.min(
    8,
    Math.max(1, Math.round(input.maxSentences ?? DEFAULT_MAX_SENTENCES)),
  );
  const emitted: string[] = [];
  let buffer = "";

  try {
    const stream = await input.model.stream(
      [
        new SystemMessage(
          [
            "你是 Spotlight 数字人的口播编辑。",
            "把完整文字回答压缩成自然、口语化、适合直接朗读的短句。",
            "只输出口播正文，每行一句，不要标题、序号、Markdown、工具名或过程说明。",
            "保留结论、关键数字、风险和必要的下一步；禁止编造。",
            `最多 ${maxSentences} 句，每句建议 12 到 36 个汉字。`,
          ].join("\n"),
        ),
        new HumanMessage(
          `用户问题：${input.question}\n\n完整文字回答：\n${input.answer.slice(0, 8_000)}`,
        ),
      ],
      input.config,
    );

    for await (const chunk of stream) {
      buffer += messageText(chunk);
      const completed = takeCompletedSentences(
        buffer,
        maxSentences - emitted.length,
      );
      buffer = completed.rest;
      for (const text of completed.sentences) {
        const sentence = { index: emitted.length, text };
        emitted.push(text);
        input.onSentence?.(sentence);
      }
      if (emitted.length >= maxSentences) break;
    }

    if (emitted.length < maxSentences) {
      const tail = normalizeSentence(buffer);
      if (tail) {
        const sentence = { index: emitted.length, text: tail };
        emitted.push(tail);
        input.onSentence?.(sentence);
      }
    }
  } catch {
    // A voice presentation failure must not discard the authoritative answer.
  }

  if (emitted.length > 0) return emitted;
  const fallback = fallbackVoiceBriefing(input.answer, maxSentences);
  fallback.forEach((text, index) => input.onSentence?.({ index, text }));
  return fallback;
}
