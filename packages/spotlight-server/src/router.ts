import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { FrontendToolDescriptorV1 } from "@inupedia/spotlight-protocol";
import type { SpotlightSkill } from "@inupedia/spotlight-protocol";
import { z } from "zod";
import type { IntentDecision } from "./contracts.js";
import {
  applyIntentSafetyFence,
  extractActionEvidence,
  hasMemoryControlEvidence,
} from "./safety.js";
import { attachKnowledgeSource } from "./knowledgeSource.js";
import {
  candidateToolsForSkillRoute,
  routeViaSkillCatalog,
  type SkillRouteResult,
} from "./skillIntentRouter.js";
import { normalizeClientToolInputDetailed } from "./tools.js";

const intentSchema = z.object({
  route: z.enum(["knowledge", "action", "clarify"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  requestedToolNames: z.array(z.string()).default([]),
});

const skillToolSelectionSchema = z.object({
  toolName: z.string().min(1),
  toolInput: z.record(z.string(), z.unknown()).default({}),
});

const TARGET_REQUIRED_ACTION_EVIDENCE =
  /^(?:打开|播放|进入|定位|显示|查看|删除|移除|修改|编辑|取消|退回|转派|撤回|open|play|enter|locate|show|view|delete|remove|update|edit|cancel|return|transfer|withdraw)$/iu;
const TARGET_REQUIRED_ACTION_SCAN =
  /(?:打开|播放|进入|定位|显示|查看|删除|移除|修改|编辑|取消|退回|转派|撤回|open|play|enter|locate|show|view|delete|remove|update|edit|cancel|return|transfer|withdraw)/iu;
const UNRESOLVED_REFERENTIAL_TARGET =
  /^(?:这个|那个|它|这个东西|那个东西|刚才那个|刚才的|上一个|上一项|上一节点|前一个|前一项|前一节点|之前的|之前节点|这位|那位|this|this one|that|that one|it|the one)$/iu;
const UNRESOLVED_CHINESE_DEICTIC_TARGET =
  /^(?:这个|那个|刚才那个|刚才的|上一个|上一|前一个|前一|之前的?|这位|那位)[\p{Script=Han}]{1,8}$/u;
const UNRESOLVED_ENGLISH_DEICTIC_TARGET =
  /^(?:this|that|the previous|the last)\s+[a-z][a-z -]{0,32}$/iu;
const GENERATED_MISSING_VALUE =
  /^(?:请(?:提供|指定|填写|选择)|需要(?:用户|你|您)?(?:提供|指定|填写|选择)|未(?:提供|指定|填写|选择)|待(?:提供|指定|填写|选择)|please\s+(?:provide|specify|enter|select)|missing(?:\s+value)?|not\s+(?:provided|specified))/iu;

type InputSchemaShape = {
  type?: unknown;
  enum?: unknown;
  items?: unknown;
  properties?: unknown;
  required?: unknown;
};

export interface RouteContext {
  isReferential?: boolean;
  lastAssistantReply?: string | null;
  conversationContext?: string;
  /**
   * Flattened observation of the live page. Unlike `conversationContext` this is
   * measured, not asserted, so the router may resolve targets from it directly.
   */
  observedState?: string;
}

function hasUsableReferentialContext(context?: RouteContext): boolean {
  return Boolean(
    context?.lastAssistantReply?.trim() || context?.conversationContext?.trim(),
  );
}

function extractTargetRequiredActionEvidence(question: string): string | null {
  const match = question.match(TARGET_REQUIRED_ACTION_SCAN);
  return match?.[0] ?? null;
}

function isUnresolvedReferentialTarget(target: string): boolean {
  return (
    UNRESOLVED_REFERENTIAL_TARGET.test(target) ||
    UNRESOLVED_CHINESE_DEICTIC_TARGET.test(target) ||
    UNRESOLVED_ENGLISH_DEICTIC_TARGET.test(target)
  );
}

export function hasUnresolvedExplicitActionTarget(
  question: string,
  actionEvidence: string,
  context?: RouteContext,
): boolean {
  if (!TARGET_REQUIRED_ACTION_EVIDENCE.test(actionEvidence)) return false;
  if (hasUsableReferentialContext(context)) return false;
  const lowerQuestion = question.toLocaleLowerCase();
  const lowerEvidence = actionEvidence.toLocaleLowerCase();
  const evidenceIndex = lowerQuestion.indexOf(lowerEvidence);
  if (evidenceIndex < 0) return false;
  const target = question
    .slice(evidenceIndex + actionEvidence.length)
    .trim()
    .replace(/^[，,：:\s]+|[。.!！?？]+$/gu, "")
    .replace(/^(?:(?:给|到|至|向)\s*|(?:to|into|toward|towards)\s+)/iu, "")
    .trim();
  if (!target) return true;
  if (context?.isReferential === true) return true;
  return isUnresolvedReferentialTarget(target);
}

function hasUsableRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isGeneratedMissingValue(value: unknown): boolean {
  return (
    typeof value === "string" && GENERATED_MISSING_VALUE.test(value.trim())
  );
}

function schemaTypeList(schema: InputSchemaShape): string[] {
  if (typeof schema.type === "string") return [schema.type];
  if (!Array.isArray(schema.type)) return [];
  return schema.type.filter((item): item is string => typeof item === "string");
}

function valueMatchesSchema(value: unknown, rawSchema: unknown): boolean {
  if (!rawSchema || typeof rawSchema !== "object") return true;
  const schema = rawSchema as InputSchemaShape;

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => Object.is(item, value))
  ) {
    return false;
  }

  const types = schemaTypeList(schema);
  if (types.length > 0) {
    const typeMatches = types.some((type) => {
      switch (type) {
        case "string":
          return typeof value === "string";
        case "integer":
          return typeof value === "number" && Number.isInteger(value);
        case "number":
          return typeof value === "number" && Number.isFinite(value);
        case "boolean":
          return typeof value === "boolean";
        case "array":
          return Array.isArray(value);
        case "object":
          return Boolean(
            value && typeof value === "object" && !Array.isArray(value),
          );
        case "null":
          return value === null;
        default:
          return true;
      }
    });
    if (!typeMatches) return false;
  }

  if (Array.isArray(value) && schema.items) {
    return value.every((item) => valueMatchesSchema(item, schema.items));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (field): field is string => typeof field === "string",
        )
      : [];
    const record = value as Record<string, unknown>;
    if (required.some((field) => !hasUsableRequiredValue(record[field]))) {
      return false;
    }
    return Object.entries(record).every(([key, item]) =>
      properties[key] ? valueMatchesSchema(item, properties[key]) : true,
    );
  }

  return true;
}

