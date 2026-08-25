import { tool } from "langchain";
import type {
  FrontendToolDescriptorV1,
  ToolTraceEvent,
} from "@inupedia/spotlight-protocol";
import { z } from "zod";
import type { BaseStore } from "@langchain/langgraph";
import type {
  KnowledgeEvidence,
  KnowledgeProvider,
  RunContext,
  SpotlightKnowledgeToolStreamEvent,
  SpotlightServerTool,
  SpotlightToolCallInfo,
  WebSearchProvider,
} from "./contracts.js";
import { assertServerToolMetadata } from "./safety.js";

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function langChainClientToolName(name: string): string {
  return `client_${name.replace(/[^a-zA-Z0-9_-]/gu, "_")}`;
}

export interface LangChainToolProgress {
  onStart?: (call: SpotlightToolCallInfo) => void;
  onComplete?: (
    call: SpotlightToolCallInfo,
    result: {
      success: boolean;
      output?: unknown;
      error?: string;
      trace?: ToolTraceEvent[];
    },
  ) => void;
}

/**
 * Structured-output models commonly emit null for optional tool fields. JSON
 * Schema treats an omitted optional string differently from a nullable string,
 * so remove only absent optional values before LangChain validates/invokes the
 * selected client tool. Unknown fields are also discarded when the consumer
 * manifest explicitly forbids them.
 */
export function normalizeClientToolInput(
  descriptor: FrontendToolDescriptorV1,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const schema = descriptor.inputSchema;
  if (!schema || typeof schema !== "object") return { ...input };
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (field): field is string => typeof field === "string",
        )
      : [],
  );
  const rejectUnknown = schema.additionalProperties === false;

  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => {
      if (rejectUnknown && !Object.hasOwn(properties, key)) return false;
      if ((value === null || value === undefined) && !required.has(key)) {
        return false;
      }
      return true;
    }),
  );
}

