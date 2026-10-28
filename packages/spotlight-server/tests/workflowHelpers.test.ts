import type { IntentDecision } from "../src/contracts.js";
import { routeProgressSummary } from "../src/workflow/helpers.js";

describe("route progress summary", () => {
  it("labels a read-only monitoring Skill route as a query", () => {
    const decision: IntentDecision = {
      route: "action",
      confidence: 1,
      reason: "matched monitoring list query",
      requestedToolNames: ["getVideoInfo"],
      explicitActionEvidence: "skill:skill.monitoring",
      matchedSkillNames: ["skill.monitoring"],
    };
    const summary = routeProgressSummary(
      "目前 Spotlight 有哪些摄像头已配置为可播放？",
      decision,
      [
        {
          name: "getVideoInfo",
          version: "1.0.0",
          description: "查询摄像头配置",
          inputSchema: { type: "object", properties: {} },
          sideEffect: "none",
          replayPolicy: "safe",
          riskLevel: "low",
        },
      ],
    );

    expect(summary).toContain("识别为只读查询");
    expect(summary).toContain("将调用已注册的只读工具");
    expect(summary).not.toContain("页面操作");
    expect(summary).not.toContain("检测到明确动作");
  });
});
