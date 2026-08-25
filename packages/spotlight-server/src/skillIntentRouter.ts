import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type {
  FrontendToolDescriptorV1,
  SpotlightSkill,
} from "@inupedia/spotlight-protocol";
import { z } from "zod";

const skillRouteSchema = z.object({
  route: z.enum(["knowledge", "action", "clarify"]),
  matchedSkillNames: z.array(z.string()).default([]),
  requestedToolNames: z.array(z.string()).default([]),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export type SkillRouteResult = z.infer<typeof skillRouteSchema>;

const LIST_QUERY_PATTERN =
  /(?:有哪些|多少|几路|清单|列表|数量|在线状态|覆盖哪些|有几个|list|how many|what .*available)/iu;
const OPEN_TARGET_VERB_PATTERN =
  /(?:看看|查看|打开|显示|播放|进入|定位|open|show|view|play|navigate to|go to)/iu;
const OPEN_TOOL_NAME_PATTERN =
  /^(?:open|show|view|play|navigate|select|focus|display|enter|locate)/i;
const CATALOG_TOOL_DESCRIPTION_PATTERN =
  /(?:list|catalog|directory|列表|清单|目录)/iu;

function toolsForSkill(
  skill: SpotlightSkill,
  clientTools: FrontendToolDescriptorV1[],
): FrontendToolDescriptorV1[] {
  const allowed = new Set(skill.allowedTools ?? []);
  return clientTools.filter((tool) => allowed.has(tool.name));
}

function inferReadOnlyTool(
  skills: SpotlightSkill[],
  clientTools: FrontendToolDescriptorV1[],
): string | null {
  const readOnly = new Set(
    clientTools
      .filter((tool) => tool.sideEffect === "none")
      .map((tool) => tool.name),
  );
  for (const skill of skills) {
    const candidates = (skill.allowedTools ?? []).filter((name) =>
      readOnly.has(name),
    );
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

function requiredStringInputKeys(tool: FrontendToolDescriptorV1): string[] {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: unknown }>;
    required?: unknown;
  };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const properties = schema.properties ?? {};
  return required.filter((key) => properties[key]?.type === "string");
}

function targetStringInputKey(
  tool: FrontendToolDescriptorV1,
): string | undefined {
  const required = requiredStringInputKeys(tool);
  if (required.length === 1) return required[0];
  const properties =
    tool.inputSchema?.properties &&
    typeof tool.inputSchema.properties === "object"
      ? (tool.inputSchema.properties as Record<string, { type?: unknown }>)
      : {};
  const stringKeys = Object.entries(properties)
    .filter(([, schema]) => schema?.type === "string")
    .map(([key]) => key);
  const preferred = ["name", "target", "query", "title", "label"];
  return (
    preferred.find((key) => stringKeys.includes(key)) ??
    (stringKeys.length === 1 ? stringKeys[0] : undefined)
  );
}

function inferOpenTool(
  skill: SpotlightSkill,
  clientTools: FrontendToolDescriptorV1[],
): FrontendToolDescriptorV1 | null {
  const tools = toolsForSkill(skill, clientTools).filter(
    (tool) => tool.sideEffect !== "none",
  );
  const explicitlyOpen = tools.filter((tool) =>
    OPEN_TOOL_NAME_PATTERN.test(tool.name),
  );
  const targetable = explicitlyOpen.filter((tool) =>
    targetStringInputKey(tool),
  );
  if (targetable.length === 1) return targetable[0];
  return explicitlyOpen.length === 1 ? explicitlyOpen[0] : null;
}

function registeredToolMap(clientTools: FrontendToolDescriptorV1[]) {
  return new Map(clientTools.map((tool) => [tool.name, tool]));
}

export function isSkillListQuery(question: string): boolean {
  return LIST_QUERY_PATTERN.test(question);
}

export function hasOpenTargetIntent(question: string): boolean {
  return OPEN_TARGET_VERB_PATTERN.test(question) && !isSkillListQuery(question);
}

export function extractOpenTargetName(question: string): string | undefined {
  const normalized = question
    .trim()
    .replace(/^(请|帮我|给我|please\s+|could you\s+|can you\s+)?/iu, "")
    .replace(
      /^(看看|查看|打开|显示|播放|进入|定位|open|show|view|play|navigate to|go to)\s*/iu,
      "",
    )
    .trim();
  return normalized || undefined;
}

/** @deprecated Use extractOpenTargetName. Kept for compatibility with older imports. */
export function extractMonitorTargetName(question: string): string | undefined {
  return extractOpenTargetName(question);
}

function buildTargetInput(
  tool: FrontendToolDescriptorV1,
  question: string,
  currentInput?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const target = extractOpenTargetName(question);
  if (!target) return currentInput;
  const key = targetStringInputKey(tool);
  if (!key) return currentInput;
  return { ...(currentInput ?? {}), [key]: target };
}

export function enrichSkillToolRoute(
  question: string,
  route: SkillRouteResult,
  skills: SpotlightSkill[],
  clientTools: FrontendToolDescriptorV1[],
): SkillRouteResult {
  if (route.route !== "action") return route;
  const registered = registeredToolMap(clientTools);
  const matched = skills.filter((skill) =>
    route.matchedSkillNames.includes(skill.name),
  );
  if (matched.length !== 1) return route;

  const skill = matched[0];
  const openIntent = hasOpenTargetIntent(question);
  const listIntent = isSkillListQuery(question);

  if (listIntent) {
    const readTool = inferReadOnlyTool([skill], clientTools);
    if (readTool && registered.has(readTool)) {
      return {
        ...route,
        requestedToolNames: [readTool],
        toolInput: route.toolInput ?? {},
        reason: `${route.reason} Generic list intent → ${readTool}.`,
      };
    }
  }

  if (openIntent) {
    const openTool = inferOpenTool(skill, clientTools);
    if (openTool) {
      const selected = route.requestedToolNames[0];
      const selectedTool = selected ? registered.get(selected) : undefined;
      const shouldCorrect =
        !selectedTool ||
        selectedTool.sideEffect === "none" ||
        CATALOG_TOOL_DESCRIPTION_PATTERN.test(selectedTool.description) ||
        !OPEN_TOOL_NAME_PATTERN.test(selectedTool.name);
      if (shouldCorrect || selected === openTool.name) {
        return {
          ...route,
          requestedToolNames: [openTool.name],
          toolInput: buildTargetInput(openTool, question, route.toolInput),
          reason: `${route.reason} Generic named-target intent → ${openTool.name}.`,
        };
      }
    }
  }

  return route;
}

function validateSkillRoute(
  question: string,
  raw: SkillRouteResult,
  skills: SpotlightSkill[],
  clientTools: FrontendToolDescriptorV1[],
): SkillRouteResult | null {
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));
  const matchedSkills = raw.matchedSkillNames
    .map((name) => skillByName.get(name))
    .filter((skill): skill is SpotlightSkill => Boolean(skill));
  if (matchedSkills.length === 0) return null;

  const allowedToolNames = new Set(
    matchedSkills.flatMap((skill) => skill.allowedTools ?? []),
  );
  const registeredTools = registeredToolMap(clientTools);
  let requestedToolNames = raw.requestedToolNames.filter(
    (name) => allowedToolNames.has(name) && registeredTools.has(name),
  );
  if (
    raw.route === "action" &&
    requestedToolNames.length === 0 &&
    matchedSkills.length === 1 &&
    isSkillListQuery(question)
  ) {
    const inferred = inferReadOnlyTool(matchedSkills, clientTools);
    if (inferred) requestedToolNames = [inferred];
  }

  return enrichSkillToolRoute(
    question,
    {
      ...raw,
      matchedSkillNames: matchedSkills.map((skill) => skill.name),
      requestedToolNames,
    },
    skills,
    clientTools,
  );
}

