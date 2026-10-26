import {
  inferKnowledgeSource,
  prefersProjectKnowledgeBase,
  resolveGatherSources,
} from "../src/knowledgeSource.js";

describe("knowledge source intent", () => {
  it("prefers the project knowledge base for ordinary information questions", () => {
    expect(inferKnowledgeSource("介绍下引大济岷")).toBe("knowledge");
    expect(inferKnowledgeSource("项目是什么")).toBe("knowledge");
    expect(prefersProjectKnowledgeBase("工程进度目前怎么样")).toBe(true);
  });

  it("uses web search for explicit external or time-sensitive questions", () => {
    expect(inferKnowledgeSource("请联网搜索最近有什么公开新闻")).toBe("web");
    expect(inferKnowledgeSource("查一下最新政策")).toBe("web");
    expect(prefersProjectKnowledgeBase("实时天气怎么样")).toBe(false);
  });

  it("prefers the project knowledge base for in-product facts", () => {
    expect(inferKnowledgeSource("这个模块是什么意思")).toBe("knowledge");
    expect(inferKnowledgeSource("知识库里进度指标含义")).toBe("knowledge");
  });

  it("does not fan out to web search for project questions", () => {
    expect(
      resolveGatherSources({
        question: "介绍下引大济岷",
        lane: "knowledge",
        hasKnowledge: true,
        hasWeb: true,
        hasServer: false,
      }),
    ).toEqual({ knowledge: true, web: false, server: false });
  });

  it("falls back to Yuxi when web search is not configured", () => {
    expect(
      resolveGatherSources({
        question: "介绍下引大济岷",
        lane: "knowledge",
        hasKnowledge: true,
        hasWeb: false,
        hasServer: false,
      }),
    ).toEqual({ knowledge: true, web: false, server: false });
  });

  it("uses the knowledge base for knowledge-then-action even if the question looks public", () => {
    expect(
      resolveGatherSources({
        question: "介绍下引大济岷",
        lane: "knowledge_then_action",
        knowledgeSource: "web",
        hasKnowledge: true,
        hasWeb: true,
        hasServer: false,
      }),
    ).toEqual({ knowledge: true, web: false, server: false });
  });
});
