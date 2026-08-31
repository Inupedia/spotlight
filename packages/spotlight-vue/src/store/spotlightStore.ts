/**
 * Spotlight 指令面板 Store：提交问题走 spotlight-server；此处仅 UI、宿主工具 sink 与遥测。
 */
import { defineStore } from "pinia";
import type { SpotlightMemoryDecision } from "@inupedia/spotlight-protocol";
import type { ToolResult } from "../types/toolResult.js";
import { getSpotlightConfig } from "../plugin.js";
import {
  cancelRemoteSpotlightRunForSignal,
  ensureSpotlightMeta,
  runRemoteSpotlightPipeline,
  warmupSpotlightRemoteContext,
} from "../remote/index.js";
import { devWarn } from "../utils/devConsole.js";
import { useAgentSessionStore } from "../session/agentSession.js";
import { useSpotlightRuntimeStore } from "./runtimeStore.js";
import type { AgentStep } from "./types.js";
import { applyPipelineError } from "./pipeline/errors.js";
import {
  SPOTLIGHT_PIPELINE_STEP_IDS,
  SPOTLIGHT_PIPELINE_STEP_LABELS,
} from "./pipeline/constants.js";
import type { SpotlightExecutionEvent } from "./runtime/types.js";
import { setStepState } from "./pipeline/steps.js";
import {
  typewriterAppendToStepContent,
  typewriterToStepContent,
} from "./pipeline/typing.js";
import type { HandlerApi } from "./pipeline/types.js";
import {
  addRecentQuestionToList,
  loadRecentQuestions,
  persistRecentQuestions,
} from "./recent.js";
import { getSuggestedQuestions } from "./capabilities.js";
import { buildSpotlightStoreSink } from "./storeSink.js";

type PipelinePhase = "idle" | "running" | "cancelled" | "error" | "done";
const SPOTLIGHT_TELEMETRY_KEY = "spotlight-telemetry-snapshots";
const MAX_TELEMETRY_SNAPSHOTS = 20;

export type SpotlightMemoryReplayBadge = {
  source: "exact" | "semantic" | "session";
  entryId: string;
  kind: string;
};

type SpotlightTelemetryFailureCategory =
  | "tool_runtime"
  | "tool_timeout"
  | "runtime_error"
  | "cancelled"
  | "max_turns_exhausted"
  | "tool_failure_unrecoverable"
  | "completed";

type SpotlightTimelineEvent = {
  turnId: string;
  at: number;
  kind: SpotlightExecutionEvent["type"];
  iteration?: number;
  summary?: string;
  raw: SpotlightExecutionEvent;
};

type SpotlightFailureSummary = {
  turnId: string;
  stopReason: string;
  failureClass: string | null;
  category: SpotlightTelemetryFailureCategory;
  elapsedMs: number;
  toolErrors: string[];
};

type SpotlightTelemetrySnapshot = {
  turnId: string;
  recordedAt: number;
  timeline: SpotlightTimelineEvent[];
  failureSummary: SpotlightFailureSummary | null;
};

function toToolResultFromExecutionEvent(
  event: Extract<SpotlightExecutionEvent, { type: "tool_result" }>,
): ToolResult<unknown> {
  return {
    success: event.result.success,
    data: event.result.output,
    error: event.result.error,
    errorCode: event.result.errorCode,
    trace: event.result.trace,
  };
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  return err instanceof Error && err.name === "AbortError";
}

function loadTelemetrySnapshots(): SpotlightTelemetrySnapshot[] {
  try {
    const raw = localStorage.getItem(SPOTLIGHT_TELEMETRY_KEY);
    const parsed = raw ? (JSON.parse(raw) as SpotlightTelemetrySnapshot[]) : [];
    return Array.isArray(parsed)
      ? parsed.slice(0, MAX_TELEMETRY_SNAPSHOTS)
      : [];
  } catch {
    return [];
  }
}

function persistTelemetrySnapshots(
  snapshots: SpotlightTelemetrySnapshot[],
): void {
  try {
    localStorage.setItem(
      SPOTLIGHT_TELEMETRY_KEY,
      JSON.stringify(snapshots.slice(0, MAX_TELEMETRY_SNAPSHOTS)),
    );
  } catch {
    // ignore
  }
}

function isUiExecutionEvent(event: SpotlightExecutionEvent): boolean {
  return (
    event.type === "step_sync" ||
    event.type === "step_status" ||
    event.type === "step_content" ||
    event.type === "step_artifact"
  );
}

