import type {
  HostToolEffect,
  SpotlightMemoryDecision,
  SpotlightRunStatus,
  SpotlightRunSummary,
  SpotlightTurnEvent,
  SpotlightToolCallItem,
  SpotlightKnowledgeSearchItem,
  ToolSideEffectV1,
} from "@inupedia/spotlight-protocol";
import { useAgentSessionStore } from "../session/agentSession.js";
import { useSpotlightMemoryPreferenceStore } from "../store/memoryPreferenceStore.js";
import { useSpotlightRuntimeStore } from "../store/runtimeStore.js";
import { SPOTLIGHT_PIPELINE_STEP_IDS } from "../store/pipeline/constants.js";
import {
  isLoopPlanningChunk,
  splitIntentStepContent,
} from "../store/pipeline/displayText.js";
import {
  resolveToolLane,
  toolLaneStepId,
  toolLaneStepLabel,
} from "../store/pipeline/toolLane.js";
import type { HandlerApi } from "../store/pipeline/types.js";
import type { AgentStep, AgentStepToolCall } from "../store/types.js";
import type { SpotlightExecutionEvent } from "../store/runtime/types.js";
import { getSpotlightAppClient, getSpotlightConfig } from "../plugin.js";
import {
  ensureHostToolsManifest,
  executeRemoteHostTool,
} from "./hostToolRunner.js";
import {
  buildSpotlightJsonHeaders,
  getSpotlightProjectId,
  getSpotlightServerBase,
} from "./httpConfig.js";
import { ensureSpotlightMeta } from "./meta.js";
import type { SpotlightPipelineRunOutcome } from "./types.js";

const activeRunBySignal = new WeakMap<AbortSignal, string>();

type RemoteRunEvent =
  | SpotlightExecutionEvent
  | {
      type: "host_action_request";
      at: number;
      iteration: number;
      request: {
        correlationId: string;
        call: {
          id: string;
          name: string;
          input: Record<string, unknown>;
          displayName: string;
        };
        hostEffect?: HostToolEffect;
        /** >1 means the server is re-sending this call after a lost connection. */
        dispatch?: number;
      };
    }
  | {
      type: "run_status";
      at: number;
      runId: string;
      status: SpotlightRunStatus;
      detail?: string;
    }
  | {
      type: "run_completed";
      at: number;
      runId: string;
      turnId: string;
      assistantReply: string | null;
      commandName: string | null;
      stopReason: string;
      failureClass: string | null;
      elapsedMs: number;
      summary?: SpotlightRunSummary;
      memoryReplay?: {
        source: "exact" | "semantic" | "session";
        entryId: string;
        replayedAt: number;
        kind: string;
      };
      memoryDecision?: SpotlightMemoryDecision;
      sessionPatch?: Partial<
        import("@inupedia/spotlight-protocol").SpotlightSessionState
      >;
    }
  | {
      type: "memory_decision";
      at: number;
      turnId: string;
      decision: SpotlightMemoryDecision;
    }
  | {
      type: "run_error";
      at: number;
      runId: string;
      error: string;
    }
  | {
      type: "ping";
      at: number;
    }
  | {
      type: "skill_permission_request";
      at: number;
      skillName: string;
      displayName?: string;
      reason: string;
      source: "model" | "user-slash";
    }
  | {
      type: "fork_progress";
      at: number;
      agentId: string;
      iteration: number;
      phase: "plan" | "tool_execution" | "respond";
      summary: string;
    }
  | {
      type: "assistant_response";
      at: number;
      iteration: number;
      content: string;
    }
  | {
      type: "agent_memory_updated";
      at: number;
      projectId: string;
      tenantId?: string;
      action: "remember" | "forget";
      slug?: string;
      reason?: string;
    };

function isTelemetryEvent(
  event: RemoteRunEvent,
): event is SpotlightExecutionEvent {
  return (
    event.type !== "host_action_request" &&
    event.type !== "run_completed" &&
    event.type !== "run_error" &&
    event.type !== "run_status" &&
    event.type !== "ping" &&
    event.type !== "memory_decision"
  );
}

