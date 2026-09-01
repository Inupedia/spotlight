import type {
  HostToolEffect,
  ToolExecutionTarget,
  ToolTraceEvent,
} from "@inupedia/spotlight-protocol";
import type { ToolResult } from "../../types/toolResult.js";
import type {
  AgentStep,
  AgentStepAttachment,
  AgentStepChatItem,
  AgentStepFile,
  AgentStepToolCall,
  SpotlightArtifact,
} from "../types";

export type SpotlightStepContentChannel =
  | "body"
  | "planning"
  | "answer"
  | "tool"
  | "trace";

export type SpotlightLoopAction = "respond" | "call_tools" | "fallback";
export type SpotlightTurnStopReason =
  | "completed"
  | "cancelled"
  | "max_turns_exhausted"
  | "tool_failure_unrecoverable"
  | "runtime_error";

export type SpotlightTurnFailureClass =
  | "tool"
  | "runtime"
  | "cancel"
  | "llm"
  | null;

export type SpotlightTurnPhase =
  | "handle_session_control"
  | "memory_recall"
  | "analyzing"
  | "routing"
  | "router_done"
  | "knowledge_agent_start"
  | "knowledge_agent_done"
  | "action_agent_start"
  | "action_agent_done"
  | "voice_briefing_start"
  | "voice_briefing_done"
  | "voice_speak_start"
  | "voice_speak_done"
  | "query_planning"
  | "tool_execution"
  | "responding"
  | "completed"
  | "cancelled"
  | "failed";

export interface SpotlightTurnBudgetUsage {
  maxLoopTurns: number;
  iterationsUsed: number;
  toolCallsExecuted: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  contextCharsUsed: number;
  recentTurnsUsed: number;
}

export interface SpotlightToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  displayName: string;
}

export interface SpotlightToolResult {
  call: SpotlightToolCall;
  success: boolean;
  summary: string;
  output?: unknown;
  error?: string;
  errorCode?: ToolResult["errorCode"];
  executionTarget?: ToolExecutionTarget;
  hostEffect?: HostToolEffect;
  trace: ToolTraceEvent[];
  attachments?: AgentStepAttachment[];
  files?: AgentStepFile[];
  toolCalls?: AgentStepToolCall[];
}

export type SpotlightExecutionEvent =
  | {
      type: "step_sync";
      at: number;
      steps: Array<Pick<AgentStep, "id" | "label" | "status">>;
    }
  | {
      type: "step_status";
      at: number;
      stepId: string;
      label: string | null;
      status: AgentStep["status"];
      content?: string;
      channel?: SpotlightStepContentChannel;
    }
  | {
      type: "step_content";
      at: number;
      stepId: string;
      label: string | null;
      mode: "replace" | "append";
      content: string;
      channel?: SpotlightStepContentChannel;
    }
  | {
      type: "step_artifact";
      at: number;
      stepId: string;
      label: string | null;
      artifact:
        | "attachments"
        | "files"
        | "artifacts"
        | "tool_calls"
        | "chat_items";
      count: number;
      attachments?: AgentStepAttachment[];
      files?: AgentStepFile[];
      artifacts?: SpotlightArtifact[];
      toolCalls?: AgentStepToolCall[];
      chatItems?: AgentStepChatItem[];
    }
  | {
      type: "turn_transition";
      at: number;
      turnId: string;
      phase: SpotlightTurnPhase;
      iteration?: number;
      summary?: string;
    }
  | {
      type: "plan";
      at: number;
      iteration: number;
      action: SpotlightLoopAction;
      summary: string;
    }
  | {
      type: "tool_start";
      at: number;
      iteration: number;
      call: SpotlightToolCall;
    }
  | {
      type: "tool_progress";
      at: number;
      iteration: number;
      call: SpotlightToolCall;
      summary: string;
    }
  | {
      type: "tool_result";
      at: number;
      iteration: number;
      result: SpotlightToolResult;
    }
  | {
      type: "tool_trace";
      at: number;
      iteration: number;
      toolName: string;
      trace: ToolTraceEvent[];
    }
  | {
      type: "assistant_response";
      at: number;
      iteration: number;
      content: string;
    }
  | {
      type: "llm_error";
      at: number;
      iteration: number;
      error: string;
    }
  | {
      type: "turn_completed";
      at: number;
      turnId: string;
      assistantReply: string | null;
      commandName: string | null;
      stopReason: SpotlightTurnStopReason;
      failureClass: SpotlightTurnFailureClass;
      elapsedMs: number;
      budgetUsage: SpotlightTurnBudgetUsage;
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
    };

export interface SpotlightLoopDecisionToolCall {
  name: string;
  input: Record<string, unknown>;
}