export function buildSkillCatalog(
  skills: SpotlightSkill[],
  clientTools: FrontendToolDescriptorV1[],
  question = "",
) {
  const registeredTools = registeredToolMap(clientTools);
  return skills.map((skill) => ({
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    whenToUse: skill.whenToUse,
    responseStrategy: skill.responseStrategy,
    allowedTools: (skill.allowedTools ?? [])
      .filter((name) => registeredTools.has(name))
      .map((name) => {
        const tool = registeredTools.get(name)!;
        return {
          name,
          description: tool.description,
          sideEffect: tool.sideEffect,
          riskLevel: tool.riskLevel,
          requiresConfirmation: tool.requiresConfirmation,
          inputSchema: tool.inputSchema,
        };
      }),
    capabilityExamples: selectRelevantItems(
      skill.capabilityExamples ?? [],
      question,
      (item) => item,
    ),
    toolExamples: selectRelevantItems(
      skill.toolExamples ?? [],
      question,
      (item) => item.example,
    ),
  }));
}

function relevanceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function explicitEnumInput(
  question: string,
  tool: FrontendToolDescriptorV1,
): Record<string, unknown> {
  const query = relevanceText(question);
  const properties =
    tool.inputSchema?.properties &&
    typeof tool.inputSchema.properties === "object"
      ? (tool.inputSchema.properties as Record<string, { enum?: unknown }>)
      : {};
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, schema]) => {
      if (!Array.isArray(schema.enum)) return [];
      const matches = schema.enum.filter((value) =>
        query.includes(relevanceText(String(value))),
      );
      return matches.length === 1 ? [[key, matches[0]]] : [];
    }),
  );
}