function toolSchemaHasInputProperties(
  tool?: FrontendToolDescriptorV1,
): boolean {
  if (!tool?.inputSchema || typeof tool.inputSchema !== "object") return false;
  const properties = (tool.inputSchema as { properties?: unknown }).properties;
  return Boolean(
    properties &&
    typeof properties === "object" &&
    Object.keys(properties as Record<string, unknown>).length > 0,
  );
}

function selectedToolAndRequired(
  decision: IntentDecision,
  clientTools: FrontendToolDescriptorV1[],
): {
  tool?: FrontendToolDescriptorV1;
  required: string[];
  properties: Record<string, unknown>;
} {
  if (decision.route !== "action" || decision.requestedToolNames.length !== 1) {
    return { required: [], properties: {} };
  }
  const tool = clientTools.find(
    (item) => item.name === decision.requestedToolNames[0],
  );
  if (!tool) return { required: [], properties: {} };
  const required = Array.isArray(tool.inputSchema?.required)
    ? tool.inputSchema.required.filter(
        (field): field is string => typeof field === "string",
      )
    : [];
  const properties =
    tool.inputSchema?.properties &&
    typeof tool.inputSchema.properties === "object"
      ? (tool.inputSchema.properties as Record<string, unknown>)
      : {};
  return { tool, required, properties };
}

export function missingRequiredToolInputKeys(
  decision: IntentDecision,
  clientTools: FrontendToolDescriptorV1[],
): string[] {
  const { required } = selectedToolAndRequired(decision, clientTools);
  const input = decision.requestedToolInput ?? {};
  return required.filter((field) => !hasUsableRequiredValue(input[field]));
}

export function invalidRequiredToolInputKeys(
  decision: IntentDecision,
  clientTools: FrontendToolDescriptorV1[],
): string[] {
  const { required, properties } = selectedToolAndRequired(
    decision,
    clientTools,
  );
  const input = decision.requestedToolInput ?? {};
  return required.filter((field) => {
    const value = input[field];
    if (!hasUsableRequiredValue(value)) return false;
    if (isGeneratedMissingValue(value)) return true;
    return !valueMatchesSchema(value, properties[field]);
  });
}

