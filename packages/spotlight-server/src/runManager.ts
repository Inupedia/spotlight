import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import type {
  AgentUiContext,
  CreateRunRequest,
  HostToolResultRequest,
  SpotlightActiveRun,
  SpotlightRunStatus,
  SpotlightRunSummary,
  ToolTraceEvent,
} from "@inupedia/spotlight-protocol";
import {
  deriveToolTier,
  isToolTierReplaySafe,
} from "@inupedia/spotlight-protocol";
import type {
  HostActionBridge,
  HostActionCall,
  IntentDecision,
  ProjectPack,
  RunContext,
  SpotlightToolCallInfo,
} from "./contracts.js";
import {
  compileSpotlightGraph,
  publicRouteFromLane,
  workflowRunnableConfig,
} from "./graph.js";
import type { SpotlightGraphToolEvent } from "./graph.js";
import {
  buildSessionContext,
  initialMessagesForRun,
} from "./workflow/sessionContext.js";
import { initialRuntimeState } from "./workflow/state.js";
import type { IntentRouter } from "./router.js";
import type { SpotlightDurableState } from "./durableState.js";
import { SpotlightPolicyEngine } from "./policy.js";
import {
  prepareRunContext,
  structuredOutputQuestion,
  validateStructuredOutput,
  type SpotlightContextMetrics,
} from "./contextBudget.js";

export type SpotlightServerRunEventBody =
  | {
      type: "turn_transition";
      at: number;
      turnId: string;
      phase: string;
      summary?: string;
      matchedSkillNames?: string[];
    }
  | { type: "assistant_response"; at: number; iteration: number; content: string }
  | {
      type: "voice_sentence";
      at: number;
      index: number;
      text: string;
    }
  | {
      type: "run_status";
      at: number;
      runId: string;
      status: SpotlightRunStatus;
      detail?: string;
    }
  | {
      type: "host_action_request";
      at: number;
      iteration: number;
      request: {
        correlationId: string;
        call: HostActionCall;
        /** >1 means this call is being re-dispatched after a lost connection. */
        dispatch: number;
        approvalRequired?: boolean;
        approvalReason?: string;
      };
    }
  | {
      type: "tool_start";
      at: number;
      iteration: number;
      call: SpotlightToolCallInfo;
    }
  | {
      type: "tool_progress";
      at: number;
      iteration: number;
      call: SpotlightToolCallInfo;
      summary: string;
    }
  | {
      type: "tool_result";
      at: number;
      iteration: number;
      result: {
        call: SpotlightToolCallInfo;
        success: boolean;
        summary: string;
        output?: unknown;
        error?: string;
        trace: ToolTraceEvent[];
      };
    }
  | {
      type: "run_completed";
      at: number;
      runId: string;
      turnId: string;
      assistantReply: string;
      commandName: string | null;
      stopReason: string;
      failureClass: null;
      elapsedMs: number;
      summary: SpotlightRunSummary;
    }
  | { type: "run_error"; at: number; runId: string; error: string };

export type SpotlightServerRunEvent = SpotlightServerRunEventBody & {
  seq: number;
};

type RunRequest = CreateRunRequest & {
  clientToolManifest?: RunContext["request"]["clientToolManifest"];
  frontendBuildId?: string;
};

type RunSubscriber = (event: SpotlightServerRunEvent) => void;

interface PendingHostAction {
  correlationId: string;
  call: HostActionCall;
  resolve: (result: HostToolResultRequest) => void;
  reject: (error: Error) => void;
  /** Milliseconds elapsed while a browser was actually attached. */
  connectedMs: number;
  startedAt: number;
  dispatches: number;
  replaySafe: boolean;
  approvalRequired: boolean;
  approvalReason?: string;
}