export function routeViaExactToolExample(
  question: string,
  clientTools: FrontendToolDescriptorV1[],
  skills: SpotlightSkill[],
): SkillRouteResult | null {
  const query = relevanceText(question);
  if (!query) return null;
  const registered = registeredToolMap(clientTools);
  const matches = skills.flatMap((skill) =>
    (skill.toolExamples ?? []).flatMap((item) => {
      if (relevanceText(item.example) !== query) return [];
      if (!(skill.allowedTools ?? []).includes(item.toolName)) return [];
      const tool = registered.get(item.toolName);
      return tool ? [{ skill, tool }] : [];
    }),
  );
  const toolNames = [...new Set(matches.map(({ tool }) => tool.name))];
  if (toolNames.length !== 1) return null;
  const tool = matches[0]?.tool;
  if (!tool) return null;
  return {
    route: "action",
    matchedSkillNames: [...new Set(matches.map(({ skill }) => skill.name))],
    requestedToolNames: [tool.name],
    toolInput: explicitEnumInput(question, tool),
    confidence: 1,
    reason: `Exact consumer tool example matched ${tool.name}.`,
  };
}

function relevanceScore(question: string, example: string): number {
  const query = relevanceText(question);
  const candidate = relevanceText(example);
  if (!query || !candidate) return 0;
  let score = query.includes(candidate) || candidate.includes(query) ? 1000 : 0;
  const grams = new Set<string>();
  for (let index = 0; index < query.length - 1; index += 1) {
    grams.add(query.slice(index, index + 2));
  }
  for (const gram of grams) {
    if (candidate.includes(gram)) score += 1;
  }
  return score;
}