function ensureStep(api: HandlerApi, id: string, label: string): AgentStep {
  const existing = api.getSteps().find((step) => step.id === id);
  if (existing) return existing;
  const next: AgentStep = { id, label, status: "pending" };
  api.setSteps([...api.getSteps(), next]);
  return next;
}

function paintYield(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function formatEvidenceOutput(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const blocks = output.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const content =
      typeof record.content === "string" ? record.content.trim() : "";
    if (!content) return [];
    const title =
      (typeof record.title === "string" && record.title.trim()) ||
      (typeof record.url === "string" && record.url.trim()) ||
      `资料 ${index + 1}`;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    return [[title, url && url !== title ? url : "", content].filter(Boolean).join("\n")];
  });
  return blocks.join("\n\n");
}

function formatHostToolResultText(
  result: Extract<RemoteRunEvent, { type: "tool_result" }>["result"],
): string {
  const evidenceText = formatEvidenceOutput(result.output);
  if (evidenceText) return evidenceText;
  const summary = result.summary?.trim();
  if (
    summary &&
    summary.length > 48 &&
    !summary.startsWith("{") &&
    !summary.startsWith("[")
  ) {
    return summary;
  }
  if (result.output != null && typeof result.output === "object") {
    try {
      const payload = JSON.stringify(result.output, null, 2);
      if (payload && payload !== "{}") return payload;
    } catch {
      // fall through
    }
  }
  return summary || "";
}

function buildToolResultCall(
  event: Extract<RemoteRunEvent, { type: "tool_result" }>,
): AgentStepToolCall {
  const resultText = formatHostToolResultText(event.result);
  return {
    id: event.result.call.id,
    name: event.result.call.name,
    displayName: event.result.call.displayName,
    argsText: JSON.stringify(event.result.call.input ?? {}, null, 2),
    resultText,
    summary: event.result.summary,
    errorCode: event.result.errorCode,
    trace: event.result.trace,
    status: event.result.success ? "done" : "error",
  };
}

function toolCallFromRemote(
  event: Extract<RemoteRunEvent, { type: "tool_start" }>,
): AgentStepToolCall {
  return {
    id: event.call.id,
    name: event.call.name,
    displayName: event.call.displayName,
    argsText: JSON.stringify(event.call.input ?? {}, null, 2),
    status: "running",
  };
}

function toolCallFromHostAction(
  call: Extract<
    RemoteRunEvent,
    { type: "host_action_request" }
  >["request"]["call"],
  result: Awaited<ReturnType<typeof executeRemoteHostTool>>,
): AgentStepToolCall {
  const resultText = result.success
    ? "前端操作已执行。"
    : result.error || "前端操作执行失败。";
  return {
    id: call.id,
    name: call.name,
    displayName: call.displayName,
    argsText: JSON.stringify(call.input ?? {}, null, 2),
    resultText,
    summary: resultText,
    errorCode: result.errorCode,
    trace: result.trace,
    status: result.success ? "done" : "error",
  };
}

export type ToolLaneLookup = {
  sideEffectByName?: ReadonlyMap<string, ToolSideEffectV1>;
};

function laneForTool(name: string, lookup?: ToolLaneLookup): "gather" | "act" {
  return resolveToolLane(name, lookup?.sideEffectByName?.get(name));
}

function completeStepIfPresent(
  api: HandlerApi,
  id: string,
  fallbackContent?: string,
) {
  const step = api.getSteps().find((item) => item.id === id);
  if (!step || step.status === "done" || step.status === "error") return;
  api.setStep(id, "done", step.content ?? fallbackContent);
}

function activateLaneStep(api: HandlerApi, lane: "gather" | "act") {
  completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.understand);
  const stepId = toolLaneStepId(lane);
  const label = toolLaneStepLabel(lane);
  ensureStep(api, stepId, label);
  const step = api.getSteps().find((item) => item.id === stepId);
  if (!step || step.status === "active" || step.status === "done") return;
  api.setStep(stepId, "active", step.content);
}

