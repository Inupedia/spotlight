import { describe, expect, it } from "vitest";
import { actionReplyFromToolOutput } from "../src/workflow/helpers.js";

const actionTool = {
  name: "playVideoFullscreen",
  version: "1.0.0",
  description: "播放用户指定的视频监控",
  inputSchema: { type: "object" as const },
  sideEffect: "ui" as const,
  replayPolicy: "never" as const,
  riskLevel: "low" as const,
};

describe("actionReplyFromToolOutput", () => {
  it("preserves an action's explicit user-facing result", () => {
    expect(
      actionReplyFromToolOutput(
        actionTool,
        "视频监控“钢筋棚加工区”已停用，本次未打开画面。",
      ),
    ).toBe("视频监控“钢筋棚加工区”已停用，本次未打开画面。");
  });

  it("unwraps the client result envelope before replying", () => {
    expect(
      actionReplyFromToolOutput(
        actionTool,
        JSON.stringify({
          success: true,
          content: [
            {
              type: "text",
              text: "视频监控“钢筋棚加工区”已停用，本次未打开画面。",
            },
          ],
          data: "视频监控“钢筋棚加工区”已停用，本次未打开画面。",
        }),
      ),
    ).toBe("视频监控“钢筋棚加工区”已停用，本次未打开画面。");
  });

  it("keeps the existing name-based reply for actions without a string result", () => {
    expect(
      actionReplyFromToolOutput(actionTool, { name: "施工支洞洞口" }),
    ).toBe("已为您打开施工支洞洞口。");
  });
});