function selectRelevantItems<T>(
  items: T[],
  question: string,
  textOf: (item: T) => string,
  limit = 6,
): T[] | undefined {
  if (items.length === 0) return undefined;
  return items
    .map((item, index) => ({
      item,
      index,
      score: relevanceScore(question, textOf(item)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

export async function routeViaSkillCatalog(
  model: BaseChatModel,
  question: string,
  clientTools: FrontendToolDescriptorV1[],
  skills: SpotlightSkill[],
  context?: {
    isReferential?: boolean;
    lastAssistantReply?: string | null;
    conversationContext?: string;
  },
): Promise<SkillRouteResult | null> {
  if (skills.length === 0) return null;
  const structured = model.withStructuredOutput(skillRouteSchema, {
    name: "spotlight_skill_route",
  });
  const raw = skillRouteSchema.parse(
    await structured.invoke([
      new SystemMessage(
        [
          "You are Spotlight's skill-first router aligned with LangChain Agent Skills.",
          "Match the latest user message to consumer Skills using semantic understanding of description and whenToUse.",
          "Do not rely on exact phrase matching against capability examples; treat examples as hints only.",
          "Never use product-specific domain assumptions that are not present in the supplied Skill catalog and tool descriptors.",
          "",
          "Lane rules:",
          "- knowledge: skill.knowledge and direct_answer skills. Public introductions, news, and facts that a web search can answer stay on this lane; the runtime will NOT query the project knowledge base for those. Use this lane for in-product / unpublished facts (this module, this system, internal docs) as well.",
          "- action: tool_answer skills that read live page data (lists, counts, status) or perform UI/business operations via registered client tools.",
          "- clarify: an action skill matches but the target or a required parameter cannot be resolved safely.",
          "- A tool being high-risk or requiresConfirmation does NOT make the route clarify when all required arguments are concrete. Route it as action and let the execution/confirmation gate prevent unconfirmed execution.",
          "",
          "Tool selection rules:",
          "- List/count/status intent → choose the matched skill's read-only tool when one clearly fits.",
          "- Open/show/view/play + a specific named target → choose the matched skill's open-like tool and copy the user's target into the required string argument without inventing a name.",
          "- Mutations such as add/remove/update/submit → choose only the exact mutation tool explicitly allowed by the matched skill; preserve quantities and other arguments from the user message.",
          "- If a required argument is missing or referential context is insufficient, return clarify instead of guessing.",
          "- Never substitute a list/read tool as the only call for a named-target open request.",
          "",
          "requestedToolNames must contain only exact names from the matched skill's allowedTools.",
          "matchedSkillNames must come from the provided catalog. Return an empty array when no skill fits.",
          "When conversationContext or lastAssistantReply is provided, use it to resolve referential follow-ups (刚才/那个/继续/that one/continue).",
        ].join("\n"),
      ),
      new HumanMessage(
        JSON.stringify({
          latestUserMessage: question,
          skills: buildSkillCatalog(skills, clientTools, question),
          conversationContext: context?.conversationContext,
          isReferential: context?.isReferential ?? false,
          lastAssistantReply: context?.lastAssistantReply ?? null,
        }),
      ),
    ]),
  );
  return validateSkillRoute(question, raw, skills, clientTools);
}

export function toolsForMatchedSkills(
  skills: SpotlightSkill[],
  clientTools: FrontendToolDescriptorV1[],
  matchedSkillNames: string[],
): FrontendToolDescriptorV1[] {
  const matched = new Set(matchedSkillNames);
  const allowed = new Set(
    skills
      .filter((skill) => matched.has(skill.name))
      .flatMap((skill) => skill.allowedTools ?? []),
  );
  return clientTools.filter((tool) => allowed.has(tool.name));
}

export function candidateToolsForSkillRoute(
  skills: SpotlightSkill[],
  clientTools: FrontendToolDescriptorV1[],
  route: SkillRouteResult,
): FrontendToolDescriptorV1[] {
  const matchedSkills = skills.filter((skill) =>
    route.matchedSkillNames.includes(skill.name),
  );
  if (matchedSkills.length === 0) return [];
  if (matchedSkills.length === 1) {
    return toolsForSkill(matchedSkills[0], clientTools);
  }
  return toolsForMatchedSkills(skills, clientTools, route.matchedSkillNames);
}