function ensureLaneForTool(
  api: HandlerApi,
  name: string,
  lookup?: ToolLaneLookup,
): string {
  const lane = laneForTool(name, lookup);
  activateLaneStep(api, lane);
  return toolLaneStepId(lane);
}

export function beginHostToolCall(
  api: HandlerApi,
  call: Extract<
    RemoteRunEvent,
    { type: "host_action_request" }
  >["request"]["call"],
  lookup?: ToolLaneLookup,
) {
  const stepId = ensureLaneForTool(api, call.name, lookup);
  api.appendToolCallsToStep(stepId, [
    {
      id: call.id,
      name: call.name,
      displayName: call.displayName,
      argsText: JSON.stringify(call.input ?? {}, null, 2),
      status: "running",
    },
  ]);
}

export function settleHostToolCall(
  api: HandlerApi,
  call: Extract<
    RemoteRunEvent,
    { type: "host_action_request" }
  >["request"]["call"],
  result: Awaited<ReturnType<typeof executeRemoteHostTool>>,
  lookup?: ToolLaneLookup,
) {
  const stepId = ensureLaneForTool(api, call.name, lookup);
  api.appendToolCallsToStep(stepId, [toolCallFromHostAction(call, result)]);
}

function toolStepLabel(
  stepId: string,
  label: string | null | undefined,
): string {
  if (label) return label;
  if (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.gather) return "获取信息";
  if (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.act) return "操作页面";
  if (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.answer) return "回答";
  if (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.understand) return "理解问题";
  if (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.tool) return "获取信息";
  return stepId;
}

export function responseStepLabel(_api?: HandlerApi): string {
  return "回答";
}

function setTransitionStep(
  api: HandlerApi,
  id: string,
  label: string,
  status: AgentStep["status"],
  content: string,
) {
  ensureStep(api, id, label);
  api.setStep(id, status, content);
}

export function applyLangGraphTransition(
  api: HandlerApi,
  event: Extract<SpotlightExecutionEvent, { type: "turn_transition" }>,
) {
  const summary = event.summary?.trim();
  switch (event.phase) {
    case "routing":
    case "analyzing":
      setTransitionStep(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.understand,
        "理解问题",
        "active",
        summary ?? "正在分析用户意图。",
      );
      return;
    case "router_done":
      setTransitionStep(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.understand,
        "理解问题",
        "done",
        summary ?? "意图分析已完成。",
      );
      return;
    case "knowledge_agent_start":
      completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.understand);
      setTransitionStep(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.gather,
        "获取信息",
        "active",
        summary ?? "正在检索资料。",
      );
      return;
    case "knowledge_agent_done":
      completeStepIfPresent(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.gather,
        summary ?? "资料已就绪。",
      );
      return;
    case "action_agent_start":
      completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.understand);
      return;
    case "action_agent_done":
      completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.gather);
      completeStepIfPresent(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.act,
        summary ?? "页面操作已完成。",
      );
      return;
    case "memory_replay":
      setTransitionStep(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.understand,
        "理解问题",
        "done",
        summary ?? "已复用项目记忆，跳过本轮检索。",
      );
      return;
    default:
      return;
  }
}