export function createClientLangChainTool(
  descriptor: FrontendToolDescriptorV1,
  context: RunContext,
  invoked: string[],
  progress?: LangChainToolProgress,
) {
  let completedOutput: string | undefined;
  return tool(
    async (input: Record<string, unknown>) => {
      if (completedOutput !== undefined) return completedOutput;
      const call: SpotlightToolCallInfo = {
        id: crypto.randomUUID(),
        name: descriptor.name,
        input,
        displayName: descriptor.description || descriptor.name,
      };
      progress?.onStart?.(call);
      let reported = false;
      try {
        const result = await context.host.request(call);
        if (!result.success) {
          const error =
            result.error || `Client tool failed: ${descriptor.name}`;
          progress?.onComplete?.(call, {
            success: false,
            error,
            trace: result.trace,
          });
          reported = true;
          throw new Error(error);
        }
        invoked.push(descriptor.name);
        completedOutput = stringify(result.output ?? { success: true });
        progress?.onComplete?.(call, {
          success: true,
          output: result.output,
          trace: result.trace,
        });
        reported = true;
        return completedOutput;
      } catch (error) {
        if (!reported) {
          progress?.onComplete?.(call, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
    {
      name: langChainClientToolName(descriptor.name),
      description: `${descriptor.description} (client capability: ${descriptor.name})`,
      schema: descriptor.inputSchema,
    },
  );
}

export function createServerLangChainTool(
  definition: SpotlightServerTool,
  context: RunContext,
  progress?: ServerToolProgress,
) {
  assertServerToolMetadata(definition);
  return tool(
    async (input: Record<string, unknown>) => {
      progress?.onStart?.(input);
      try {
        const output = await definition.invoke(input, context);
        progress?.onComplete?.(input, output);
        return stringify(output);
      } catch (error) {
        progress?.onError?.(input, error);
        throw error;
      }
    },
    {
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
    },
  );
}

const searchSchema = z.object({
  query: z.string().min(1).describe("Search query"),
  limit: z.number().int().min(1).max(20).optional(),
});

const rememberSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .describe("Short stable key for the preference or fact"),
  value: z
    .string()
    .min(1)
    .max(2000)
    .describe("The exact user-provided preference or fact to remember"),
});

const forgetSchema = z.object({
  key: z.string().min(1).max(120).describe("Key of the memory to delete"),
});

export interface SearchToolProgress {
  onStart?: (input: { query: string; limit?: number }) => void;
  onComplete?: (
    input: { query: string; limit?: number },
    evidence: KnowledgeEvidence[],
  ) => void;
  onError?: (input: { query: string; limit?: number }, error: unknown) => void;
  onNestedTool?: (event: SpotlightKnowledgeToolStreamEvent) => void;
}

export interface ServerToolProgress {
  onStart?: (input: Record<string, unknown>) => void;
  onComplete?: (input: Record<string, unknown>, output: unknown) => void;
  onError?: (input: Record<string, unknown>, error: unknown) => void;
}

export function memoryNamespace(
  projectId: string,
  subjectId: string,
): string[] {
  return [projectId, "subjects", subjectId];
}

export function createLongTermMemoryTools(
  store: BaseStore,
  namespace: string[],
  mode: "remember" | "forget" | "both",
  progress?: LangChainToolProgress,
) {
  const tools = [];
  if (mode === "remember" || mode === "both") {
    tools.push(
      tool(
        async ({ key, value }) => {
          const call: SpotlightToolCallInfo = {
            id: crypto.randomUUID(),
            name: "remember_user_preference",
            input: { key, value },
            displayName: "记住用户偏好",
          };
          progress?.onStart?.(call);
          try {
            await store.put(namespace, key, {
              value,
              updatedAt: new Date().toISOString(),
            });
            const output = `Remembered ${key}.`;
            progress?.onComplete?.(call, { success: true, output });
            return output;
          } catch (error) {
            progress?.onComplete?.(call, {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        {
          name: "remember_user_preference",
          description:
            "Persist a user preference or fact only when the user explicitly asks to remember it.",
          schema: rememberSchema,
        },
      ),
    );
  }
  if (mode === "forget" || mode === "both") {
    tools.push(
      tool(
        async ({ key }) => {
          const call: SpotlightToolCallInfo = {
            id: crypto.randomUUID(),
            name: "forget_user_preference",
            input: { key },
            displayName: "忘记用户偏好",
          };
          progress?.onStart?.(call);
          try {
            await store.delete(namespace, key);
            const output = `Forgot ${key}.`;
            progress?.onComplete?.(call, { success: true, output });
            return output;
          } catch (error) {
            progress?.onComplete?.(call, {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        {
          name: "forget_user_preference",
          description:
            "Delete a persisted preference only when the user explicitly asks to forget it.",
          schema: forgetSchema,
        },
      ),
    );
  }
  return tools;
}

export function createKnowledgeTool(
  provider: KnowledgeProvider,
  context: RunContext,
  progress?: SearchToolProgress,
) {
  return tool(
    async ({ query, limit }) => {
      const input = { query, ...(limit === undefined ? {} : { limit }) };
      progress?.onStart?.(input);
      try {
        const evidence = await provider.search({
          ...input,
          projectId: context.project.projectId,
          sessionId: context.request.sessionId ?? context.runId,
          signal: context.signal,
          onToolEvent: progress?.onNestedTool,
        });
        progress?.onComplete?.(input, evidence);
        return stringify(evidence);
      } catch (error) {
        progress?.onError?.(input, error);
        throw error;
      }
    },
    {
      name: "project_knowledge_search",
      description:
        "Search the configured project knowledge base and return source evidence.",
      schema: searchSchema,
    },
  );
}

export function createWebSearchTool(
  provider: WebSearchProvider,
  context: RunContext,
  progress?: SearchToolProgress,
) {
  return tool(
    async ({ query, limit }) => {
      const input = { query, ...(limit === undefined ? {} : { limit }) };
      progress?.onStart?.(input);
      try {
        const evidence = await provider.search({
          ...input,
          projectId: context.project.projectId,
          sessionId: context.request.sessionId ?? context.runId,
          signal: context.signal,
          onToolEvent: progress?.onNestedTool,
        });
        progress?.onComplete?.(input, evidence);
        return stringify(evidence);
      } catch (error) {
        progress?.onError?.(input, error);
        throw error;
      }
    },
    {
      name: "web_search",
      description:
        "Search the web for current evidence using the configured provider.",
      schema: searchSchema,
    },
  );
}
