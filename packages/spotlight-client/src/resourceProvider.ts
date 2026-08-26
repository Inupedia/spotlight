import type {
  SpotlightResourceRef,
  SpotlightResourceSearchInput,
  SpotlightResourceSearchResult,
  SpotlightSkill,
} from "@inupedia/spotlight-protocol";
import { defineTool, type ClientTool } from "./clientTool.js";

export interface SpotlightResourceAction<
  TResource extends SpotlightResourceRef,
> {
  /** Public Tool name. Defaults to `${namespace}_${action}`. */
  toolName?: string;
  description: string;
  handler: (resource: TResource) => unknown | Promise<unknown>;
  tier?: "observe" | "query" | "navigate";
}

export interface SpotlightResourceProviderOptions<
  TResource extends SpotlightResourceRef,
> {
  namespace: string;
  description: string;
  search(
    input: SpotlightResourceSearchInput,
  ): Promise<SpotlightResourceSearchResult<TResource>>;
  get?(id: string): Promise<TResource | null>;
  actions?: Record<string, SpotlightResourceAction<TResource>>;
  /** Defaults to a generated resource Skill. Set false when a richer consumer Skill already exists. */
  skill?:
    | false
    | {
        name?: string;
        displayName?: string;
        description?: string;
        whenToUse?: string;
        capabilityExamples?: string[];
      };
}

export interface SpotlightResourceProvider<
  TResource extends SpotlightResourceRef = SpotlightResourceRef,
> {
  namespace: string;
  description: string;
  tools: ClientTool[];
  skill?: SpotlightSkill;
  search(
    input: SpotlightResourceSearchInput,
  ): Promise<SpotlightResourceSearchResult<TResource>>;
  resolve(query: string): Promise<TResource>;
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function scoreResource(query: string, resource: SpotlightResourceRef): number {
  const q = normalized(query);
  const candidates = [resource.id, resource.name, ...(resource.aliases ?? [])]
    .map(normalized)
    .filter(Boolean);
  if (candidates.some((candidate) => candidate === q)) return 10_000;
  const contained = candidates
    .filter((candidate) => q.includes(candidate) || candidate.includes(q))
    .map((candidate) => candidate.length);
  return contained.length > 0 ? 1_000 + Math.max(...contained) : 0;
}

function toolSafeNamespace(value: string): string {
  const normalizedValue = value.trim().replace(/[^a-zA-Z0-9_-]/gu, "_");
  if (!normalizedValue) {
    throw new Error("Resource namespace must contain a tool-safe identifier");
  }
  return normalizedValue;
}

export function defineResourceProvider<TResource extends SpotlightResourceRef>(
  options: SpotlightResourceProviderOptions<TResource>,
): SpotlightResourceProvider<TResource> {
  const namespace = toolSafeNamespace(options.namespace);
  const resolve = async (query: string): Promise<TResource> => {
    const direct = options.get ? await options.get(query) : null;
    if (direct) return direct;
    const result = await options.search({ query, limit: 20 });
    const ranked = result.items
      .map((resource) => ({ resource, score: scoreResource(query, resource) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best) {
      throw new Error(`RESOURCE_NOT_FOUND: ${options.namespace}:${query}`);
    }
    const ties = ranked.filter((item) => item.score === best.score);
    if (new Set(ties.map((item) => item.resource.id)).size > 1) {
      throw new Error(
        `RESOURCE_AMBIGUOUS: ${options.namespace}:${query}; matches ${ties
          .map((item) => item.resource.name)
          .join(", ")}`,
      );
    }
    return best.resource;
  };

  const searchToolName = `${namespace}_search`;
  const searchTool = defineTool({
    name: searchToolName,
    description: `Search ${options.description}. Use this for lists, discovery, status and ambiguous names.`,
    namespace,
    deferLoading: true,
    tier: "query",
    sideEffect: "none",
    replayPolicy: "safe",
    resource: { namespace, operation: "search", inputKey: "query" },
    schema: {
      input: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          cursor: { type: "string" },
          filters: { type: "object" },
        },
        additionalProperties: false,
      },
    },
    handler: (input: SpotlightResourceSearchInput) => options.search(input),
  });

  const getToolName = `${namespace}_get`;
  const getTool = options.get
    ? defineTool({
        name: getToolName,
        description: `Get one ${options.description} resource by its stable id.`,
        namespace,
        deferLoading: true,
        tier: "query",
        sideEffect: "none",
        replayPolicy: "safe",
        resource: { namespace, operation: "get", inputKey: "id" },
        schema: {
          input: {
            type: "object",
            properties: { id: { type: "string", minLength: 1 } },
            required: ["id"],
            additionalProperties: false,
          },
        },
        handler: ({ id }: { id: string }) => options.get!(id),
      })
    : null;

  const actionEntries = Object.entries(options.actions ?? {});
  const actionTools = actionEntries.map(([action, definition]) => {
    const toolName = definition.toolName ?? `${namespace}_${action}`;
    return defineTool({
      name: toolName,
      description: definition.description,
      namespace,
      tier: definition.tier ?? "navigate",
      sideEffect: "ui",
      replayPolicy: "safe",
      resource: {
        namespace,
        operation: "action",
        action,
        inputKey: "query",
      },
      schema: {
        input: {
          type: "object",
          properties: { query: { type: "string", minLength: 1 } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      handler: async ({ query }: { query: string }) =>
        definition.handler(await resolve(query)),
    });
  });

  const tools = [searchTool, ...(getTool ? [getTool] : []), ...actionTools];
  const toolNames = [
    searchToolName,
    ...(getTool ? [getToolName] : []),
    ...actionEntries.map(
      ([action, definition]) => definition.toolName ?? `${namespace}_${action}`,
    ),
  ];
  const skillOptions = options.skill === false ? null : (options.skill ?? {});
  const skill = skillOptions
    ? {
        name: skillOptions.name ?? `skill.resource.${namespace}`,
        displayName: skillOptions.displayName ?? options.description,
        description:
          skillOptions.description ??
          `Search and operate ${options.description}.`,
        whenToUse:
          skillOptions.whenToUse ??
          `Use when the user asks about ${options.description}.`,
        responseStrategy: "tool_answer" as const,
        allowedTools: toolNames,
        capabilityExamples: skillOptions.capabilityExamples,
        policy: { allowImplicitInvocation: true },
      }
    : undefined;

  return {
    namespace,
    description: options.description,
    tools,
    skill,
    search: options.search,
    resolve,
  };
}
