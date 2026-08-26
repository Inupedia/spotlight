import { describe, expect, it } from "vitest";
import {
  isPersonalMemoryInspection,
  memoryControlMode,
} from "../src/safety.js";

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

  it.each([
    "你记得我上次说过什么吗",
    "你还记得我的回答风格偏好吗？",
    "我的称呼偏好是什么？",
    "Do you remember my answer preferences?",
    "What do you remember about me?",
  ])("recognizes personal-memory inspection: %s", (question) => {
    expect(isPersonalMemoryInspection(question)).toBe(true);
  });

  it.each([
    "你还记得引大济岷项目吗",
    "介绍一下记忆系统",
    "Do you remember the project overview?",
  ])("does not intercept ordinary knowledge questions: %s", (question) => {
    expect(isPersonalMemoryInspection(question)).toBe(false);
  });
});