export async function applyRemoteEvent(
  api: HandlerApi,
  event: RemoteRunEvent,
  lookup?: ToolLaneLookup,
) {
  if (event.type === "ping") return;

  if (event.type === "step_sync") {
    api.setSteps(
      event.steps.map((step) => ({
        id: step.id,
        label: step.label,
        status: step.status,
        content: api.getSteps().find((item) => item.id === step.id)?.content,
      })),
    );
  } else if (event.type === "step_status") {
    ensureStep(api, event.stepId, event.label ?? event.stepId);
    api.setStep(event.stepId, event.status, event.content);
  } else if (event.type === "step_content") {
    let stepId = event.stepId;
    let content = event.content;

    // 兼容旧服务端：loop 规划摘要误写入 intent 步骤时，重定向到获取信息。
    if (
      (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.intent ||
        stepId === SPOTLIGHT_PIPELINE_STEP_IDS.understand) &&
      isLoopPlanningChunk(content)
    ) {
      stepId = SPOTLIGHT_PIPELINE_STEP_IDS.gather;
    } else if (
      (stepId === SPOTLIGHT_PIPELINE_STEP_IDS.intent ||
        stepId === SPOTLIGHT_PIPELINE_STEP_IDS.understand) &&
      event.mode === "replace"
    ) {
      const { intent, misplacedPlanning } = splitIntentStepContent(content);
      content = intent;
      if (misplacedPlanning.trim()) {
        ensureStep(api, SPOTLIGHT_PIPELINE_STEP_IDS.gather, "获取信息");
        api.appendChunkToStep(
          SPOTLIGHT_PIPELINE_STEP_IDS.gather,
          misplacedPlanning,
        );
      }
    }

    ensureStep(api, stepId, toolStepLabel(stepId, event.label));
    if (event.mode === "replace") {
      api.setStep(
        stepId,
        api.getSteps().find((step) => step.id === stepId)?.status ?? "active",
        content,
      );
    } else {
      if (
        stepId === SPOTLIGHT_PIPELINE_STEP_IDS.tool ||
        stepId === SPOTLIGHT_PIPELINE_STEP_IDS.gather ||
        stepId === SPOTLIGHT_PIPELINE_STEP_IDS.act
      ) {
        const lane =
          stepId === SPOTLIGHT_PIPELINE_STEP_IDS.act ? "act" : "gather";
        activateLaneStep(api, lane);
      }
      api.appendChunkToStep(stepId, content);
      await paintYield();
    }
  } else if (event.type === "step_artifact") {
    const artifactStepId =
      event.stepId === SPOTLIGHT_PIPELINE_STEP_IDS.tool
        ? SPOTLIGHT_PIPELINE_STEP_IDS.gather
        : event.stepId;
    ensureStep(api, artifactStepId, toolStepLabel(artifactStepId, event.label));
    if (
      artifactStepId === SPOTLIGHT_PIPELINE_STEP_IDS.gather ||
      artifactStepId === SPOTLIGHT_PIPELINE_STEP_IDS.act
    ) {
      activateLaneStep(
        api,
        artifactStepId === SPOTLIGHT_PIPELINE_STEP_IDS.act ? "act" : "gather",
      );
    }
    if (event.artifact === "tool_calls" && event.toolCalls?.length) {
      api.appendToolCallsToStep(artifactStepId, event.toolCalls);
    } else if (event.artifact === "attachments" && event.attachments?.length) {
      api.appendAttachmentsToStep(artifactStepId, event.attachments);
    } else if (event.artifact === "files" && event.files?.length) {
      api.appendFilesToStep(artifactStepId, event.files);
    } else if (event.artifact === "artifacts" && event.artifacts?.length) {
      api.appendArtifactsToStep(artifactStepId, event.artifacts);
    } else if (event.artifact === "chat_items" && event.chatItems?.length) {
      api.appendChatItemsToStep(artifactStepId, event.chatItems);
    }
  } else if (event.type === "tool_start") {
    const stepId = ensureLaneForTool(api, event.call.name, lookup);
    api.appendToolCallsToStep(stepId, [toolCallFromRemote(event)]);
  } else if (event.type === "tool_progress") {
    const stepId = ensureLaneForTool(api, event.call.name, lookup);
    api.appendToolCallsToStep(stepId, [
      {
        id: event.call.id,
        name: event.call.name,
        displayName: event.call.displayName,
        argsText: JSON.stringify(event.call.input ?? {}, null, 2),
        summary: event.summary,
        status: "running",
      },
    ]);
  } else if (event.type === "tool_result") {
    const stepId = ensureLaneForTool(api, event.result.call.name, lookup);
    api.appendToolCallsToStep(stepId, [buildToolResultCall(event)]);
    if (event.result.attachments?.length) {
      api.appendAttachmentsToStep(stepId, event.result.attachments);
    }
    if (event.result.files?.length) {
      api.appendFilesToStep(stepId, event.result.files);
    }
    if (event.result.toolCalls?.length) {
      api.appendToolCallsToStep(stepId, event.result.toolCalls);
    }
  } else if (event.type === "skill_permission_request") {
    const { useSpotlightStore } = await import("../store/spotlightStore.js");
    useSpotlightStore().setPendingSkillPermission({
      skillName: event.skillName,
      displayName: event.displayName,
      reason: event.reason,
      source: event.source,
      at: event.at,
    });
  } else if (event.type === "fork_progress") {
    const stepId = SPOTLIGHT_PIPELINE_STEP_IDS.gather;
    ensureStep(api, stepId, "获取信息");
    api.appendChunkToStep(
      stepId,
      `\n[fork ${event.agentId}] 第 ${event.iteration} 轮 · ${event.phase}：${event.summary}\n`,
    );
  } else if (event.type === "turn_transition") {
    applyLangGraphTransition(api, event);
  } else if (event.type === "memory_decision") {
    const labels: Record<SpotlightMemoryDecision["action"], string> = {
      reuse: "已复用项目记忆",
      augment: "正在结合历史项目结论",
      refresh: "资料可能变化，正在重新验证",
      ignore: "未发现可直接使用的项目记忆",
    };
    const existing = api
      .getSteps()
      .find((item) => item.id === SPOTLIGHT_PIPELINE_STEP_IDS.understand);
    const nextStatus =
      event.decision.action === "reuse" || existing?.status === "done"
        ? "done"
        : "active";
    setTransitionStep(
      api,
      SPOTLIGHT_PIPELINE_STEP_IDS.understand,
      "理解问题",
      nextStatus,
      labels[event.decision.action],
    );
  } else if (event.type === "run_status") {
    const detail = event.detail?.trim();
    if (detail) {
      const lane =
        api.getSteps().find((step) => step.id === SPOTLIGHT_PIPELINE_STEP_IDS.act)
          ? SPOTLIGHT_PIPELINE_STEP_IDS.act
          : SPOTLIGHT_PIPELINE_STEP_IDS.gather;
      ensureStep(api, lane, toolStepLabel(lane, null));
      api.appendChunkToStep(lane, `\n${detail}\n`);
    }
  } else if (event.type === "assistant_response") {
    completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.understand);
    completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.gather);
    completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.act);
    ensureStep(api, SPOTLIGHT_PIPELINE_STEP_IDS.answer, "回答");
    api.setStep(
      SPOTLIGHT_PIPELINE_STEP_IDS.answer,
      "done",
      event.content.trim(),
    );
  }

  if (isTelemetryEvent(event)) {
    api.appendExecutionEvent?.(event);
  }
}

