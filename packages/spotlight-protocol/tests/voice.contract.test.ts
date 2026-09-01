import { describe, expect, it, vi } from "vitest";
import {
  VoiceTurnController,
  createSpokenPhraseSink,
  drainSpokenClips,
  packSpokenSentences,
  padSpokenTextForTts,
  sanitizeSpokenText,
  splitSpokenPhrases,
  takeSpokenPhrases,
} from "../src/voice.js";

describe("spoken phrase splitting", () => {
  it("keeps commas inside a sentence and packs short clauses", () => {
    expect(
      splitSpokenPhrases("# 标题\n[结论](https://example.com)，第二句。第三点！"),
    ).toEqual(["标题 结论，第二句。第三点！"]);
  });

  it("does not emit at commas while the sentence is still open", () => {
    const first = takeSpokenPhrases("现场已经打开，正在");
    expect(first.phrases).toEqual([]);
    expect(first.rest).toBe("现场已经打开，正在");
    const second = takeSpokenPhrases(`${first.rest}确认钢筋棚。尾巴`);
    expect(second.phrases).toEqual(["现场已经打开，正在确认钢筋棚。"]);
    expect(second.rest).toBe("尾巴");
  });

  it("turns markdown tables into spoken rows and never leaves pipes", () => {
    expect(
      packSpokenSentences(
        "| 项目 | 长度 |\n| --- | --- |\n| 引大济岷 | 300 |\n已经打开建设程序。",
      ),
    ).toEqual(["项目是引大济岷，长度是300。已经打开建设程序。"]);
    expect(
      packSpokenSentences(
        "| 阶段 | 状态 |\n| --- | --- |\n| 可研 | 进行中 |",
      ).join(""),
    ).not.toMatch(/[|｜│¦]/u);
    expect(packSpokenSentences("阶段 | 状态 | 可研").join("")).toBe(
      "阶段，状态，可研。",
    );
    expect(
      sanitizeSpokenText("| 阶段 | 状态 |\n| --- | --- |\n| 可研 | 进行中 |"),
    ).toBe("阶段是可研，状态是进行中。");
    expect(padSpokenTextForTts("建设程序已经打开。")).toBe(
      "建设程序已经打开。……",
    );
    expect(padSpokenTextForTts("已经打开")).toBe("已经打开。……");
    expect(padSpokenTextForTts("已经打开……")).toBe("已经打开……");
  });

  it("does not emit two-character clips when more spoken text follows", () => {
    expect(packSpokenSentences("好。已。打开建设程序。")).toEqual([
      "好。已。打开建设程序。",
    ]);
    expect(
      packSpokenSentences("第一句已经可以播放。第二句分成两段输出！最后一句"),
    ).toEqual(["第一句已经可以播放。第二句分成两段输出！最后一句。"]);
    expect(drainSpokenClips("好。已。")).toEqual({
      ready: [],
      rest: "好。已。",
    });
    expect(drainSpokenClips("好。已。打开建设程序。", { force: true })).toEqual({
      ready: ["好。已。打开建设程序。"],
      rest: "",
    });
  });

  it("finishes with the leftover buffer when the stream ends", () => {
    const phrases: string[] = [];
    const live = createSpokenPhraseSink({
      onPhrase: (phrase) => phrases.push(phrase.text),
    });
    live.push("一共有三个关键点，");
    live.push("先确认现场");
    live.finish();
    expect(phrases).toEqual(["一共有三个关键点，先确认现场。"]);
  });

  it("starts a new generation after reset so stale phrases can be dropped", () => {
    const phrases: Array<{ index: number; generation: number; text: string }> = [];
    const sink = createSpokenPhraseSink({
      onPhrase: (phrase) => phrases.push(phrase),
    });
    sink.push("失败的半句，");
    sink.reset();
    sink.finish("重新生成的完整回答。");
    expect(phrases).toEqual([
      { index: 0, generation: 1, text: "重新生成的完整回答。" },
    ]);
  });
});

describe("VoiceTurnController", () => {
  it("aborts every registered resource once", async () => {
    const controller = new VoiceTurnController();
    controller.setPhase("listening");
    controller.setPhase("speaking");
    const cancelled: string[] = [];
    controller.onAbort(async () => {
      cancelled.push("tts");
    });
    controller.onAbort(() => {
      cancelled.push("turn");
    });
    controller.onAbort(() => {
      cancelled.push("lipsync");
    });

    await controller.abort("barge_in");
    await controller.abort("barge_in");

    expect(controller.phase).toBe("interrupted");
    expect(cancelled).toEqual(["tts", "turn", "lipsync"]);
  });

  it("runs abort handlers even when one rejects", async () => {
    const controller = new VoiceTurnController();
    const later = vi.fn();
    controller.onAbort(() => {
      throw new Error("tts failed");
    });
    controller.onAbort(later);
    await controller.abort("escape");
    expect(later).toHaveBeenCalledWith("escape");
  });
});
