import type {
  SpotlightAgentMessageItem,
  SpotlightErrorItem,
  SpotlightItem,
  SpotlightKnowledgeSearchItem,
  SpotlightReasoningItem,
  SpotlightSkillUseItem,
  SpotlightToolCallItem,
  SpotlightTurn,
  SpotlightTurnEvent,
} from "@inupedia/spotlight-protocol";
import type { SpotlightServerRunEvent } from "./runManager.js";

type SpotlightTurnEventPayload<T = SpotlightTurnEvent> = T extends SpotlightTurnEvent
  ? Omit<T, "at" | "seq" | "threadId" | "turnId">
  : never;

function completedAt<T extends SpotlightItem>(item: T, at: number): T {
  return { ...item, status: "completed", completedAt: at };
}

function errorCode(error: string | undefined): string | undefined {
  const match = error?.match(/^([A-Z][A-Z0-9_]+):/u);
  return match?.[1];
}

function matchedSkills(summary: string | undefined): string[] {
  const value = summary?.match(/命中 Skill：([^；。]+)/u)?.[1];
  return value
    ? value.split(/[、,，]/u).map((name) => name.trim()).filter(Boolean)
    : [];
}

function isKnowledgeTool(name: string): boolean {
  return name === "web_search" || name === "project_knowledge_search";
}

/**
 * Converts LangGraph-specific run events into the stable Thread / Turn / Item
 * protocol. One projector belongs to one stream subscription so replay is
 * deterministic and independent from server process state.
 */
export class SpotlightLifecycleProjector {
  private sequence = 0;
  private readonly items = new Map<string, SpotlightItem>();
  private readonly skillNames: Map<string, string>;

  constructor(
    private readonly threadId: string,
    private readonly turnId: string,
    private readonly startedAt: number,
    skills: Array<{
      name: string;
      displayName?: string;
      interface?: { displayName?: string };
    }> = [],
  ) {
    this.skillNames = new Map(
      skills.map((skill) => [
        skill.name,
        skill.interface?.displayName ?? skill.displayName ?? skill.name,
      ]),
    );
  }

  startEvent(): SpotlightTurnEvent {
    const turn: SpotlightTurn = {
      id: this.turnId,
      threadId: this.threadId,
      status: "in_progress",
      startedAt: this.startedAt,
    };
    return this.envelope(this.startedAt, { type: "turn.started", turn });
  }

  private envelope(
    at: number,
    event: SpotlightTurnEventPayload,
  ): SpotlightTurnEvent {
    this.sequence += 1;
    return {
      ...event,
      at,
      seq: this.sequence,
      threadId: this.threadId,
      turnId: this.turnId,
    } as SpotlightTurnEvent;
  }

  private emitItem(
    at: number,
    kind: "item.started" | "item.updated" | "item.completed",
    item: SpotlightItem,
  ): SpotlightTurnEvent {
    this.items.set(item.id, item);
    return this.envelope(at, { type: kind, item });
  }

  private toolItem(event: Extract<SpotlightServerRunEvent, { type: "tool_start" }>) {
    const call = event.call;
    const target = call.name === "web_search" || call.name === "project_knowledge_search"
      ? "server" as const
      : "browser" as const;
    return {
      id: call.id,
      type: "tool_call" as const,
      tool: call.name,
      displayName: call.displayName,
      target,
      arguments: call.input,
      status: "in_progress" as const,
      startedAt: event.at,
    } satisfies SpotlightToolCallItem;
  }