function canonicalToolCall(
  item: SpotlightToolCallItem | SpotlightKnowledgeSearchItem,
): AgentStepToolCall {
  const status = item.status === "completed"
    ? "done"
    : item.status === "failed"
      ? "error"
      : "running";
  if (item.type === "knowledge_search") {
    return {
      id: item.id,
      name: item.tool,
      displayName: item.displayName,
      argsText: JSON.stringify({ query: item.query }, null, 2),
      resultText: formatEvidenceOutput(item.result),
      summary: item.summary,
      status,
    };
  }
  return {
    id: item.id,
    name: item.tool,
    displayName: item.displayName,
    argsText: JSON.stringify(item.arguments ?? {}, null, 2),
    resultText: item.result === undefined
      ? undefined
      : typeof item.result === "string"
        ? item.result
        : JSON.stringify(item.result, null, 2),
    summary: item.summary ?? item.error?.message,
    errorCode: item.error?.code,
    trace: item.trace as AgentStepToolCall["trace"],
    status,
  };
}

/** Render only stable Thread / Turn / Item events; LangGraph phases stay server-side. */
export async function applyLifecycleEvent(
  api: HandlerApi,
  event: SpotlightTurnEvent,
  lookup?: ToolLaneLookup,
): Promise<void> {
  if (event.type === "ping") return;
  if (event.type === "turn.started") {
    setTransitionStep(
      api,
      SPOTLIGHT_PIPELINE_STEP_IDS.understand,
      "理解问题",
      "active",
      "正在理解您的问题。",
    );
    return;
  }
  if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
    const item = event.item;
    if (item.type === "reasoning") {
      if (item.category === "routing" || item.category === "memory") {
        setTransitionStep(
          api,
          SPOTLIGHT_PIPELINE_STEP_IDS.understand,
          "理解问题",
          event.type === "item.completed" ? "done" : "active",
          item.summary,
        );
      } else {
        const actionProgress = /页面|操作|执行/u.test(item.summary);
        const stepId = actionProgress
          ? SPOTLIGHT_PIPELINE_STEP_IDS.act
          : SPOTLIGHT_PIPELINE_STEP_IDS.gather;
        ensureStep(api, stepId, actionProgress ? "操作页面" : "获取信息");
        api.setStep(
          stepId,
          event.type === "item.completed" ? "done" : "active",
          item.summary,
        );
      }
      return;
    }
    if (item.type === "skill_use") {
      const stepId = "skills";
      const previous = ensureStep(api, stepId, "使用 Skill");
      const line = `- ${item.displayName}${item.skill === item.displayName ? "" : `（${item.skill}）`}`;
      const content = previous.content?.includes(line)
        ? previous.content
        : [previous.content, line].filter(Boolean).join("\n");
      api.setStep(stepId, item.status === "failed" ? "error" : "done", content);
      useAgentSessionStore().setInvokedSkills([
        ...useAgentSessionStore().invokedSkills.filter(
          (skill) => skill.skillName !== item.skill,
        ),
        { skillName: item.skill, invokedAt: event.at },
      ]);
      return;
    }
    if (item.type === "tool_call" || item.type === "knowledge_search") {
      const name = item.type === "tool_call" ? item.tool : item.tool;
      const stepId = ensureLaneForTool(api, name, lookup);
      api.appendToolCallsToStep(stepId, [canonicalToolCall(item)]);
      if (item.status === "completed" || item.status === "failed") {
        completeStepIfPresent(api, stepId);
      }
      return;
    }
    if (item.type === "memory") {
      setTransitionStep(
        api,
        SPOTLIGHT_PIPELINE_STEP_IDS.understand,
        "理解问题",
        item.action === "reuse" ? "done" : "active",
        item.summary,
      );
      return;
    }
    if (item.type === "agent_message") {
      completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.understand);
      completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.gather);
      completeStepIfPresent(api, SPOTLIGHT_PIPELINE_STEP_IDS.act);
      ensureStep(api, SPOTLIGHT_PIPELINE_STEP_IDS.answer, "回答");
      api.setStep(SPOTLIGHT_PIPELINE_STEP_IDS.answer, "done", item.text.trim());
      return;
    }
    if (item.type === "error") {
      api.setError(item.message);
    }
    return;
  }
  if (event.type === "turn.failed") {
    api.setError(event.error.message);
  }
}

