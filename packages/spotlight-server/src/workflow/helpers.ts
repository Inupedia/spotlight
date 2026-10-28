import { isSpotlightToolResultEnvelope } from "@inupedia/spotlight-protocol";
import type { FrontendToolDescriptorV1 } from "@inupedia/spotlight-protocol";
import type { IntentDecision, KnowledgeEvidence } from "../contracts.js";
import type { prepareRunSkills } from "../skills.js";
import { compactText } from "./state.js";
import { isInternalEvidenceTitle } from "./evidence.js";

export function routeProgressSummary(
  question: string,
  decision: IntentDecision,
  selectedTools: FrontendToolDescriptorV1[] = [],
): string {
  const request = `“${compactText(question)}”`;
  if (decision.route === "knowledge") {
    const source =
      decision.knowledgeSource === "knowledge" ? "项目知识库" : "联网搜索";
    return `识别为知识问答（${source}）：${request}；未检测到需要执行的页面操作。`;
  }
  if (decision.route === "action") {
    const readOnlyQuery =
      selectedTools.length > 0 &&
      selectedTools.every((tool) => tool.sideEffect === "none");
    const routeLabel = readOnlyQuery ? "识别为只读查询" : "识别为页面操作";
    const evidence = !readOnlyQuery && decision.explicitActionEvidence
      ? `，检测到明确动作“${decision.explicitActionEvidence}”`
      : "";
    const skill = decision.matchedSkillNames?.length
      ? `；命中 Skill：${decision.matchedSkillNames.join("、")}`
      : "";
    const normalization = decision.toolInputNormalization?.length
      ? `；已按 Tool Schema 清理 ${decision.toolInputNormalization.length} 个无效可选字段（${decision.toolInputNormalization.map((item) => item.path).join("、")}）`
      : "";
    const executionNote = readOnlyQuery
      ? "将调用已注册的只读工具。"
      : "将只从已注册的客户端工具中选择。";
    return `${routeLabel}：${request}${evidence}${skill}${normalization}；${executionNote}`;
  }
  return `暂不能安全执行：${request}；操作目标或指令不够明确，需要进一步确认。`;
}

export function toolInputSummary(input: Record<string, unknown>): string {
  const query = typeof input.query === "string" ? input.query : null;
  if (query) return `“${compactText(query, 56)}”`;
  const serialized = JSON.stringify(input);
  return serialized === "{}" ? "无参数" : compactText(serialized, 72);
}

export function toolOutputSummary(output: unknown): string {
  if (Array.isArray(output)) return `返回 ${output.length} 条结果`;
  if (output && typeof output === "object") {
    for (const key of ["results", "items", "data", "hits"]) {
      const value = (output as Record<string, unknown>)[key];
      if (Array.isArray(value)) return `返回 ${value.length} 条结果`;
    }
  }
  return "已返回结果";
}

export function evidenceProgressSummary(
  source: string,
  query: string,
  evidence: KnowledgeEvidence[],
): string {
  if (evidence.length === 0) {
    return `${source}未找到与“${compactText(query, 48)}”匹配的资料。`;
  }
  const titles = [
    ...new Set(
      evidence
        .map((item) => item.title?.trim())
        .filter(
          (title): title is string =>
            Boolean(title) && !isInternalEvidenceTitle(title),
        ),
    ),
  ].slice(0, 8);
  const head = `${source}检索“${compactText(query, 48)}”命中 ${evidence.length} 条资料`;
  if (titles.length === 0) return `${head}。`;
  const list = titles
    .map((title, index) => `${index + 1}. ${title}`)
    .join("\n");
  return `${head}：\n${list}`;
}

export function toolsForMatchedSkills(
  tools: FrontendToolDescriptorV1[],
  skills: ReturnType<typeof prepareRunSkills>,
  decision: IntentDecision,
): FrontendToolDescriptorV1[] {
  if (!decision.matchedSkillNames?.length) return tools;
  const matched = new Set(decision.matchedSkillNames);
  const allowed = new Set(
    skills
      .filter((skill) => matched.has(skill.name))
      .flatMap((skill) => skill.allowedTools ?? []),
  );
  return tools.filter((tool) => allowed.has(tool.name));
}

export function toolErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function explicitActionReply(output: unknown): string | undefined {
  let value = output;
  let originalText: string | undefined;
  if (typeof value === "string") {
    originalText = value.trim();
    if (!originalText) return undefined;
    try {
      value = JSON.parse(originalText);
    } catch {
      return originalText;
    }
  }

  if (!isSpotlightToolResultEnvelope(value)) return originalText;
  if (!value.success) return value.error.message;
  if (typeof value.data === "string" && value.data.trim()) {
    return value.data.trim();
  }
  const text = value.content
    .filter((item) => item.type === "text")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
  return text || originalText;
}

export function actionReplyFromToolOutput(
  descriptor: FrontendToolDescriptorV1,
  output: unknown,
): string {
  // A client action may decline an operation after checking local state (for
  // example, an unavailable camera). Preserve that explicit user-facing result
  // instead of replacing it with the generic "completed" message.
  const explicitReply = explicitActionReply(output);
  if (explicitReply) return explicitReply;
  if (descriptor.sideEffect === "none") {
    return typeof output === "string" ? output : JSON.stringify(output ?? "");
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) {
      return `已为您打开${record.name.trim()}。`;
    }
  }
  return `已完成：${descriptor.description}`;
}
