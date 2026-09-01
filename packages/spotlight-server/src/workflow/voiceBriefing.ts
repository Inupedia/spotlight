import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
  packSpokenSentences,
  sanitizeSpokenText,
  stripMarkdownForSpeech,
} from "@inupedia/spotlight-protocol";
import type { WorkflowLane } from "../contracts.js";
import { finalAgentText } from "./state.js";
import {
  SPOKEN_BRIEFING_SKILL_BODY,
  SPOKEN_BRIEFING_SKILL_NAME,
} from "./spokenBriefingSkill.js";

const DEFAULT_MAX_SENTENCES = 5;
const ANSWER_CHARS = 3_500;
const TTS_PIPE = /[|｜│¦]/u;

function laneInstruction(lane: WorkflowLane | undefined): string {
  if (lane === "action" || lane === "knowledge_then_action") {
    return "本轮是页面操作。口播只汇报动作结果，不要把工具输出表格读出来。";
  }
  if (lane === "clarify") {
    return "本轮需要用户补充信息。用一句口语把要问的问题说清楚。";
  }
  if (lane === "memory_mutate") {
    return "本轮是记忆管理。用一句口语确认记住了或忘记了什么。";
  }
  return "本轮是知识问答。口播只讲结论，不要读证据列表。";
}

function parseSpokenJson(raw: string): string[] {
  const match = raw.match(/\{[\s\S]*\}/u);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { sentences?: unknown };
    if (!Array.isArray(parsed.sentences)) return [];
    return parsed.sentences
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text.trim() : "";
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function finishSpokenPhrase(text: string): string {
  const cleaned = sanitizeSpokenText(text);
  if (!cleaned || TTS_PIPE.test(cleaned)) return "";
  return /[。！？!?]$/u.test(cleaned) ? cleaned : `${cleaned}。`;
}

function finishSpokenPhrases(phrases: string[], maxSentences: number): string[] {
  return packSpokenSentences(
    phrases.map(finishSpokenPhrase).filter(Boolean).join(""),
    { maxSentences },
  );
}

export function fallbackVoiceBriefing(
  answer: string,
  maxSentences = DEFAULT_MAX_SENTENCES,
): string[] {
  return finishSpokenPhrases(
    packSpokenSentences(answer, { maxSentences }),
    maxSentences,
  );
}

export function streamSpokenPhrasesFromAnswer(input: {
  answer: string;
  maxPhrases?: number;
  onSentence?: (sentence: {
    index: number;
    text: string;
    generation?: number;
  }) => void;
}): string[] {
  const phrases = fallbackVoiceBriefing(
    input.answer,
    input.maxPhrases ?? DEFAULT_MAX_SENTENCES,
  );
  phrases.forEach((text, index) => {
    input.onSentence?.({ index, text, generation: 0 });
  });
  return phrases;
}

export async function rewriteSpokenBriefing(input: {
  model: BaseChatModel;
  question: string;
  answer: string;
  lane?: WorkflowLane;
  invokedClientTools?: string[];
  maxSentences?: number;
  config?: LangGraphRunnableConfig;
  onSentence?: (sentence: {
    index: number;
    text: string;
    generation?: number;
  }) => void;
}): Promise<string[]> {
  const maxSentences = Math.min(
    8,
    Math.max(1, input.maxSentences ?? DEFAULT_MAX_SENTENCES),
  );
  const sanitizedAnswer = sanitizeSpokenText(input.answer).slice(0, ANSWER_CHARS);
  const tools = (input.invokedClientTools ?? []).filter(Boolean);
  const userPrompt = [
    `强制遵循运行时技能 ${SPOKEN_BRIEFING_SKILL_NAME}。`,
    laneInstruction(input.lane),
    `用户问题：${input.question.trim()}`,
    tools.length > 0 ? `本轮已执行的页面工具：${tools.join("、")}` : "本轮没有执行页面工具。",
    "屏幕完整回答已转成口播依据（禁止把表格符号读出来）：",
    sanitizedAnswer || "这一轮没有可以朗读的文字结论。",
    `请输出最多 ${maxSentences} 句口播 JSON。`,
  ].join("\n");

  let rewritten: string[] = [];
  if (sanitizedAnswer) {
    try {
      const result = await input.model.invoke(
        [
          new SystemMessage(
            `${SPOKEN_BRIEFING_SKILL_BODY}\n最多输出 ${maxSentences} 句。`,
          ),
          new HumanMessage(userPrompt),
        ],
        input.config,
      );
      rewritten = parseSpokenJson(finalAgentText(result));
    } catch {
      rewritten = [];
    }
  }

  const phrases = finishSpokenPhrases(
    rewritten.length > 0 ? rewritten : fallbackVoiceBriefing(input.answer, maxSentences),
    maxSentences,
  );

  phrases.forEach((text, index) => {
    input.onSentence?.({ index, text, generation: 0 });
  });
  return phrases;
}

/** Kept for tests of the non-LLM splitter. */
export async function streamVoiceBriefing(input: {
  question: string;
  answer: string;
  config?: LangGraphRunnableConfig;
  maxSentences?: number;
  onSentence?: (sentence: {
    index: number;
    text: string;
    generation?: number;
  }) => void;
}): Promise<string[]> {
  void input.question;
  void input.config;
  return streamSpokenPhrasesFromAnswer({
    answer: input.answer,
    maxPhrases: input.maxSentences,
    onSentence: input.onSentence,
  });
}

export { sanitizeSpokenText, stripMarkdownForSpeech };
