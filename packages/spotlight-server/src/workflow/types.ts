import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import type { ToolTraceEvent } from "@inupedia/spotlight-protocol";
import type { SpotlightToolCallInfo } from "../contracts.js";
import type { IntentRouter } from "../router.js";
import type { IntentDecision } from "../contracts.js";

export type SpotlightGraphToolEvent =
  | { type: "tool_start"; call: SpotlightToolCallInfo }
  | { type: "tool_progress"; call: SpotlightToolCallInfo; summary: string }
  | {
      type: "tool_result";
      result: {
        call: SpotlightToolCallInfo;
        success: boolean;
        summary: string;
        output?: unknown;
        error?: string;
        /** Executor timeline reported by the browser, surfaced to the thinking bar. */
        trace?: ToolTraceEvent[];
      };
    };

export interface SpotlightGraphOptions {
  model: BaseChatModel;
  router: IntentRouter;
  checkpointer: BaseCheckpointSaver;
  store: BaseStore;
  onPhase?: (phase: string, summary: string) => void;
  onDecision?: (decision: IntentDecision) => void;
  onTool?: (event: SpotlightGraphToolEvent) => void;
}

export type WorkflowStreamEvent =
  | { kind: "phase"; phase: string; summary: string }
  | { kind: "tool"; event: SpotlightGraphToolEvent };
