import { describe, expect, it } from "vitest";
import { memoryControlMode } from "../src/safety.js";

describe("memoryControlMode", () => {
  it.each([
    ["记住我偏好简洁回答", "remember"],
    ["以后记得用中文回答", "remember"],
    ["忘记我的回答风格偏好", "forget"],
    ["please remember that I prefer concise answers", "remember"],
  ] as const)("recognizes explicit control: %s", (question, expected) => {
    expect(memoryControlMode(question)).toBe(expected);
  });

  it.each([
    "你记得我上次说过什么吗",
    "你还记得引大济岷项目吗",
    "Do you remember our last conversation?",
    "介绍一下记忆系统",
  ])("does not mutate memory for recall questions: %s", (question) => {
    expect(memoryControlMode(question)).toBeNull();
  });
});
