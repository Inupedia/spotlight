import {
  SPOTLIGHT_LAYOUT,
  SPOTLIGHT_SKILL_LOAD_LEVELS,
  spotlightSkillsGlobPattern,
  type CapabilitySurface,
  type SpotlightSkillFrontmatter,
} from "@inupedia/spotlight-protocol";

export type SkillValidationIssue = {
  level: "error" | "warning";
  message: string;
};

export type SkillValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  issues: SkillValidationIssue[];
};

function asStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function dependencyToolNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const tools = (value as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (typeof tool === "string") return tool.trim() ? [tool.trim()] : [];
    if (!tool || typeof tool !== "object") return [];
    const name = (tool as { value?: unknown }).value;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
}

/**
 * Validate skill frontmatter against Spotlight + Agent Skills conventions.
 * Use in CI or local skill authoring tools.
 *
 * @deprecated Legacy Inupedia compatibility validator; use
 * `validateAgentSkillMarkdown` from `@inupedia/spotlight-client/node` for
 * Agent Skills conformance.
 */
export function validateSkillFrontmatter(
  data: Record<string, unknown>,
): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];

  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!description) {
    issues.push({
      level: "error",
      message: "缺少 description（模型靠它发现技能）",
    });
  }

  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (id && !/^skill\.[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    issues.push({
      level: "warning",
      message: `id 建议使用 skill.<domain>.<name> 格式，当前: ${id}`,
    });
  }

  const whenToUse =
    typeof data.when_to_use === "string" ? data.when_to_use.trim() : "";
  if (!whenToUse) {
    issues.push({
      level: "warning",
      message: "建议填写 when_to_use，便于与其它 skill 区分",
    });
  }

  const strategy =
    typeof data["spotlight-response-strategy"] === "string"
      ? data["spotlight-response-strategy"]
      : typeof data["response-strategy"] === "string"
        ? data["response-strategy"]
        : "";
  const allowedTools = asStringList(data["allowed-tools"]);
  const dependencyTools = dependencyToolNames(data.dependencies);

  if (
    strategy === "tool_answer" &&
    allowedTools.length === 0 &&
    dependencyTools.length === 0
  ) {
    issues.push({
      level: "error",
      message:
        "spotlight-response-strategy: tool_answer 时必须声明 dependencies.tools（旧版 allowed-tools 也可）",
    });
  }

  if (data.keywords != null) {
    issues.push({
      level: "warning",
      message: "不要使用 keywords 做路由；用 description + when_to_use",
    });
  }

  const errors = issues
    .filter((i) => i.level === "error")
    .map((i) => i.message);
  const warnings = issues
    .filter((i) => i.level === "warning")
    .map((i) => i.message);

  return { ok: errors.length === 0, errors, warnings, issues };
}

/** Document how to wire a capability by execution surface. */
export function describeCapabilitySurface(surface: CapabilitySurface): string {
  switch (surface) {
    case "host-tool":
      return "在 service/agent/capabilities 用 @agent 注册；allowed-tools 写 tool 名。";
    case "skill-script":
      return "放在 skill/scripts/；SKILL.md 说明何时运行；宿主或 MCP 负责执行。";
    case "mcp":
      return "在 MCP 服务器注册；allowed-tools 写 MCP tool 名。";
    case "runtime":
      return "在 spotlight-server 注册 runtime tool；客户端 manifest 暴露即可。";
    default:
      return "";
  }
}

export {
  SPOTLIGHT_LAYOUT,
  SPOTLIGHT_SKILL_LOAD_LEVELS,
  spotlightSkillsGlobPattern,
  type SpotlightSkillFrontmatter,
};