interface RunState {
  id: string;
  sessionId: string | null;
  request: RunRequest;
  events: SpotlightServerRunEvent[];
  subscribers: Set<RunSubscriber>;
  pending: Map<string, PendingHostAction>;
  controller: AbortController;
  status: SpotlightRunStatus;
  observed: AgentUiContext | undefined;
  startedAt: number;
  seq: number;
  step: number;
  toolCalls: number;
  hostDispatches: number;
  hostRedispatches: number;
  matchedSkillNames: string[];
  watchdog: NodeJS.Timeout | null;
  contextMetrics: SpotlightContextMetrics;
  outputCharacters: number;
}

export interface RunManagerOptions {
  project: ProjectPack;
  model: BaseChatModel;
  router: IntentRouter;
  checkpointer: BaseCheckpointSaver;
  store: BaseStore;
  /** Budget for a host call while a browser is attached. */
  hostActionTimeoutMs?: number;
  /** Total wall-clock budget for a host call, including time spent disconnected. */
  hostActionMaxWaitMs?: number;
  runTtlMs?: number;
  durableState?: SpotlightDurableState;
  maxContextCharacters?: number;
}

const HOST_WATCHDOG_TICK_MS = 500;
const MAX_REMEMBERED_EXPIRED_RUNS = 1_000;

export class RunManager {
  private readonly runs = new Map<string, RunState>();
  private readonly runsBySession = new Map<string, Set<string>>();
  /** Ids of runs that finished and aged out, so the API can answer 410 not 404. */
  private readonly expired = new Set<string>();
  private readonly policy = new SpotlightPolicyEngine();

  constructor(private readonly options: RunManagerOptions) {}

  listServerToolNames(): string[] {
    return [
      "skill.invoke",
      "knowledge.answer",
      "knowledge.searchWeb",
      ...this.options.project.serverTools.map((tool) => tool.name),
    ];
  }

  providerIds(): { knowledge: string | null; webSearch: string | null } {
    return {
      knowledge: this.options.project.knowledgeProvider?.id ?? null,
      webSearch: this.options.project.webSearchProvider?.id ?? null,
    };
  }

  createRun(request: RunRequest): { id: string } {
    const prepared = prepareRunContext(
      request,
      this.options.maxContextCharacters,
    );
    request = prepared.request;
    const id = crypto.randomUUID();
    const sessionId = request.sessionId?.trim() || null;
    const run: RunState = {
      id,
      sessionId,
      request,
      events: [],
      subscribers: new Set(),
      pending: new Map(),
      controller: new AbortController(),
      status: "running",
      observed: request.uiContext,
      startedAt: Date.now(),
      seq: 0,
      step: 0,
      toolCalls: 0,
      hostDispatches: 0,
      hostRedispatches: 0,
      matchedSkillNames: [],
      watchdog: null,
      contextMetrics: prepared.metrics,
      outputCharacters: 0,
    };
    this.runs.set(id, run);
    if (sessionId) {
      const bucket = this.runsBySession.get(sessionId) ?? new Set<string>();
      bucket.add(id);
      this.runsBySession.set(sessionId, bucket);
    }
    if (sessionId) {
      this.options.durableState?.startTurn({
        id,
        threadId: sessionId,
        request: structuredClone(request),
        startedAt: run.startedAt,
        status: "in_progress",
        events: [],
      });
    }
    queueMicrotask(() => void this.execute(run));
    return { id };
  }

  getRun(id: string): RunState | undefined {
    return this.runs.get(id);
  }

  /** True when the run existed but its retention window has passed. */
  isExpired(id: string): boolean {
    return this.expired.has(id);
  }

