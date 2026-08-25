import { describe, expect, it } from "vitest";
import { parseSpotlightSkillMarkdown } from "../src/skills/parser.js";

describe("parseSpotlightSkillMarkdown", () => {
  it("retains the workflow instruction body for remote LangGraph planning", () => {
    const skill = parseSpotlightSkillMarkdown(
      [
        "---",
        "id: skill.monitoring",
        "name: 现场监控",
        "description: 打开指定监控。",
        "allowed-tools: playVideoFullscreen",
        "tool-examples: 打开钢筋棚监控 => playVideoFullscreen",
        "---",
        "",
        "# 现场监控",
        "",
        "指定点位时调用 `playVideoFullscreen`。",
      ].join("\n"),
      ".inupedia/skills/skill.monitoring/SKILL.md",
    );

    expect(skill.skillInstructionBody).toBe(
      "# 现场监控\n\n指定点位时调用 `playVideoFullscreen`。",
    );
    expect(skill.toolExamples).toEqual([
      { example: "打开钢筋棚监控", toolName: "playVideoFullscreen" },
    ]);
  });

  it("parses Codex-style interface, dependencies and invocation policy", () => {
    const skill = parseSpotlightSkillMarkdown(
      [
        "---",
        "id: skill.monitoring",
        "description: 打开指定监控。",
        "interface:",
        "  display_name: 视频监控",
        "  brand_color: '#1677ff'",
        "dependencies:",
        "  tools:",
        "    - type: browser",
        "      value: panel.openVideo",
        "      description: 打开视频面板",
        "policy:",
        "  allow_implicit_invocation: false",
        "---",
        "执行视频监控操作。",
      ].join("\n"),
      ".inupedia/skills/skill.monitoring/SKILL.md",
    );

    expect(skill.interface).toMatchObject({
      displayName: "视频监控",
      brandColor: "#1677ff",
    });
    expect(skill.dependencies?.tools).toEqual([
      {
        type: "browser",
        value: "panel.openVideo",
        description: "打开视频面板",
        transport: undefined,
        url: undefined,
      },
    ]);
    expect(skill.policy).toEqual({ allowImplicitInvocation: false });
  });
});
