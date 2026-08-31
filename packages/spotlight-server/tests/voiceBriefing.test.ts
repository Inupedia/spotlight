import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import {
  fallbackVoiceBriefing,
  streamVoiceBriefing,
} from "../src/workflow/voiceBriefing.js";

describe("voice briefing", () => {
  it("emits complete sentences while the model output is still streaming", async () => {
    const onSentence = vi.fn();
    const model = {
      async *stream() {
        yield new AIMessageChunk("第一句已经可以播放。");
        yield new AIMessageChunk("第二句分成");
        yield new AIMessageChunk("两段输出！最后一句");
      },
    } as unknown as BaseChatModel;

    const sentences = await streamVoiceBriefing({
      model,
      question: "介绍一下项目",
      answer: "一份很长的完整回答。",
      onSentence,
    });

    expect(sentences).toEqual([
      "第一句已经可以播放。",
      "第二句分成两段输出！",
      "最后一句。",
    ]);
    expect(onSentence.mock.calls.map(([sentence]) => sentence)).toEqual([
      { index: 0, text: "第一句已经可以播放。" },
      { index: 1, text: "第二句分成两段输出！" },
      { index: 2, text: "最后一句。" },
    ]);
  });

  it("falls back to bounded plain sentences without losing the text answer", async () => {
    const model = {
      async *stream(): AsyncGenerator<AIMessageChunk> {
        throw new Error("voice model unavailable");
      },
    } as unknown as BaseChatModel;

    await expect(
      streamVoiceBriefing({
        model,
        question: "问题",
        answer: "第一点。第二点！第三点？",
        maxSentences: 2,
      }),
    ).resolves.toEqual(["第一点。", "第二点！"]);
    expect(fallbackVoiceBriefing("# 标题\n[结论](https://example.com)。")).toEqual([
      "标题 结论。",
    ]);
    expect(fallbackVoiceBriefing("一共有三个关键点。二、先确认现场。"))
      .toEqual(["一共有三个关键点。", "先确认现场。"]);
  });
});