async function postHostResult(params: {
  runId: string;
  correlationId: string;
  result: Awaited<ReturnType<typeof executeRemoteHostTool>>;
  signal?: AbortSignal;
}) {
  await fetch(
    `${getSpotlightServerBase()}/v1/runs/${encodeURIComponent(params.runId)}/host-results`,
    {
      method: "POST",
      headers: buildSpotlightJsonHeaders(),
      body: JSON.stringify({
        correlationId: params.correlationId,
        success: params.result.success,
        output: params.result.data,
        error: params.result.error,
        errorCode: params.result.errorCode,
        trace: params.result.trace,
        // Free observation: the page just changed, so tell the agent what it
        // looks like now instead of making it plan against the pre-call state.
        uiContext: getSpotlightConfig().getUiContext?.() ?? undefined,
      }),
      signal: params.signal,
    },
  );
}

type SequencedRunEvent = RemoteRunEvent & { seq?: number };

function parseSseChunk(buffer: string): {
  events: SequencedRunEvent[];
  rest: string;
} {
  const frames = buffer.split(/\n\n/u);
  const rest = frames.pop() ?? "";
  const events = frames.flatMap((frame) => {
    const lines = frame.split(/\n/u);
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (!dataLine) return [];
    const idLine = lines.find((line) => line.startsWith("id: "));
    const seq = idLine ? Number.parseInt(idLine.slice(4), 10) : Number.NaN;
    try {
      const event = JSON.parse(dataLine.slice(6)) as SequencedRunEvent;
      return [Number.isFinite(seq) ? { ...event, seq } : event];
    } catch {
      return [];
    }
  });
  return { events, rest };
}

