import {
  spotlightSkillToolNames,
  type FrontendToolDescriptorV1,
  type SpotlightSkill,
} from "@inupedia/spotlight-protocol";

const MAX_SKILLS_PER_RUN = 32;
const MAX_SKILL_BODY_CHARS = 12_000;
const MAX_SKILL_TOTAL_CHARS = 48_000;

function compact(value: string | undefined, max: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1)}…`;
}

/** Validate consumer-owned Skills and bind their tool permissions to the signed manifest. */
export function prepareRunSkills(
  skills: SpotlightSkill[] | undefined,
  clientTools: FrontendToolDescriptorV1[],
): SpotlightSkill[] {
  const registeredTools = new Set(clientTools.map((tool) => tool.name));
  const result: SpotlightSkill[] = [];
  const seen = new Set<string>();
  let remainingChars = MAX_SKILL_TOTAL_CHARS;

  for (const raw of skills ?? []) {
    if (result.length >= MAX_SKILLS_PER_RUN || remainingChars <= 0) break;
    const name = compact(raw.name, 120);
    const description = compact(raw.description, 600);
    if (
      !name ||
      !description ||
      seen.has(name) ||
      raw.disableModelInvocation === true
    )
      continue;
    seen.add(name);
    const bodyLimit = Math.min(MAX_SKILL_BODY_CHARS, remainingChars);
    const instruction = compact(raw.skillInstructionBody, bodyLimit);
    const appendixLimit = Math.min(
      4_000,
      Math.max(0, remainingChars - (instruction?.length ?? 0)),
    );
    const appendix = compact(raw.skillPackAppendix, appendixLimit);
    remainingChars -= (instruction?.length ?? 0) + (appendix?.length ?? 0);
    result.push({
      name,
      displayName: compact(raw.displayName, 120),
      description,
      whenToUse: compact(raw.whenToUse, 800),
      allowedTools: spotlightSkillToolNames(raw).filter((tool) =>
        registeredTools.has(tool),
      ),
      dependencies: raw.dependencies,
      policy: raw.policy,
      interface: raw.interface,
      capabilityExamples: raw.capabilityExamples
        ?.map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8),
      toolExamples: raw.toolExamples
        ?.map((item) => ({
          example: item.example.trim(),
          toolName: item.toolName.trim(),
        }))
        .filter(
          (item) =>
            item.example && item.toolName && registeredTools.has(item.toolName),
        )
        .slice(0, 32),
      responseStrategy: raw.responseStrategy,
      skillInstructionBody: instruction,
      skillPackAppendix: appendix,
    });
  }
  return result;
}

export function actionToolsAllowedBySkills(
  tools: FrontendToolDescriptorV1[],
  skills: SpotlightSkill[],
): FrontendToolDescriptorV1[] {
  if (skills.length === 0) return tools;
  const allowed = new Set(skills.flatMap((skill) => skill.allowedTools ?? []));
  return tools.filter((tool) => allowed.has(tool.name));
}

function normalizeQuestion(value: string): string {
  return value.replace(/[\s，。！？、,.!?]/gu, "").toLowerCase();
}

export function isCapabilityHelpQuestion(
  question: string,
  uiPrompts: Record<string, unknown> | undefined,
): boolean {
  const configured = Array.isArray(uiPrompts?.capabilityHelpPatterns)
    ? uiPrompts.capabilityHelpPatterns.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const patterns =
    configured.length > 0
      ? configured
      : ["你能做什么", "你会什么", "有哪些功能", "what can you do"];
  const normalized = normalizeQuestion(question);
  return patterns.some((pattern) => normalized === normalizeQuestion(pattern));
}

export function buildCapabilityHelp(
  skills: SpotlightSkill[],
  tools: FrontendToolDescriptorV1[],
  uiPrompts: Record<string, unknown> | undefined,
): string {
  const availableToolNames = new Set(tools.map((tool) => tool.name));
  const skillLines = skills.map((skill) => {
    const examples = skill.capabilityExamples?.slice(0, 3) ?? [];
    const usableTools = (skill.allowedTools ?? []).filter((name) =>
      availableToolNames.has(name),
    );
    const detail =
      examples.length > 0
        ? `例如：${examples.map((item) => `“${item}”`).join("、")}`
        : skill.description;
    return `- ${skill.displayName ?? skill.name}：${detail}${usableTools.length > 0 ? `（${usableTools.length} 个页面操作）` : ""}`;
  });
  const footer =
    typeof uiPrompts?.capabilityHelpFooter === "string"
      ? uiPrompts.capabilityHelpFooter.trim()
      : "直接用自然语言告诉我你想查询什么，或要页面执行什么操作。";
  if (skillLines.length > 0) {
    return ["我当前可以协助这些事项：", "", ...skillLines, "", footer].join(
      "\n",
    );
  }
  const toolLines = tools
    .slice(0, 20)
    .map((tool) => `- ${tool.description || tool.name}`);
  return ["当前项目注册了以下页面操作：", "", ...toolLines, "", footer].join(
    "\n",
  );
}
