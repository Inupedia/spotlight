import { tool } from "langchain";
import type {
  FrontendToolDescriptorV1,
  ToolTraceEvent,
} from "@inupedia/spotlight-protocol";
import { validateJsonSchemaValue } from "@inupedia/spotlight-protocol";
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
export interface ClientToolInputNormalizationRemoval {
  path: string;
  reason: "optional_null" | "optional_undefined" | "unknown_property";
}

export interface ClientToolInputNormalizationResult {
  input: Record<string, unknown>;
  removed: ClientToolInputNormalizationRemoval[];
}

function schemaAllowsNull(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const candidate = schema as Record<string, unknown>;
  if (candidate.type === "null") return true;
  if (Array.isArray(candidate.type) && candidate.type.includes("null")) {
    return true;
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    if (
      Array.isArray(candidate[key]) &&
      candidate[key].some((item) => schemaAllowsNull(item))
    ) {
      return true;
    }
  }
  return false;
}

function normalizeSchemaValue(
  value: unknown,
  schema: unknown,
  path: string,
  removed: ClientToolInputNormalizationRemoval[],
): unknown {
  if (!schema || typeof schema !== "object") return value;
  const candidate = schema as Record<string, unknown>;
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeSchemaValue(item, candidate.items, `${path}[${index}]`, removed),
    );
  }
  if (!value || typeof value !== "object") return value;

  const properties =
    candidate.properties && typeof candidate.properties === "object"
      ? (candidate.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(candidate.required)
      ? candidate.required.filter(
          (field): field is string => typeof field === "string",
        )
      : [],
  );
  const rejectUnknown = candidate.additionalProperties === false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const itemPath = `${path}.${key}`;
    const itemSchema = properties[key];
    if (rejectUnknown && !Object.hasOwn(properties, key)) {
      removed.push({ path: itemPath, reason: "unknown_property" });
      continue;
    }
    if (item === undefined && !required.has(key)) {
      removed.push({ path: itemPath, reason: "optional_undefined" });
      continue;
    }
    if (item === null && !required.has(key) && !schemaAllowsNull(itemSchema)) {
      removed.push({ path: itemPath, reason: "optional_null" });
      continue;
    }
    result[key] = normalizeSchemaValue(item, itemSchema, itemPath, removed);
  }
  return result;
}

export function normalizeClientToolInputDetailed(
  descriptor: FrontendToolDescriptorV1,
  input: Record<string, unknown>,
): ClientToolInputNormalizationResult {
  const schema = descriptor.inputSchema;
  if (!schema || typeof schema !== "object") {
    return { input: { ...input }, removed: [] };
  }
  const removed: ClientToolInputNormalizationRemoval[] = [];
  return {
    input: normalizeSchemaValue(input, schema, "$", removed) as Record<
      string,
      unknown
    >,
    removed,
  };
}

export function normalizeClientToolInput(
  descriptor: FrontendToolDescriptorV1,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeClientToolInputDetailed(descriptor, input).input;
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
      const validation = validateJsonSchemaValue(input, descriptor.inputSchema);
      if (!validation.valid) {
        throw new Error(
          `TOOL_INPUT_INVALID: ${descriptor.name}: ${validation.issues
            .map((issue) => `${issue.path} ${issue.message}`)
            .join("; ")}`,
        );
      }
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
            name: "remember_user_memory",
            input: { key, value },
            displayName: "保存长期记忆",
          };
          progress?.onStart?.(call);
          try {
            await store.put(namespace, key, {
              schemaVersion: 1,
              kind: "user_memory",
              value,
              source: "user_explicit",
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
          name: "remember_user_memory",
          description:
            "Persist one user preference or stable fact only when the user explicitly asks to remember it.",
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
            name: "forget_user_memory",
            input: { key },
            displayName: "删除长期记忆",
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
          name: "forget_user_memory",
          description:
            "Delete one persisted user memory only when the user explicitly asks to forget it.",
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