const SSE_RECONNECT_ATTEMPTS = 6;
const SSE_RECONNECT_BASE_MS = 400;

async function openRunEventStream(
  runId: string,
  afterSeq: number,
  signal?: AbortSignal,
): Promise<Response> {
  const query = afterSeq > 0 ? `?lastEventId=${afterSeq}` : "";
  const response = await fetch(
    `${getSpotlightServerBase()}/v1/runs/${encodeURIComponent(runId)}/events${query}`,
    { headers: buildSpotlightJsonHeaders(), signal },
  );
  if (response.status === 410) {
    throw new Error("Spotlight 后端已不再保留这次运行的记录，请重新提问。");
  }
  if (!response.ok || !response.body) {
    throw new Error(`Spotlight 后端事件流连接失败：${response.status}`);
  }
  return response;
}

function reconnectDelay(attempt: number): number {
  return Math.min(SSE_RECONNECT_BASE_MS * 2 ** attempt, 5_000);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function warmupSpotlightRemoteContext(
  signal?: AbortSignal,
): Promise<void> {
  await Promise.allSettled([
    getSpotlightAppClient().initialize(signal),
    ensureSpotlightMeta(signal),
  ]);
}

async function buildRemotePayload(
  userQuestion: string,
  signal?: AbortSignal,
  options?: { forceMemoryRefresh?: boolean },
) {
  const session = useAgentSessionStore();
  const runtime = useSpotlightRuntimeStore();
  const memoryPreference = useSpotlightMemoryPreferenceStore();
  const hostManifest = await ensureHostToolsManifest(signal);
  return {
    hostManifest,
    payload: {
      projectId: getSpotlightProjectId(),
      input: userQuestion,
      memorySubjectId: getSpotlightConfig().getMemorySubjectId?.() ?? undefined,
      memoryRefreshRequested: options?.forceMemoryRefresh === true,
      uiContext: getSpotlightConfig().getUiContext?.() ?? {},
      sessionState: {
        sessionId: session.sessionId,
        activeTaskId: session.activeTaskId,
        activeTopic: session.activeTopic,
        pendingTask: session.pendingTask,
        conversationSummary: session.conversationSummary,
        summarizedTurnCount: session.summarizedTurnCount,
        conversationHistory: session.conversationHistory,
        lastAssistantReply: session.getLastAssistantContent(),
        invokedSkills: session.invokedSkills,
        skillPermissionGrants: session.skillPermissionGrants,
        memoryEnabled: memoryPreference.enabled,
        memoryReadEnabled: memoryPreference.enabled,
        memoryWriteEnabled: true,
      },
      runtimeState: {
        activeDomain: runtime.activeDomain,
        activeTarget: runtime.activeTarget,
        activeAction: runtime.activeAction,
        resumableAction: runtime.resumableAction,
        lastResolvedTarget: runtime.lastResolvedTarget,
      },
    },
  };
}

export async function runRemoteSpotlightPipeline(
  userQuestion: string,
  api: HandlerApi,
  options?: { forceMemoryRefresh?: boolean },
): Promise<SpotlightPipelineRunOutcome> {
  const signal = api.getSignal();
  const { payload, hostManifest } = await buildRemotePayload(
    userQuestion,
    signal,
    options,
  );
  const allowedHostNames = new Set(hostManifest.tools.map((t) => t.name));
  const lookup: ToolLaneLookup = {
    sideEffectByName: new Map(
      hostManifest.tools.map((tool) => [tool.name, tool.sideEffect]),
    ),
  };
  const client = getSpotlightAppClient();
  const session = useAgentSessionStore();
  const thread = await client.startThread(session.sessionId, signal);
  const turn = await client.startTurn(thread.id, payload, signal);
  if (signal) {
    activeRunBySignal.set(signal, turn.id);
    signal.addEventListener(
      "abort",
      () => {
        void client.cancelTurn(turn.id);
      },
      { once: true },
    );
  }
  for await (const event of client.streamTurn(turn.id, signal)) {
    await applyLifecycleEvent(api, event, lookup);
    if (
      (event.type === "item.started" || event.type === "item.updated") &&
      event.item.type === "tool_call" &&
      event.item.status === "waiting_for_client" &&
      event.item.clientRequest
    ) {
      const call = {
        id: event.item.id,
        name: event.item.tool,
        input: event.item.arguments,
        displayName: event.item.displayName,
      };
      const approvalRequired = event.item.clientRequest.approvalRequired === true;
      const approved = !approvalRequired || Boolean(
        await getSpotlightConfig().approveTool?.({
          name: call.name,
          displayName: call.displayName,
          input: call.input,
          reason: event.item.clientRequest.approvalReason,
        }),
      );
      const result: import("../types/toolResult.js").ToolResult<unknown> = approved
        ? await executeRemoteHostTool(call, api, { allowedHostNames })
        : {
            success: false as const,
            error: "Tool execution was not approved",
            errorCode: "TOOL_APPROVAL_REQUIRED",
            trace: [],
            executionTarget: "host" as const,
          };
      settleHostToolCall(api, call, result, lookup);
      await client.submitToolResult(turn.id, {
        correlationId: event.item.clientRequest.correlationId,
        success: result.success,
        output: result.data,
        error: result.error,
        errorCode: result.errorCode,
        trace: result.trace,
        uiContext: getSpotlightConfig().getUiContext?.() ?? undefined,
      }, signal);
      continue;
    }
    await paintYield();
    if (event.type === "turn.failed") {
      throw new Error(event.error.message);
    }
    if (event.type === "turn.completed") {
      const metadata = event.metadata ?? {};
      const sessionPatch = metadata.sessionPatch as Parameters<
        ReturnType<typeof useAgentSessionStore>["applySessionPatch"]
      >[0] | undefined;
      if (sessionPatch) session.applySessionPatch(sessionPatch);
      return {
        command: null,
        memoryReplay: (metadata.memoryReplay as SpotlightPipelineRunOutcome["memoryReplay"]) ?? null,
        memoryDecision: (metadata.memoryDecision as SpotlightPipelineRunOutcome["memoryDecision"]) ?? null,
        assistantReply: event.finalResponse,
      };
    }
  }
  return { command: null };
}

/** A closed socket is recoverable; anything the server told us is not. */
function isTransportError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof DOMException;
}

export async function cancelRemoteSpotlightRun(runId: string) {
  await getSpotlightAppClient().cancelTurn(runId);
}

export function cancelRemoteSpotlightRunForSignal(signal?: AbortSignal) {
  if (!signal) return;
  const runId = activeRunBySignal.get(signal);
  if (!runId) return;
  activeRunBySignal.delete(signal);
  void cancelRemoteSpotlightRun(runId);
}
