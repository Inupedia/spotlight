import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import {
  fallbackVoiceBriefing,
  rewriteSpokenBriefing,
  streamVoiceBriefing,
} from "../src/workflow/voiceBriefing.js";

describe("voice phrase splitting", () => {
  it("packs the same-turn answer on sentence boundaries", async () => {
    const onSentence = vi.fn();
    const sentences = await streamVoiceBriefing({
      question: "介绍一下项目",
      answer: "第一句已经可以播放。第二句分成两段输出！最后一句",
      onSentence,
    });

    expect(sentences).toEqual([
      "第一句已经可以播放。第二句分成两段输出！最后一句。",
    ]);
    expect(onSentence.mock.calls.map(([sentence]) => sentence)).toEqual([
      {
        index: 0,
        generation: 0,
        text: "第一句已经可以播放。第二句分成两段输出！最后一句。",
      },
    ]);
  });

  it("falls back to bounded spoken sentences without reading tables", async () => {
    expect(fallbackVoiceBriefing("第一点。第二点！第三点？", 2)).toEqual([
      "第一点。第二点！第三点？",
    ]);
    expect(fallbackVoiceBriefing("# 标题\n[结论](https://example.com)。")).toEqual([
      "标题 结论。",
    ]);
    expect(
      fallbackVoiceBriefing("| 名称 | 值 |\n| --- | --- |\n| 钢筋棚 | 打开 |\n建设程序已经打开。"),
    ).toEqual(["名称是钢筋棚，值是打开。建设程序已经打开。"]);
    expect(
      fallbackVoiceBriefing("| 阶段 | 状态 |\n| --- | --- |\n| 可研 | 进行中 |").join(""),
    ).not.toMatch(/[|｜│¦]/u);
  });
});

describe("spoken rewrite", () => {
  it("uses the model JSON and does not speak the visual table", async () => {
    const onSentence = vi.fn();
    const model = {
      invoke: vi.fn(async () =>
        new AIMessage('{"sentences":["建设程序已经打开。","现在可以看到可研阶段。"]}'),
      ),
    };

    const phrases = await rewriteSpokenBriefing({
      model: model as never,
      question: "打开建设程序",
      answer: "| 阶段 | 状态 |\n| --- | --- |\n| 可研 | 进行中 |\n前端操作已执行。",
      lane: "action",
      invokedClientTools: ["openProjectProcedure"],
      onSentence,
    });

    expect(model.invoke).toHaveBeenCalledOnce();
    const messages = (model.invoke.mock.calls[0] as unknown as [Array<{ content: string }>])[0];
    expect(messages[0]?.content).toContain("vertical bar");
    expect(messages[1]?.content).not.toMatch(/[|｜│¦]/u);
    expect(phrases).toEqual(["建设程序已经打开。现在可以看到可研阶段。"]);
    expect(onSentence).toHaveBeenCalledTimes(1);
  });

  it("falls back to packed sentences when the model does not return JSON", async () => {
    const model = {
      invoke: vi.fn(async () => new AIMessage("not json")),
    };
    const phrases = await rewriteSpokenBriefing({
      model: model as never,
      question: "介绍项目",
      answer: "引大济岷是跨流域调水工程。先看总览再看建设程序。",
      lane: "knowledge",
    });
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases.every((text) => /[。！？!?]$/u.test(text))).toBe(true);
  });

  it("sanitizes table markdown if the model echoes pipes", async () => {
    const model = {
      invoke: vi.fn(async () =>
        new AIMessage('{"sentences":["| 阶段 | 状态 |","可研进行中"]}'),
      ),
    };
    const phrases = await rewriteSpokenBriefing({
      model: model as never,
      question: "打开建设程序",
      answer: "| 阶段 | 状态 |\n| --- | --- |\n| 可研 | 进行中 |",
      lane: "action",
    });
    expect(phrases.join("")).not.toMatch(/[|｜│¦]/u);
    expect(phrases.length).toBeGreaterThan(0);
  });

  it("merges two-character LLM crumbs into one TTS clip", async () => {
    const model = {
      invoke: vi.fn(async () =>
        new AIMessage('{"sentences":["好。","已。","打开建设程序。"]}'),
      ),
    };
    const phrases = await rewriteSpokenBriefing({
      model: model as never,
      question: "打开建设程序",
      answer: "建设程序已经打开。",
      lane: "action",
    });
    expect(phrases).toEqual(["好。已。打开建设程序。"]);
    expect(phrases.every((text) => text.length >= 8)).toBe(true);
  });
});
