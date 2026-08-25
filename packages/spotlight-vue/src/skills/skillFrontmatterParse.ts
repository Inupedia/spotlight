import { parse as parseYaml } from "yaml";
import type {
  AssetType,
  SpotlightSkill,
  SpotlightSkillResponseStrategy,
} from "@inupedia/spotlight-protocol";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function splitYamlFrontmatterBlocks(markdown: string): {
  frontmatter: string;
  body: string;
} {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: "", body: normalized };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: "", body: normalized };
  }
  return {
    frontmatter: normalized.slice(4, end).trim(),
    body: normalized.slice(end + 5).trim(),
  };
}

function parseSkillFrontmatterData(rawBlock: string): Record<string, unknown> {
  const trimmed = rawBlock.trim();
  if (!trimmed) return {};
  try {
    const parsed = parseYaml(trimmed);
    if (isPlainObject(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  const out: Record<string, unknown> = {};
  for (const line of rawBlock.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function splitSkillMarkdown(markdown: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const { frontmatter, body } = splitYamlFrontmatterBlocks(markdown);
  return { data: parseSkillFrontmatterData(frontmatter), body };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function pickStr(
  data: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string") {
      const s = stripQuotes(v.trim());
      if (s) return s;
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function coerceStringList(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const out = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (!normalized) return undefined;
    const items = normalized
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  return undefined;
}

function pickStrList(
  data: Record<string, unknown>,
  ...keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const got = coerceStringList(data[key]);
    if (got?.length) return got;
  }
  return undefined;
}

function pickToolExamples(
  data: Record<string, unknown>,
): SpotlightSkill["toolExamples"] {
  const raw = pickStrList(data, "tool-examples", "toolExamples");
  if (!raw) return undefined;
  const examples = raw.flatMap((item) => {
    const separator = item.lastIndexOf("=>");
    if (separator <= 0) return [];
    const example = item.slice(0, separator).trim();
    const toolName = item.slice(separator + 2).trim();
    return example && toolName ? [{ example, toolName }] : [];
  });
  return examples.length ? examples : undefined;
}

function pickBool(
  data: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const l = v.trim().toLowerCase();
      if (l === "true" || l === "yes") return true;
      if (l === "false" || l === "no") return false;
    }
  }
  return undefined;
}

const VALID_RESPONSE_STRATEGIES = new Set<SpotlightSkillResponseStrategy>([
  "direct_answer",
  "tool_answer",
  "clarify",
]);

function pickResponseStrategy(
  data: Record<string, unknown>,
): SpotlightSkillResponseStrategy | undefined {
  const raw = pickStr(
    data,
    "spotlight-response-strategy",
    "response-strategy",
    "responseStrategy",
  );
  if (!raw) return undefined;
  return VALID_RESPONSE_STRATEGIES.has(raw as SpotlightSkillResponseStrategy)
    ? (raw as SpotlightSkillResponseStrategy)
    : undefined;
}

const VALID_ASSET_TYPES = new Set<AssetType>([
  "video_channel",
  "bim_model",
  "device",
  "sensor",
  "panel",
  "scene_target",
]);

function pickAssetTypes(
  data: Record<string, unknown>,
): AssetType[] | undefined {
  const raw = pickStrList(
    data,
    "spotlight-asset-types",
    "asset-types",
    "assetTypes",
  );
  if (!raw) return undefined;
  const valid = raw.filter((item): item is AssetType =>
    VALID_ASSET_TYPES.has(item as AssetType),
  );
  return valid.length ? Array.from(new Set(valid)) : undefined;
}

function pickExecutionContext(
  data: Record<string, unknown>,
): "inline" | "fork" | undefined {
  const ctx = pickStr(data, "context", "execution-context", "executionContext");
  if (!ctx) return undefined;
  const l = ctx.toLowerCase();
  if (l === "fork") return "fork";
  if (l === "inline") return "inline";
  return undefined;
}

function pickHooks(
  data: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const v = data.hooks;
  if (isPlainObject(v)) return v;
  return undefined;
}

function pickDependencies(
  data: Record<string, unknown>,
): SpotlightSkill["dependencies"] {
  const raw = data.dependencies;
  if (!isPlainObject(raw) || !Array.isArray(raw.tools)) return undefined;
  const tools: NonNullable<SpotlightSkill["dependencies"]>["tools"] = [];
  for (const tool of raw.tools) {
    if (typeof tool === "string" && tool.trim()) {
      tools.push(tool.trim());
      continue;
    }
    if (!isPlainObject(tool)) continue;
    const value = pickStr(tool, "value", "name");
    if (!value) continue;
    tools.push({
      type: pickStr(tool, "type") ?? "browser",
      value,
      description: pickStr(tool, "description"),
      transport: pickStr(tool, "transport"),
      url: pickStr(tool, "url"),
    });
  }
  return tools.length ? { tools } : undefined;
}

function pickPolicy(data: Record<string, unknown>): SpotlightSkill["policy"] {
  const raw = data.policy;
  if (!isPlainObject(raw)) return undefined;
  const allowImplicitInvocation = pickBool(
    raw,
    "allow_implicit_invocation",
    "allowImplicitInvocation",
  );
  return allowImplicitInvocation === undefined
    ? undefined
    : { allowImplicitInvocation };
}

function pickInterface(
  data: Record<string, unknown>,
): SpotlightSkill["interface"] {
  const raw = data.interface;
  if (!isPlainObject(raw)) return undefined;
  const result = {
    displayName: pickStr(raw, "display_name", "displayName"),
    shortDescription: pickStr(raw, "short_description", "shortDescription"),
    iconSmall: pickStr(raw, "icon_small", "iconSmall"),
    iconLarge: pickStr(raw, "icon_large", "iconLarge"),
    brandColor: pickStr(raw, "brand_color", "brandColor"),
    defaultPrompt: pickStr(raw, "default_prompt", "defaultPrompt"),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function inferSkillIdFromSkillPath(sourcePath: string): string | undefined {
  const parts = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^SKILL\.md$/iu.test(last) && parts.length >= 2) {
    return parts[parts.length - 2];
  }
  if (last?.toLowerCase().endsWith(".skill.md")) {
    return last.replace(/\.SKILL\.md$/iu, "");
  }
  return undefined;
}

function extractFallbackDescription(body: string): string {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#"));
  return line ?? "未提供技能描述";
}

export function parseSpotlightSkillMarkdownFields(
  markdown: string,
  sourcePath: string,
): SpotlightSkill {
  const { data, body } = splitSkillMarkdown(markdown);
  const displayName = pickStr(data, "name");
  const skillId = pickStr(data, "id") ?? inferSkillIdFromSkillPath(sourcePath);
  if (!skillId) {
    throw new Error(`技能文件缺少 id 且无法从路径推断：${sourcePath}`);
  }

  const description =
    pickStr(data, "description") ?? extractFallbackDescription(body);

  const skill: SpotlightSkill = {
    name: skillId,
    description,
  };
  const instructionBody = body.trim();
  if (instructionBody) skill.skillInstructionBody = instructionBody;
  if (displayName) skill.displayName = displayName;
  const whenToUse = pickStr(data, "when_to_use", "whenToUse");
  if (whenToUse) skill.whenToUse = whenToUse;
  const allowed = pickStrList(data, "allowed-tools", "allowedTools");
  if (allowed) skill.allowedTools = allowed;
  const dependencies = pickDependencies(data);
  if (dependencies) skill.dependencies = dependencies;
  const policy = pickPolicy(data);
  if (policy) skill.policy = policy;
  const skillInterface = pickInterface(data);
  if (skillInterface) skill.interface = skillInterface;
  const argumentHint = pickStr(data, "argument-hint", "argumentHint");
  if (argumentHint) skill.argumentHint = argumentHint;
  const argNames = pickStrList(
    data,
    "arguments",
    "argument-names",
    "argumentNames",
  );
  if (argNames) skill.argNames = argNames;
  const keywords = pickStrList(data, "keywords");
  if (keywords) skill.keywords = keywords;
  const rs = pickResponseStrategy(data);
  if (rs) skill.responseStrategy = rs;
  const assetTypes = pickAssetTypes(data);
  if (assetTypes) skill.assetTypes = assetTypes;
  const capEx = pickStrList(data, "capability-examples", "capabilityExamples");
  if (capEx) skill.capabilityExamples = capEx;
  const toolExamples = pickToolExamples(data);
  if (toolExamples) skill.toolExamples = toolExamples;

  const version = pickStr(data, "version");
  if (version) skill.version = version;
  const model = pickStr(data, "model");
  if (model) skill.model = model;
  const dmi = pickBool(
    data,
    "disable-model-invocation",
    "disableModelInvocation",
  );
  if (dmi !== undefined) skill.disableModelInvocation = dmi;
  const ui = pickBool(data, "user-invocable", "userInvocable");
  if (ui !== undefined) skill.userInvocable = ui;
  const paths = pickStrList(data, "paths");
  if (paths) skill.paths = paths;
  const execCtx = pickExecutionContext(data);
  if (execCtx) skill.executionContext = execCtx;
  const agent = pickStr(data, "agent");
  if (agent) skill.agent = agent;
  const effort =
    pickStr(data, "effort") ??
    (typeof data.effort === "number" && Number.isFinite(data.effort)
      ? String(data.effort)
      : undefined);
  if (effort) skill.effort = effort;
  const hooks = pickHooks(data);
  if (hooks) skill.hooks = hooks;
  const shell = pickStr(data, "shell");
  if (shell) skill.shell = shell;

  return skill;
}
