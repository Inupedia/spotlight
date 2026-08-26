import { SPOTLIGHT_PIPELINE_STEP_IDS } from "./constants";
import { findActiveStep } from "./steps";
import type { HandlerApi } from "./types";
import type { ToolResult } from "../../types/toolResult.js";

export function applyPipelineError(
  api: Pick<HandlerApi, "getSteps" | "setStep" | "setError">,
  msg: string,
): void {
  const current = findActiveStep(api.getSteps());
  if (current) {
    api.setStep(current.id, "error", msg);
  } else {
    api.setStep(SPOTLIGHT_PIPELINE_STEP_IDS.understand, "error", msg);
  }
  api.setError(msg);
}

export function formatToolFailure(
  result: Pick<ToolResult, "errorCode" | "error" | "trace">,
): string {
  const reasonMap: Record<NonNullable<ToolResult["errorCode"]>, string> = {
    UNKNOWN_TOOL: "系统里还没有注册这个操作",
    HOST_TOOL_NOT_MANIFEST: "该操作未在本页 host 工具清单中注册",
    CIRCULAR_DEPENDENCY: "工具依赖配置存在循环",
    PREREQUISITE_FAILED: "前置步骤执行失败",
    PRECONDITION_FAILED: "当前页面状态不满足执行条件",
    TOOL_APPROVAL_REQUIRED: "该操作需要用户明确批准",
    TOOL_INPUT_INVALID: "工具参数不完整或格式不正确",
    TOOL_OUTPUT_INVALID: "工具返回结果不符合约定格式",
    TOOL_RUN_FAILED: "工具执行时发生运行错误",
    TOOL_TIMEOUT: "工具执行超时",
  };

  const reason = result.errorCode
    ? reasonMap[result.errorCode]
    : "工具执行失败";
  const detail = result.error?.trim() || "未知错误";
  const trace = result.trace ?? [];
  const traceTail = trace.at(-1);
  const retryCount = trace.filter(
    (event) => event.type === "retry_scheduled",
  ).length;
  const rollbackApplied = trace.some(
    (event) => event.type === "rollback_applied",
  );
  const traceText = traceTail
    ? traceTail.detail
      ? `${traceTail.type}:${traceTail.tool}:${traceTail.detail}`
      : `${traceTail.type}:${traceTail.tool}`
    : null;
  const recoveryText = [
    retryCount > 0 ? `系统已自动重试 ${retryCount} 次` : null,
    rollbackApplied ? "已执行回滚清理" : null,
  ]
    .filter(Boolean)
    .join("，");
  const suffix = recoveryText ? `。恢复动作：${recoveryText}` : "";

  return traceText
    ? `${reason}：${detail}${suffix}。定位线索：${traceText}`
    : `${reason}：${detail}${suffix}`;
}