  activeRunsForSession(sessionId: string): SpotlightActiveRun[] {
    const ids = this.runsBySession.get(sessionId);
    if (!ids) return [];
    const active: SpotlightActiveRun[] = [];
    for (const id of ids) {
      const run = this.runs.get(id);
      if (!run || isTerminalStatus(run.status)) continue;
      active.push({
        runId: run.id,
        status: run.status,
        startedAt: run.startedAt,
        lastEventSeq: run.seq,
      });
    }
    return active.sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * Attach a listener and replay everything after `afterSeq`.
   *
   * Host calls that are still outstanding are never replayed from history —
   * they are re-dispatched as fresh events below, so exactly one live copy of a
   * pending call reaches the browser no matter where the replay starts.
   */
  subscribe(
    id: string,
    listener: RunSubscriber,
    afterSeq = 0,
  ): (() => void) | null {
    const run = this.runs.get(id);
    if (!run) return null;
    for (const event of run.events) {
      if (event.seq <= afterSeq) continue;
      if (this.isOutstandingHostRequest(run, event)) continue;
      listener(event);
    }
    if (isTerminalStatus(run.status)) return () => undefined;
    run.subscribers.add(listener);
    this.redispatchPendingHostActions(run);
    return () => {
      run.subscribers.delete(listener);
      this.noteConnectionLoss(run);
    };
  }

  private isOutstandingHostRequest(
    run: RunState,
    event: SpotlightServerRunEvent,
  ): boolean {
    return (
      event.type === "host_action_request" &&
      run.pending.has(event.request.correlationId)
    );
  }

  private emit(run: RunState, body: SpotlightServerRunEventBody): void {
    run.seq += 1;
    const event = { ...body, seq: run.seq } as SpotlightServerRunEvent;
    run.events.push(event);
    this.options.durableState?.appendTurnEvent(run.id, event);
    for (const listener of run.subscribers) listener(event);
  }

  private setStatus(
    run: RunState,
    status: SpotlightRunStatus,
    detail?: string,
  ): void {
    if (run.status === status || isTerminalStatus(run.status)) return;
    run.status = status;
    this.emit(run, {
      type: "run_status",
      at: Date.now(),
      runId: run.id,
      status,
      detail,
    });
  }

  private finish(run: RunState, body: SpotlightServerRunEventBody): void {
    run.status = body.type === "run_completed" ? "completed" : "failed";
    this.stopWatchdog(run);
    for (const pending of run.pending.values()) {
      pending.reject(new Error("Run finished before the host replied"));
    }
    run.pending.clear();
    this.emit(run, body);
    this.options.durableState?.finishTurn(
      run.id,
      body.type === "run_completed" ? "completed" : "failed",
      body.type === "run_completed" ? body.assistantReply : undefined,
    );
    const timer = setTimeout(
      () => this.retire(run),
      this.options.runTtlMs ?? 10 * 60_000,
    );
    timer.unref();
  }

  private retire(run: RunState): void {
    this.runs.delete(run.id);
    if (run.sessionId) {
      const bucket = this.runsBySession.get(run.sessionId);
      bucket?.delete(run.id);
      if (bucket && bucket.size === 0) this.runsBySession.delete(run.sessionId);
    }
    if (this.expired.size >= MAX_REMEMBERED_EXPIRED_RUNS) {
      const oldest = this.expired.values().next().value;
      if (oldest) this.expired.delete(oldest);
    }
    this.expired.add(run.id);
  }

  private hostBridge(run: RunState): HostActionBridge {
    return {
      request: (call) =>
        new Promise<HostToolResultRequest>((resolve, reject) => {
          const descriptor = run.request.clientToolManifest?.tools.find(
            (tool) => tool.name === call.name,
          );
          if (!descriptor) {
            reject(new Error(`TOOL_NOT_REGISTERED: ${call.name}`));
            return;
          }
          const decision = this.policy.evaluate(descriptor, run.request.policy);
          if (decision.action === "deny") {
            reject(new Error(`TOOL_POLICY_DENIED: ${decision.reason}`));
            return;
          }
          const correlationId = crypto.randomUUID();
          run.pending.set(correlationId, {
            correlationId,
            call,
            resolve,
            reject,
            connectedMs: 0,
            startedAt: Date.now(),
            dispatches: 0,
            replaySafe: isToolTierReplaySafe(deriveToolTier(descriptor)),
            approvalRequired: decision.action === "require_approval",
            approvalReason: decision.action === "require_approval" ? decision.reason : undefined,
          });
          this.startWatchdog(run);
          this.dispatchHostAction(run, correlationId);
        }),
    };
  }

  private dispatchHostAction(run: RunState, correlationId: string): void {
    const pending = run.pending.get(correlationId);
    if (!pending) return;
    pending.dispatches += 1;
    run.hostDispatches += 1;
    if (pending.dispatches > 1) run.hostRedispatches += 1;
    this.emit(run, {
      type: "host_action_request",
      at: Date.now(),
      iteration: run.step,
      request: {
        correlationId,
        call: pending.call,
        dispatch: pending.dispatches,
        approvalRequired: pending.approvalRequired,
        approvalReason: pending.approvalReason,
      },
    });
  }

  /**
   * Re-send outstanding calls to a browser that just (re)connected.
   *
   * Safe without an acknowledgement protocol because every registered capability
   * is replay-safe; `assertRegisterableClientTools` rejects anything that is not.
   */
  private redispatchPendingHostActions(run: RunState): void {
    if (run.pending.size === 0) return;
    if (run.status === "waiting_for_host") {
      this.setStatus(run, "running", "浏览器已重新连接，正在重发未完成的页面调用。");
    }
    for (const pending of run.pending.values()) {
      if (pending.dispatches === 0) continue;
      if (!pending.replaySafe) continue;
      this.dispatchHostAction(run, pending.correlationId);
    }
  }

  private noteConnectionLoss(run: RunState): void {
    if (run.subscribers.size > 0 || run.pending.size === 0) return;
    this.setStatus(
      run,
      "waiting_for_host",
      "浏览器连接已断开，正在等待重新连接后继续。",
    );
  }

  private startWatchdog(run: RunState): void {
    if (run.watchdog) return;
    const connectedBudget = this.options.hostActionTimeoutMs ?? 30_000;
    const totalBudget = this.options.hostActionMaxWaitMs ?? 180_000;
    const timer = setInterval(() => {
      if (run.pending.size === 0) {
        this.stopWatchdog(run);
        return;
      }
      const attached = run.subscribers.size > 0;
      const now = Date.now();
      for (const pending of [...run.pending.values()]) {
        if (attached) pending.connectedMs += HOST_WATCHDOG_TICK_MS;
        const failure = attached && pending.connectedMs >= connectedBudget
          ? `Client tool timed out: ${pending.call.name}`
          : now - pending.startedAt >= totalBudget
            ? `Browser never came back for: ${pending.call.name}`
            : null;
        if (!failure) continue;
        run.pending.delete(pending.correlationId);
        pending.reject(new Error(failure));
      }
      if (run.pending.size === 0) this.stopWatchdog(run);
    }, HOST_WATCHDOG_TICK_MS);
    timer.unref();
    run.watchdog = timer;
  }

  private stopWatchdog(run: RunState): void {
    if (!run.watchdog) return;
    clearInterval(run.watchdog);
    run.watchdog = null;
  }

  completeHostAction(runId: string, result: HostToolResultRequest): boolean {
    const run = this.runs.get(runId);
    const pending = run?.pending.get(result.correlationId);
    if (!run || !pending) return false;
    run.pending.delete(result.correlationId);
    if (run.pending.size === 0) this.stopWatchdog(run);
    if (result.uiContext) run.observed = result.uiContext;
    if (run.status === "waiting_for_host") this.setStatus(run, "running");
    pending.resolve(result);
    return true;
  }

  cancelRun(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || isTerminalStatus(run.status)) return false;
    run.controller.abort(new Error("Run cancelled"));
    this.stopWatchdog(run);
    for (const pending of run.pending.values()) {
      pending.reject(new Error("Run cancelled"));
    }
    run.pending.clear();
    run.status = "cancelled";
    return true;
  }