function classifyFailureCategory(
  event: Extract<SpotlightExecutionEvent, { type: "turn_completed" }>,
): SpotlightTelemetryFailureCategory {
  if (event.failureClass === "tool") {
    const hasTimeout = event.budgetUsage.failedToolCalls > 0;
    return hasTimeout ? "tool_runtime" : "tool_failure_unrecoverable";
  }
  if (event.failureClass === "runtime") return "runtime_error";
  if (event.failureClass === "cancel") return "cancelled";
  if (event.stopReason === "max_turns_exhausted") return "max_turns_exhausted";
  if (event.stopReason === "tool_failure_unrecoverable") {
    return "tool_failure_unrecoverable";
  }
  return "completed";
}

function buildTurnTimelines(
  events: SpotlightExecutionEvent[],
): SpotlightTimelineEvent[][] {
  const timelines = new Map<string, SpotlightTimelineEvent[]>();
  let activeTurnId: string | null = null;
  for (const event of events) {
    if (event.type === "turn_transition" || event.type === "turn_completed") {
      activeTurnId = event.turnId;
    }
    const turnId = "turnId" in event ? event.turnId : activeTurnId;
    if (!turnId || isUiExecutionEvent(event)) continue;
    const timeline = timelines.get(turnId) ?? [];
    timeline.push({
      turnId,
      at: event.at,
      kind: event.type,
      iteration: "iteration" in event ? event.iteration : undefined,
      summary:
        event.type === "plan"
          ? event.summary
          : event.type === "turn_transition"
            ? event.summary
            : event.type === "assistant_response"
              ? event.content
              : event.type === "tool_result"
                ? event.result.summary
                : undefined,
      raw: event,
    });
    timelines.set(turnId, timeline);
  }
  return Array.from(timelines.values()).sort(
    (left, right) => right[0]!.at - left[0]!.at,
  );
}

function buildFailureSummaryForTurn(
  events: SpotlightExecutionEvent[],
  turnId: string,
): SpotlightFailureSummary | null {
  const latestTurnCompleted = [...events]
    .reverse()
    .find(
      (
        event,
      ): event is Extract<
        SpotlightExecutionEvent,
        { type: "turn_completed" }
      > => event.type === "turn_completed" && event.turnId === turnId,
    );
  if (!latestTurnCompleted) return null;
  const toolErrors = events
    .filter(
      (
        event,
      ): event is Extract<SpotlightExecutionEvent, { type: "tool_result" }> =>
        event.type === "tool_result" &&
        event.result.success === false &&
        !!event.result.error,
    )
    .map((event) => event.result.error!)
    .slice(-5);
  return {
    turnId: latestTurnCompleted.turnId,
    stopReason: latestTurnCompleted.stopReason,
    failureClass: latestTurnCompleted.failureClass,
    category: classifyFailureCategory(latestTurnCompleted),
    elapsedMs: latestTurnCompleted.elapsedMs,
    toolErrors,
  };
}

function buildLatestFailureSummary(
  events: SpotlightExecutionEvent[],
): SpotlightFailureSummary | null {
  const latestTurnCompleted = [...events]
    .reverse()
    .find(
      (
        event,
      ): event is Extract<
        SpotlightExecutionEvent,
        { type: "turn_completed" }
      > => event.type === "turn_completed",
    );
  if (!latestTurnCompleted) return null;
  return buildFailureSummaryForTurn(events, latestTurnCompleted.turnId);
}

function getTurnTimelineById(
  events: SpotlightExecutionEvent[],
  turnId: string,
): SpotlightTimelineEvent[] {
  return (
    buildTurnTimelines(events).find((item) => item[0]?.turnId === turnId) ?? []
  );
}

// 对外保持原有导出路径，便于组件按需引用
export type { AgentStep, IntentWithReason, SubIntentConfig } from "./types.js";
export {
  SpotlightIntent,
  SPOTLIGHT_INTENT_LABELS,
  ProgressSubIntent,
  PROGRESS_SUB_INTENT_LABELS,
  InvestmentSubIntent,
  INVESTMENT_SUB_INTENT_LABELS,
  QualitySubIntent,
  QUALITY_SUB_INTENT_LABELS,
  SafetySubIntent,
  SAFETY_SUB_INTENT_LABELS,
  SUB_INTENT_CONFIG,
} from "./types.js";

