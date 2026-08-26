import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import {
  buildRouterContextPayload,
  buildSessionContext,
  initialMessagesForRun,
  sessionContextPromptBlock,
} from "../src/workflow/sessionContext.js";

describe("sessionContext", () => {
  it("builds conversation context from browser session state", () => {
    const session = buildSessionContext({
      userQuestion: "刚才那个监控再放大",
      sessionState: {
        conversationSummary: "用户：有哪些监控\n助手：共 12 路",
        summarizedTurnCount: 2,
        conversationHistory: [
          {
            role: "user",
            content: "有哪些监控",
            timestamp: 1,
            purpose: "main_task",
          },
          {
            role: "assistant",
            content: "项目共有 12 路监控。",
            timestamp: 2,
            purpose: "main_task",
          },
        ],
        lastAssistantReply: "项目共有 12 路监控。",
      },
    });

    expect(session.isReferential).toBe(true);
    expect(session.fullContextText).toContain("有哪些监控");
    expect(session.lastAssistantReply).toContain("12 路");
    expect(sessionContextPromptBlock(session)).toContain("refer");
    expect(buildRouterContextPayload(session).conversationContext).toContain(
      "最近对话",
    );
  });

  it("hydrates checkpoint only when thread is empty", () => {
    const session = buildSessionContext({
      userQuestion: "第二条",
      sessionState: {
        conversationHistory: [
          { role: "user", content: "第一条", timestamp: 1 },
          { role: "assistant", content: "回复一", timestamp: 2 },
        ],
      },
    });

    const coldStart = initialMessagesForRun("第二条", session, 0);
    expect(coldStart.map((m) => m.getType())).toEqual([
      "human",
      "ai",
      "human",
    ]);

    const warmThread = initialMessagesForRun("第二条", session, 4);
    expect(warmThread).toEqual([new HumanMessage("第二条")]);
  });
});