  project(event: SpotlightServerRunEvent): SpotlightTurnEvent[] {
    const at = event.at;
    if (event.type === "turn_transition") {
      const item = completedAt({
        id: `reasoning:${event.seq}`,
        type: "reasoning",
        category: event.phase === "memory_recall"
          ? "memory"
          : event.phase === "routing" || event.phase === "analyzing" || event.phase === "router_done"
            ? "routing"
            : "progress",
        summary: event.summary ?? "正在处理请求。",
        status: "in_progress",
        startedAt: at,
      } satisfies SpotlightReasoningItem, at);
      const output = [this.emitItem(at, "item.completed", item)];
      const selectedSkills = event.matchedSkillNames ?? matchedSkills(event.summary);
      for (const skill of selectedSkills) {
        const skillItem = completedAt({
          id: `skill:${skill}:${event.seq}`,
          type: "skill_use",
          skill,
          displayName: this.skillNames.get(skill) ?? skill,
          source: "router",
          summary: `已选择 Skill：${skill}`,
          status: "in_progress",
          startedAt: at,
        } satisfies SpotlightSkillUseItem, at);
        output.push(this.emitItem(at, "item.completed", skillItem));
      }
      return output;
    }
    if (event.type === "run_status") {
      if (!event.detail?.trim()) return [];
      const item = completedAt({
        id: `progress:${event.seq}`,
        type: "reasoning",
        category: "progress",
        summary: event.detail.trim(),
        status: "in_progress",
        startedAt: at,
      } satisfies SpotlightReasoningItem, at);
      return [this.emitItem(at, "item.completed", item)];
    }
    if (event.type === "tool_start") {
      if (isKnowledgeTool(event.call.name)) {
        const item = {
          id: event.call.id,
          type: "knowledge_search",
          tool: event.call.name,
          displayName: event.call.displayName,
          provider: event.call.name === "web_search" ? "web" : "knowledge",
          query: typeof event.call.input.query === "string"
            ? event.call.input.query
            : "",
          source: event.call.name === "web_search" ? "web" : "knowledge",
          status: "in_progress",
          startedAt: at,
        } satisfies SpotlightKnowledgeSearchItem;
        return [this.emitItem(at, "item.started", item)];
      }
      return [this.emitItem(at, "item.started", this.toolItem(event))];
    }
    if (event.type === "tool_progress") {
      const previous = this.items.get(event.call.id);
      if (previous?.type === "knowledge_search") {
        return [this.emitItem(at, "item.updated", {
          ...previous,
          summary: event.summary,
        })];
      }
      const item: SpotlightToolCallItem = previous?.type === "tool_call"
        ? { ...previous, summary: event.summary }
        : {
            id: event.call.id,
            type: "tool_call",
            tool: event.call.name,
            displayName: event.call.displayName,
            target: "server",
            arguments: event.call.input,
            summary: event.summary,
            status: "in_progress",
            startedAt: at,
          };
      return [this.emitItem(at, previous ? "item.updated" : "item.started", item)];
    }
    if (event.type === "host_action_request") {
      const call = event.request.call;
      const previous = this.items.get(call.id);
      const item: SpotlightToolCallItem = {
        ...(previous?.type === "tool_call" ? previous : {
          id: call.id,
          type: "tool_call",
          tool: call.name,
          displayName: call.displayName,
          target: "browser",
          arguments: call.input,
          startedAt: at,
        }),
        status: "waiting_for_client",
        clientRequest: {
          correlationId: event.request.correlationId,
          dispatch: event.request.dispatch,
          approvalRequired: event.request.approvalRequired,
          approvalReason: event.request.approvalReason,
        },
      };
      return [this.emitItem(at, previous ? "item.updated" : "item.started", item)];
    }
    if (event.type === "tool_result") {
      const previous = this.items.get(event.result.call.id);
      if (previous?.type === "knowledge_search") {
        const output = event.result.output;
        const resultCount = Array.isArray(output) ? output.length : undefined;
        const item: SpotlightKnowledgeSearchItem = {
          ...previous,
          status: event.result.success ? "completed" : "failed",
          completedAt: at,
          resultCount,
          summary: event.result.summary,
          result: event.result.output,
        };
        return [this.emitItem(at, "item.completed", item)];
      }
      const item: SpotlightToolCallItem = {
        ...(previous?.type === "tool_call" ? previous : {
          id: event.result.call.id,
          type: "tool_call",
          tool: event.result.call.name,
          displayName: event.result.call.displayName,
          target: "server",
          arguments: event.result.call.input,
          startedAt: at,
        }),
        status: event.result.success ? "completed" : "failed",
        completedAt: at,
        summary: event.result.summary,
        result: event.result.output,
        error: event.result.success ? undefined : {
          code: errorCode(event.result.error),
          message: event.result.error ?? event.result.summary,
          retryable: false,
        },
        trace: event.result.trace,
        clientRequest: undefined,
      };
      return [this.emitItem(at, "item.completed", item)];
    }
    if (event.type === "assistant_response") {
      const item = completedAt({
        id: `message:${this.turnId}`,
        type: "agent_message",
        text: event.content,
        status: "in_progress",
        startedAt: at,
      } satisfies SpotlightAgentMessageItem, at);
      return [this.emitItem(at, "item.completed", item)];
    }
    if (event.type === "run_completed") {
      const turn: SpotlightTurn = {
        id: this.turnId,
        threadId: this.threadId,
        status: "completed",
        startedAt: this.startedAt,
      };
      return [this.envelope(at, {
        type: "turn.completed",
        turn,
        finalResponse: event.assistantReply,
        summary: {
          items: this.items.size,
          toolCalls: event.summary.toolCalls,
          hostDispatches: event.summary.hostDispatches,
          hostRedispatches: event.summary.hostRedispatches,
          elapsedMs: event.summary.elapsedMs,
          inputTokens: event.summary.inputTokens,
          outputTokens: event.summary.outputTokens,
          totalTokens: event.summary.totalTokens,
          estimatedCostUsd: event.summary.estimatedCostUsd,
          contextCharacters: event.summary.contextCharacters,
          contextCompacted: event.summary.contextCompacted,
        },
        metadata: {
          commandName: event.commandName,
          stopReason: event.stopReason,
        },
      })];
    }
    const errorItem = completedAt({
      id: `error:${this.turnId}`,
      type: "error",
      message: event.error,
      status: "failed",
      startedAt: at,
    } satisfies SpotlightErrorItem, at);
    const itemEvent = this.emitItem(at, "item.completed", errorItem);
    const turn: SpotlightTurn = {
      id: this.turnId,
      threadId: this.threadId,
      status: "failed",
      startedAt: this.startedAt,
    };
    return [itemEvent, this.envelope(at, {
      type: "turn.failed",
      turn,
      error: { message: event.error },
    })];
  }
}