  private runSummary(run: RunState): SpotlightRunSummary {
    return {
      steps: run.step,
      toolCalls: run.toolCalls,
      hostDispatches: run.hostDispatches,
      hostRedispatches: run.hostRedispatches,
      elapsedMs: Date.now() - run.startedAt,
      inputTokens: run.contextMetrics.estimatedInputTokens,
      outputTokens: Math.ceil(run.outputCharacters / 4),
      totalTokens:
        run.contextMetrics.estimatedInputTokens + Math.ceil(run.outputCharacters / 4),
      contextCharacters: run.contextMetrics.characters,
      contextCompacted: run.contextMetrics.compacted,
    };
  }

  private async execute(run: RunState): Promise<void> {
    const startedAt = run.startedAt;
    const turnId = crypto.randomUUID();
    this.emit(run, {
      type: "turn_transition",
      at: Date.now(),
      turnId,
      phase: "routing",
      summary: "正在识别本次请求属于知识问答、页面操作，还是需要补充信息。",
    });
    try {
      const context: RunContext = {
        request: run.request,
        runId: run.id,
        project: this.options.project,
        host: this.hostBridge(run),
        signal: run.controller.signal,
        observed: () => run.observed,
      };
      const graphOptions = {
        ...this.options,
        onPhase: (phase: string, summary: string) =>
          this.emit(run, {
            type: "turn_transition" as const,
            at: Date.now(),
            turnId,
            phase,
            summary,
            matchedSkillNames:
              phase === "router_done" ? run.matchedSkillNames : undefined,
          }),
        onDecision: (decision: IntentDecision) => {
          run.matchedSkillNames = [...(decision.matchedSkillNames ?? [])];
        },
        onTool: (event: SpotlightGraphToolEvent) => {
          if (event.type === "tool_start") {
            run.step += 1;
            run.toolCalls += 1;
            this.emit(run, {
              type: "tool_start",
              at: Date.now(),
              iteration: run.step,
              call: event.call,
            });
            return;
          }
          if (event.type === "tool_progress") {
            this.emit(run, {
              type: "tool_progress",
              at: Date.now(),
              iteration: run.step,
              call: event.call,
              summary: event.summary,
            });
            return;
          }
          this.emit(run, {
            type: "tool_result",
            at: Date.now(),
            iteration: run.step,
            result: {
              ...event.result,
              trace: event.result.trace ?? [],
            },
          });
        },
        onVoiceSentence: (sentence: { index: number; text: string }) =>
          this.emit(run, {
            type: "voice_sentence" as const,
            at: Date.now(),
            ...sentence,
          }),
      };
      const graph = compileSpotlightGraph(context, graphOptions);
      const runConfig = {
        ...workflowRunnableConfig(context),
        streamMode: ["custom"] as ["custom"],
      };

      const sessionContext = buildSessionContext(run.request);
      const priorState = await graph.getState(runConfig);
      const checkpointMessageCount = priorState?.values?.messages?.length ?? 0;
      const messages = initialMessagesForRun(
        structuredOutputQuestion(run.request.userQuestion, run.request.outputSchema),
        sessionContext,
        checkpointMessageCount,
      );

      const stream = await graph.stream(
        initialRuntimeState(run.request.userQuestion, messages),
        runConfig,
      );
      for await (const _chunk of stream) {
        // Custom stream events are also mirrored through onPhase/onTool.
      }
      const values = (await graph.getState(runConfig)).values;
      const result = {
        route: publicRouteFromLane(
          values.lane,
          values.invokedClientTools ?? [],
        ),
        assistantReply: validateStructuredOutput(
          values.assistantReply,
          run.request.outputSchema,
        ),
        decision: values.decision,
        invokedClientTools: values.invokedClientTools ?? [],
      };

      this.emit(run, {
        type: "assistant_response",
        at: Date.now(),
        iteration: run.step,
        content: result.assistantReply,
      });
      run.outputCharacters = result.assistantReply.length;
      this.finish(run, {
        type: "run_completed",
        at: Date.now(),
        runId: run.id,
        turnId,
        assistantReply: result.assistantReply,
        commandName: result.invokedClientTools.at(-1) ?? null,
        stopReason: result.route,
        failureClass: null,
        elapsedMs: Date.now() - startedAt,
        summary: this.runSummary(run),
      });
    } catch (error) {
      this.finish(run, {
        type: "run_error",
        at: Date.now(),
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function isTerminalStatus(status: SpotlightRunStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
