import type {
  IntentDecision,
  KnowledgeSource,
  WorkflowLane,
} from "./contracts.js";

/** Use the project corpus by default; choose web only for explicit external or current information. */
const EXTERNAL_WEB_SEARCH_PATTERN =
  /联网搜索|网络搜索|网上搜索|网上查找|网页搜索|web\s*search|外部资料|外部来源|时效性|新闻|天气|汇率|股价|股票|最新(?:政策|法规|标准|公告|新闻|天气|汇率|股价|价格)|现行(?:政策|法规|标准)|实时(?:数据|天气|汇率|股价)/iu;

export function prefersProjectKnowledgeBase(question: string): boolean {
  return !EXTERNAL_WEB_SEARCH_PATTERN.test(question.trim());
}

export function inferKnowledgeSource(question: string): KnowledgeSource {
  return prefersProjectKnowledgeBase(question) ? "knowledge" : "web";
}

export function attachKnowledgeSource(
  question: string,
  decision: IntentDecision,
): IntentDecision {
  if (decision.route !== "knowledge") return decision;
  return {
    ...decision,
    knowledgeSource: inferKnowledgeSource(question),
  };
}

export function resolveGatherSources(input: {
  question: string;
  lane: WorkflowLane;
  knowledgeSource?: KnowledgeSource;
  hasKnowledge: boolean;
  hasWeb: boolean;
  hasServer: boolean;
}): { knowledge: boolean; web: boolean; server: boolean } {
  const server = input.hasServer;
  const preferred: KnowledgeSource =
    input.lane === "knowledge_then_action"
      ? "knowledge"
      : (input.knowledgeSource ?? inferKnowledgeSource(input.question));

  if (preferred === "web") {
    if (input.hasWeb) return { knowledge: false, web: true, server };
    if (input.hasKnowledge) return { knowledge: true, web: false, server };
    return { knowledge: false, web: false, server };
  }
  if (input.hasKnowledge) return { knowledge: true, web: false, server };
  if (input.hasWeb) return { knowledge: false, web: true, server };
  return { knowledge: false, web: false, server };
}
