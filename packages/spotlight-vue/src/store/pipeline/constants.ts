import type { AgentStep } from "../types";

export const SPOTLIGHT_PIPELINE_STEP_IDS = {
  understand: "understand",
  gather: "gather",
  act: "act",
  answer: "answer",
  voice: "voice",
  /** @deprecated 0.5.17 thinking-bar IA; kept for old event ids */
  breakdown: "1",
  intent: "2",
  tool: "3",
  analysis: "4",
  agent: "langgraph-agent",
} as const;

export const SPOTLIGHT_PIPELINE_STEP_LABELS = {
  understand: "理解问题",
  gather: "获取信息",
  act: "操作页面",
  answer: "回答",
  voice: "生成语音",
  breakdown: "理解问题",
  intent: "理解问题",
  tool: "获取信息",
  analysis: "数据分析",
  qa: "回答",
} as const;

export function createBreakdownActiveStep(): AgentStep {
  return {
    id: SPOTLIGHT_PIPELINE_STEP_IDS.understand,
    label: SPOTLIGHT_PIPELINE_STEP_LABELS.understand,
    status: "active",
  };
}

export function createIntentActiveStep(): AgentStep {
  return {
    id: SPOTLIGHT_PIPELINE_STEP_IDS.understand,
    label: SPOTLIGHT_PIPELINE_STEP_LABELS.understand,
    status: "active",
  };
}

export function createQaActiveStep(): AgentStep {
  return {
    id: SPOTLIGHT_PIPELINE_STEP_IDS.answer,
    label: SPOTLIGHT_PIPELINE_STEP_LABELS.answer,
    status: "active",
  };
}