export type SpotlightSkillPermissionRequest = {
  skillName: string;
  displayName?: string;
  reason: string;
  source: "model" | "user-slash";
  at: number;
};

export const useSpotlightStore = defineStore("spotlight", {
  state: () => ({
    visible: false,
    prompt: "",
    loading: false,
    error: "",
    result: null as string | null,
    selectedIndex: 0,
    showThinkingBar: false,
    agentSteps: [] as AgentStep[],
    executionEvents: [] as SpotlightExecutionEvent[],
    pendingSkillPermission: null as SpotlightSkillPermissionRequest | null,
    recentQuestions: [] as string[],
    suggestedQuestions: [] as string[],
    pipelinePhase: "idle" as PipelinePhase,
    pipelineRunId: 0,
    pipelineAbortController: null as AbortController | null,
    lastMemoryReplay: null as SpotlightMemoryReplayBadge | null,
    lastMemoryDecision: null as SpotlightMemoryDecision | null,
    lastSubmittedQuestion: "",
    telemetrySnapshots:
      loadTelemetrySnapshots() as SpotlightTelemetrySnapshot[],
  }),
  getters: {
    uiExecutionEvents(state): SpotlightExecutionEvent[] {
      return state.executionEvents.filter(isUiExecutionEvent);
    },
    telemetryExecutionEvents(state): SpotlightExecutionEvent[] {
      return state.executionEvents.filter(
        (event) => !isUiExecutionEvent(event),
      );
    },
    turnTimelines(state): SpotlightTimelineEvent[][] {
      return buildTurnTimelines(state.executionEvents);
    },
    latestTurnTimeline(): SpotlightTimelineEvent[] {
      return this.turnTimelines[0] ?? [];
    },
    latestFailureSummary(state): SpotlightFailureSummary | null {
      return buildLatestFailureSummary(state.executionEvents);
    },
    latestTelemetrySnapshot(state): SpotlightTelemetrySnapshot | null {
      return state.telemetrySnapshots[0] ?? null;
    },
  },

  actions: {
    persistTurnTelemetrySnapshot(turnId: string) {
      const timeline = getTurnTimelineById(this.executionEvents, turnId);
      if (!timeline.length) return;
      const snapshot: SpotlightTelemetrySnapshot = {
        turnId,
        recordedAt: Date.now(),
        timeline,
        failureSummary: buildFailureSummaryForTurn(
          this.executionEvents,
          turnId,
        ),
      };
      this.telemetrySnapshots = [
        snapshot,
        ...this.telemetrySnapshots.filter((item) => item.turnId !== turnId),
      ].slice(0, MAX_TELEMETRY_SNAPSHOTS);
      persistTelemetrySnapshots(this.telemetrySnapshots);
    },

    exportTurnTelemetrySnapshot(turnId: string): string | null {
      const snapshot =
        this.telemetrySnapshots.find((item) => item.turnId === turnId) ?? null;
      return snapshot ? JSON.stringify(snapshot, null, 2) : null;
    },

    exportLatestTelemetrySnapshot(): string | null {
      const snapshot = this.latestTelemetrySnapshot;
      return snapshot ? JSON.stringify(snapshot, null, 2) : null;
    },

    clearTelemetrySnapshots() {
      this.telemetrySnapshots = [];
      persistTelemetrySnapshots([]);
    },

    isPipelineRunActive(runId: number): boolean {
      return this.pipelineRunId === runId && this.pipelinePhase === "running";
    },

    cancelPipeline() {
      if (this.pipelineAbortController) {
        cancelRemoteSpotlightRunForSignal(this.pipelineAbortController.signal);
        this.pipelineAbortController.abort();
        this.pipelineAbortController = null;
      }
      if (this.loading) this.loading = false;
      if (this.pipelinePhase === "running") {
        this.pipelinePhase = "cancelled";
      }
    },

    setStep(id: string, status: AgentStep["status"], content?: string) {
      setStepState(this.agentSteps, id, status, content);
    },

    recordExecutionEvent(event: SpotlightExecutionEvent) {
      this.executionEvents.push(event);
      if (this.executionEvents.length > 500) {
        this.executionEvents.splice(0, this.executionEvents.length - 500);
      }

      if (event.type === "turn_completed") {
        this.persistTurnTelemetrySnapshot(event.turnId);
      }
    },

    async typewriterToStep(
      stepId: string,
      fullText: string,
      msPerChar = 24,
      shouldContinue?: () => boolean,
    ): Promise<void> {
      return typewriterToStepContent(
        this.agentSteps,
        stepId,
        fullText,
        msPerChar,
        shouldContinue,
      );
    },

    async typewriterAppendToStep(
      stepId: string,
      suffix: string,
      msPerChar = 24,
      shouldContinue?: () => boolean,
    ): Promise<void> {
      return typewriterAppendToStepContent(
        this.agentSteps,
        stepId,
        suffix,
        msPerChar,
        shouldContinue,
      );
    },

    open() {
      this.visible = true;
      this.loadRecentQuestions();
      void this.refreshSuggestedQuestions();
      void warmupSpotlightRemoteContext();
      this.selectedIndex = -1;
      this.prompt = "";
      this.error = "";
    },

    /**
     * ⌘/Ctrl+L 显示数字人时：与 open() 同步推荐问法、历史与输入壳状态，但不打开面板（visible 不变）。
     * 用于「语音等同 Spotlight 文字输入」通道，Thinking 仍走 submit()，布局与 ⌘K 一致。
     */
    prepareLive2dVoiceChannel() {
      this.loadRecentQuestions();
      void this.refreshSuggestedQuestions();
      void warmupSpotlightRemoteContext();
      this.selectedIndex = -1;
      this.prompt = "";
      this.error = "";
    },

    loadRecentQuestions() {
      this.recentQuestions = loadRecentQuestions();
    },

    addRecentQuestion(question: string) {
      this.recentQuestions = addRecentQuestionToList(
        this.recentQuestions,
        question,
      );
      persistRecentQuestions(this.recentQuestions);
    },

    async refreshSuggestedQuestions() {
      await ensureSpotlightMeta();
      const config = getSpotlightConfig();
      const uiContext = config.getUiContext?.() ?? {};
      const runtime = useSpotlightRuntimeStore();
      const params = {
        sceneLevel:
          (uiContext as { sceneLevel?: number | null }).sceneLevel ?? null,
        smallTab: (uiContext as { smallTab?: string | null }).smallTab ?? null,
        activeTarget: runtime.activeTarget,
      };
      this.suggestedQuestions =
        config.getSuggestedQuestions?.(params) ?? getSuggestedQuestions(params);
    },

    getSelectionQuestions() {
      return [...this.suggestedQuestions, ...this.recentQuestions];
    },

    fillPromptWithRecent(index: number) {
      const q = this.getSelectionQuestions()[index];
      if (q) this.prompt = q;
    },

    runSelectedRecentAndSubmit() {
      if (this.selectedIndex < 0) return;
      const q = this.getSelectionQuestions()[this.selectedIndex];
      if (q) {
        this.prompt = q;
        this.submit();
      }
    },

    close() {
      this.cancelPipeline();
      this.visible = false;
      this.showThinkingBar = false;
      this.agentSteps = [];
      this.executionEvents = [];
      this.pipelinePhase = "idle";
    },

    openThinkingBar() {
      this.visible = false;
      this.showThinkingBar = true;
    },

    closeThinking() {
      this.cancelPipeline();
      this.showThinkingBar = false;
      this.agentSteps = [];
      this.executionEvents = [];
      this.pendingSkillPermission = null;
      this.error = "";
      this.result = null;
      this.lastMemoryReplay = null;
      this.lastMemoryDecision = null;
      this.pipelinePhase = "idle";
    },

    setPendingSkillPermission(request: SpotlightSkillPermissionRequest) {
      this.pendingSkillPermission = request;
    },

    clearPendingSkillPermission() {
      this.pendingSkillPermission = null;
    },

    approvePendingSkillPermission() {
      const pending = this.pendingSkillPermission;
      if (!pending) return;
      useAgentSessionStore().grantSkillPermission(pending.skillName);
      this.pendingSkillPermission = null;
    },

    /** 供 pipeline handlers 使用，不直接依赖 pinia 的 api 封装 */
    buildHandlerApi(runId: number, signal: AbortSignal): HandlerApi {
      const isCurrentRun = () => this.isPipelineRunActive(runId);
      return buildSpotlightStoreSink({
        signal,
        isCurrentRun,
        getSteps: () => this.agentSteps,
        replaceSteps: (steps) => {
          this.agentSteps = steps;
        },
        setStep: (id, status, content) => {
          this.setStep(id, status, content);
        },
        typewriterToStep: (stepId, fullText, msPerChar) => {
          return this.typewriterToStep(
            stepId,
            fullText,
            msPerChar,
            isCurrentRun,
          );
        },
        typewriterAppendToStep: (stepId, suffix, msPerChar) => {
          return this.typewriterAppendToStep(
            stepId,
            suffix,
            msPerChar,
            isCurrentRun,
          );
        },
        setError: (msg) => {
          this.error = msg;
        },
        setResult: (json) => {
          this.result = json;
        },
        recordExecutionEvent: (event) => {
          this.recordExecutionEvent(event);
        },
      });
    },

    selectNext() {
      if (this.prompt.trim()) return;
      const n = this.getSelectionQuestions().length;
      if (!n) return;
      this.selectedIndex =
        this.selectedIndex < 0 ? 0 : (this.selectedIndex + 1) % n;
    },

    selectPrev() {
      if (this.prompt.trim()) return;
      const n = this.getSelectionQuestions().length;
      if (!n) return;
      this.selectedIndex =
        this.selectedIndex < 0 ? n - 1 : (this.selectedIndex - 1 + n) % n;
    },

    async submit(
      options?: import("../remote/runPipeline.js").SpotlightPipelineRunOptions,
    ) {
      if (!this.prompt.trim() || this.loading) return;
      const runId = this.pipelineRunId + 1;
      this.pipelineRunId = runId;
      const controller = new AbortController();
      this.pipelineAbortController = controller;
      this.pipelinePhase = "running";
      this.loading = true;
      this.error = "";
      this.result = null;
      this.lastMemoryReplay = null;
      this.lastMemoryDecision = null;
      this.executionEvents = [];
      const userQuestion = this.prompt.trim();
      this.lastSubmittedQuestion = userQuestion;
      this.addRecentQuestion(userQuestion);
      this.agentSteps = [];
      this.openThinkingBar();

      try {
        const handlerApi = this.buildHandlerApi(runId, controller.signal);
        try {
          const outcome = await runRemoteSpotlightPipeline(
            userQuestion,
            handlerApi,
            options,
          );
          if (outcome.memoryReplay) {
            this.lastMemoryReplay = outcome.memoryReplay;
          }
          if (outcome.memoryDecision) {
            this.lastMemoryDecision = outcome.memoryDecision;
          }
          const session = useAgentSessionStore();
          session.pushTurn("user", userQuestion, "main_task");
          if (outcome.assistantReply?.trim()) {
            session.pushTurn("assistant", outcome.assistantReply, "main_task");
          }
        } catch (remoteError) {
          if (!this.isPipelineRunActive(runId)) return;
          if (isAbortError(remoteError)) {
            this.pipelinePhase = "cancelled";
            return;
          }
          devWarn("Spotlight", "远程流水线异常（将向上抛出）", remoteError);
          throw remoteError;
        }
      } catch (err) {
        if (!this.isPipelineRunActive(runId)) return;
        if (isAbortError(err)) {
          this.pipelinePhase = "cancelled";
          return;
        }
        const msg = err instanceof Error ? err.message : "解析失败";
        if (this.agentSteps.length === 0) {
          this.agentSteps = [
            {
              id: SPOTLIGHT_PIPELINE_STEP_IDS.understand,
              label: SPOTLIGHT_PIPELINE_STEP_LABELS.understand,
              status: "error",
              content: msg,
            },
          ];
        }
        applyPipelineError(this.buildHandlerApi(runId, controller.signal), msg);
        this.pipelinePhase = "error";
      } finally {
        const finalPhase = this.pipelinePhase as PipelinePhase;
        if (this.isPipelineRunActive(runId) || finalPhase === "done") {
          this.loading = false;
          this.pipelineAbortController = null;
          if (finalPhase === "running") {
            this.pipelinePhase = "done";
          }
        }
      }
    },

    async forceRefreshLastAnswer() {
      if (this.loading || !this.lastSubmittedQuestion.trim()) return;
      this.prompt = this.lastSubmittedQuestion;
      await this.submit({ forceMemoryRefresh: true });
    },

    handleEnter() {
      if (this.loading) return;
      if (!this.prompt.trim()) {
        if (this.recentQuestions.length) {
          this.runSelectedRecentAndSubmit();
        }
        return;
      }
      this.submit();
    },
  },
});