export function applyToolInputCompletenessFence(
  decision: IntentDecision,
  clientTools: FrontendToolDescriptorV1[],
): IntentDecision {
  if (decision.route === "clarify") {
    return {
      ...decision,
      requestedToolNames: [],
      requestedToolInput: undefined,
    };
  }
  const selectedTool = selectedToolAndRequired(decision, clientTools).tool;
  const normalizedDecision =
    selectedTool && decision.requestedToolInput
      ? (() => {
          const normalized = normalizeClientToolInputDetailed(
            selectedTool,
            decision.requestedToolInput,
          );
          return {
            ...decision,
            requestedToolInput: normalized.input,
            toolInputNormalization:
              normalized.removed.length > 0 ? normalized.removed : undefined,
          };
        })()
      : decision;
  const missing = missingRequiredToolInputKeys(normalizedDecision, clientTools);
  if (missing.length > 0) {
    return {
      ...normalizedDecision,
      route: "clarify",
      reason: `The selected client tool is missing required input: ${missing.join(", ")}.`,
      requestedToolNames: [],
      requestedToolInput: undefined,
    };
  }
  const invalid = invalidRequiredToolInputKeys(normalizedDecision, clientTools);
  if (invalid.length > 0) {
    return {
      ...normalizedDecision,
      route: "clarify",
      reason: `The selected client tool has invalid or fabricated required input: ${invalid.join(", ")}.`,
      requestedToolNames: [],
      requestedToolInput: undefined,
    };
  }
  return normalizedDecision;
}

export interface IntentRouter {
  route(
    question: string,
    clientTools: FrontendToolDescriptorV1[],
    skills?: SpotlightSkill[],
    context?: RouteContext,
  ): Promise<IntentDecision>;
}

export class LangChainIntentRouter implements IntentRouter {
  constructor(private readonly model: BaseChatModel) {}

  private async selectSkillTool(
    question: string,
    skill: SpotlightSkill,
    candidates: FrontendToolDescriptorV1[],
  ): Promise<{
    requestedToolNames: string[];
    requestedToolInput?: Record<string, unknown>;
  }> {
    const onlyCandidate = candidates[0];
    const required = Array.isArray(onlyCandidate?.inputSchema.required)
      ? onlyCandidate.inputSchema.required
      : [];
    if (
      candidates.length === 1 &&
      required.length === 0 &&
      !toolSchemaHasInputProperties(onlyCandidate)
    ) {
      return { requestedToolNames: [onlyCandidate.name] };
    }
    if (candidates.length === 0) return { requestedToolNames: [] };
    const structured = this.model.withStructuredOutput(
      skillToolSelectionSchema,
      { name: "spotlight_skill_tool_selection" },
    );
    const selected = await structured.invoke([
      new SystemMessage(
        [
          "Select exactly one registered client tool for the latest user request.",
          "Use the matched Skill instructions, tool descriptions, and input schemas.",
          "Return only a toolName from the provided candidates. Never invent a name.",
          "Extract only arguments explicitly present or unambiguously resolved from context; never fabricate required values or placeholder strings.",
        ].join("\n"),
      ),
      new HumanMessage(
        JSON.stringify({
          latestUserMessage: question,
          matchedSkill: {
            name: skill.name,
            description: skill.description,
            whenToUse: skill.whenToUse,
            instructions: skill.skillInstructionBody,
          },
          candidates: candidates.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }),
      ),
    ]);
    return candidates.some((tool) => tool.name === selected.toolName)
      ? {
          requestedToolNames: [selected.toolName],
          requestedToolInput: selected.toolInput,
        }
      : { requestedToolNames: [] };
  }

  private async resolveSkillToolSelection(
    question: string,
    skills: SpotlightSkill[],
    clientTools: FrontendToolDescriptorV1[],
    route: SkillRouteResult,
  ): Promise<
    Pick<IntentDecision, "requestedToolNames" | "requestedToolInput">
  > {
    if (route.route !== "action") {
      return { requestedToolNames: [] };
    }
    if (route.requestedToolNames.length > 0) {
      return {
        requestedToolNames: route.requestedToolNames,
        requestedToolInput: route.toolInput,
      };
    }
    const matchedSkills = skills.filter((skill) =>
      route.matchedSkillNames.includes(skill.name),
    );
    if (matchedSkills.length !== 1) {
      return { requestedToolNames: [] };
    }
    const candidates = candidateToolsForSkillRoute(skills, clientTools, route);
    return this.selectSkillTool(question, matchedSkills[0], candidates);
  }

