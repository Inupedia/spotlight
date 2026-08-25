/**
 * Spotlight consumer layout & skills/service contract.
 * Aligned with Inupedia Agent Skills / agentskills.io layout.
 */

/** Project-level paths (conventions — consumers may override glob roots). */
export const SPOTLIGHT_LAYOUT = {
  /** Skill pack root relative to repo root. */
  skillsRoot: ".inupedia/skills",
  skillEntryFile: "SKILL.md",
  /** Supporting dirs under each skill folder (Agent Skills standard). */
  skillSupportDirs: ["scripts", "references", "templates", "examples"] as const,
  /** Optional project UI copy / chips. */
  uiPromptsFile: ".inupedia/ui-prompts.json",
  /** Recommended service root in host apps. */
  serviceRoot: "src/service/agent",
  /** IoC capabilities (`@agent` / project presets). */
  serviceCapabilitiesDir: "src/service/agent/capabilities",
  serviceToolsDir: "src/service/agent/tools",
  serviceHostFile: "src/service/agent/host.ts",
  serviceExecutorFile: "src/service/agent/host.ts",
  spotlightConfigFile: "spotlight.config.ts",
} as const;

/** Vite / bundler glob for eager skill markdown load. */
export function spotlightSkillsGlobPattern(
  skillsRoot = SPOTLIGHT_LAYOUT.skillsRoot,
): string {
  return `${skillsRoot}/**/${SPOTLIGHT_LAYOUT.skillEntryFile}`;
}

/**
 * Where a capability executes. Pick one surface per capability; document in skill `allowed-tools`.
 *
 * - `host-tool` — browser/host `registerTool` (UI navigation, panels, local data read)
 * - `skill-script` — file under skill `scripts/` (API glue; host or CI runs it, not SaaS by default)
 * - `mcp` — MCP server tool (external systems, shared across projects)
 * - `runtime` — spotlight-server runtime tool (server-side only)
 */
export type CapabilitySurface =
  "host-tool" | "skill-script" | "mcp" | "runtime";

/** Agent Skills–compatible frontmatter (+ Spotlight extensions). */
export interface SpotlightSkillFrontmatter {
  /** Stable id; folder name should match (e.g. skill.navigate.scene). */
  id?: string;
  name?: string;
  description: string;
  when_to_use?: string;
  /** Comma-separated or YAML list — must name registered tools / MCP tools. */
  "allowed-tools"?: string | string[];
  "argument-hint"?: string;
  arguments?: string | string[];
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
  "disallowed-tools"?: string | string[];
  paths?: string | string[];
  context?: "inline" | "fork";
  agent?: string;
  model?: string;
  effort?: string;
  hooks?: Record<string, unknown>;
  shell?: string;
  /** Spotlight: how the agent should respond after invoke. */
  "spotlight-response-strategy"?: "direct_answer" | "tool_answer" | "clarify";
  /** Spotlight: asset retrieval scope. */
  "spotlight-asset-types"?: string | string[];
  "capability-examples"?: string | string[];
  /** Entries use `user example => registeredToolName`. */
  "tool-examples"?: string | string[];
  dependencies?: {
    tools?: Array<string | { type: string; value: string; description?: string }>;
  };
  policy?: { allow_implicit_invocation?: boolean };
  interface?: Record<string, unknown>;
}

/** Recommended service injection contract (consumer implements). */
export interface SpotlightServiceContract {
  /** Registry listing for server manifest + planner. */
  listTools: () => readonly { name: string; description: string }[];
  getToolExecutionTarget: (name: string) => "host" | "runtime" | undefined;
  /** Host-side executor (navigation preflight + invoke). */
  runTool: (name: string, input: unknown) => Promise<unknown>;
  /** Current UI context for planner / preconditions (shape is app-specific). */
  getUiContext?: () => Record<string, unknown>;
  /** Side-effect import of tool modules. */
  loadTools?: () => void | Promise<unknown>;
}

/**
 * Skills teach what/when; service implements how.
 * Skills: .inupedia/skills/.../SKILL.md → listing, skill.invoke, allowed-tools
 * Service: src/service/agent/tools → runTool, host manifest
 * Scripts: skill/scripts → appendix paths; host or MCP executes
 * MCP: external tools referenced in allowed-tools
 */
export const SPOTLIGHT_SKILLS_SERVICE_SPLIT = {
  skills:
    "Knowledge + procedure: description, when_to_use, allowed-tools, markdown body.",
  service:
    "Executable host capabilities: @agent in capabilities/ (compile-time IoC).",
  scripts:
    "Optional API/CLI glue under skill/scripts/ — list in appendix; wire execution in host or MCP.",
  mcp: "External integrations; reference MCP tool names in allowed-tools.",
} as const;

/** Progressive disclosure levels (matches spotlight-server + host adapter). */
export const SPOTLIGHT_SKILL_LOAD_LEVELS = {
  listing: "name + description + when_to_use in skill catalog (always)",
  invoke:
    "SKILL.md body + references/templates/examples appendix (after skill.invoke)",
  scripts:
    "scripts/ paths listed in appendix only — execution is consumer-defined",
} as const;

/** Frontmatter keys recognized by @inupedia/spotlight-vue parser. */
export const SPOTLIGHT_SKILL_FRONTMATTER_KEYS = [
  "id",
  "name",
  "description",
  "when_to_use",
  "allowed-tools",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "disallowed-tools",
  "paths",
  "context",
  "agent",
  "model",
  "effort",
  "hooks",
  "shell",
  "spotlight-response-strategy",
  "spotlight-asset-types",
  "capability-examples",
  "dependencies",
  "policy",
  "interface",
] as const;