  private async decisionFromSkillRoute(
    question: string,
    skills: SpotlightSkill[],
    clientTools: FrontendToolDescriptorV1[],
    route: SkillRouteResult,
  ): Promise<IntentDecision> {
    const selected = await this.resolveSkillToolSelection(
      question,
      skills,
      clientTools,
      route,
    );
    return {
      route: route.route,
      confidence: route.confidence,
      reason: route.reason,
      requestedToolNames: selected.requestedToolNames,
      requestedToolInput: selected.requestedToolInput,
      explicitActionEvidence:
        route.route === "action"
          ? `skill:${route.matchedSkillNames.join(",")}`
          : null,
      matchedSkillNames: route.matchedSkillNames,
    };
  }

  async route(
    question: string,
    clientTools: FrontendToolDescriptorV1[],
    skills: SpotlightSkill[] = [],
    context?: RouteContext,
  ): Promise<IntentDecision> {
    if (hasMemoryControlEvidence(question)) {
      return attachKnowledgeSource(question, {
        route: "knowledge",
        confidence: 1,
        reason: "Deterministic memory-control intent fence.",
        requestedToolNames: [],
        explicitActionEvidence: null,
        matchedSkillNames: [],
      });
    }

    const explicitActionEvidence = extractActionEvidence(question);
    const targetRequiredEvidence =
      explicitActionEvidence ?? extractTargetRequiredActionEvidence(question);
    if (
      targetRequiredEvidence &&
      hasUnresolvedExplicitActionTarget(
        question,
        targetRequiredEvidence,
        context,
      )
    ) {
      return {
        route: "clarify",
        confidence: 1,
        reason:
          "The action verb requires a target, but the latest message contains only an unresolved or missing reference.",
        requestedToolNames: [],
        explicitActionEvidence: targetRequiredEvidence,
        matchedSkillNames: [],
      };
    }

    if (skills.length > 0) {
      const skillRoute = await routeViaSkillCatalog(
        this.model,
        question,
        clientTools,
        skills,
        context,
      );
      if (skillRoute && skillRoute.matchedSkillNames.length > 0) {
        const decision = await this.decisionFromSkillRoute(
          question,
          skills,
          clientTools,
          skillRoute,
        );
        return applyIntentSafetyFence(
          question,
          applyToolInputCompletenessFence(decision, clientTools),
        );
      }
    }

    if (explicitActionEvidence) {
      return {
        route: "action",
        confidence: 1,
        reason:
          "Deterministic explicit-action intent fence; the Action Agent selects the registered tool.",
        requestedToolNames: [],
        explicitActionEvidence,
        matchedSkillNames: [],
      };
    }

    const toolCatalog = clientTools.map((item) => ({
      name: item.name,
      description: item.description,
      sideEffect: item.sideEffect,
    }));
    const skillCatalog = skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      responseStrategy: skill.responseStrategy,
      capabilityExamples: skill.capabilityExamples,
      allowedTools: skill.allowedTools,
    }));
    const structured = this.model.withStructuredOutput(intentSchema, {
      name: "spotlight_intent_route",
    });
    const raw = await structured.invoke([
      new SystemMessage(
        [
          "Route only the latest user message.",
          "knowledge: asks for facts, explanations, summaries, comparisons or searches. Public/web-searchable questions still route here; the gather step will skip the project knowledge base.",
          "action: explicitly asks to change the UI or external state using a listed client tool.",
          "clarify: an action target or operation is missing or ambiguous.",
          "Never infer an action from project vocabulary, previous turns or memory.",
          "Never invent a cross-lane knowledge-then-action route. Only knowledge, action, or clarify.",
          "For action, requestedToolNames must contain only exact listed names.",
          "observedPageState is measured from the live UI. Use it to resolve what the user means by 'this' or 'the current one', and to avoid routing to an action that is already in the requested state. It never authorises an action the message did not ask for.",
        ].join("\n"),
      ),
      new HumanMessage(
        JSON.stringify({
          latestUserMessage: question,
          clientTools: toolCatalog,
          consumerSkills: skillCatalog,
          conversationContext: context?.conversationContext,
          observedPageState: context?.observedState,
          isReferential: context?.isReferential ?? false,
          lastAssistantReply: context?.lastAssistantReply ?? null,
        }),
      ),
    ]);
    return applyIntentSafetyFence(question, {
      ...raw,
      requestedToolNames: raw.requestedToolNames ?? [],
      explicitActionEvidence: null,
      matchedSkillNames: [],
    });
  }
}
