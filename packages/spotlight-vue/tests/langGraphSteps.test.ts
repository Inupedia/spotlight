import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  applyLifecycleEvent,
  applyLangGraphTransition,
  applyRemoteEvent,
  beginHostToolCall,
  responseStepLabel,
  settleHostToolCall,
} from "../src/remote/runPipeline.js";
import { appendStepToolCalls } from "../src/store/pipeline/steps.js";
import type { HandlerApi } from "../src/store/pipeline/types.js";
import type { AgentStep } from "../src/store/types.js";
import type { SpotlightExecutionEvent } from "../src/store/runtime/types.js";
import { resolveToolLane } from "../src/store/pipeline/toolLane.js";

beforeEach(() => setActivePinia(createPinia()));

function createApi() {
  let steps: AgentStep[] = [];
  const api = {
    getSteps: () => steps,
    setSteps: (next: AgentStep[]) => {
      steps = next;
    },
    setStep: (
      id: string,
      status: AgentStep["status"],
      content?: string,
    ) => {
      steps = steps.map((step) =>
        step.id === id
          ? { ...step, status, ...(content === undefined ? {} : { content }) }
          : step,
      );
    },
    appendToolCallsToStep: (
      stepId: string,
      toolCalls: NonNullable<AgentStep["toolCalls"]>,
    ) => {
      appendStepToolCalls(steps, stepId, toolCalls);
    },
  } as unknown as HandlerApi;
  return { api, getSteps: () => steps };
}

function transition(
  phase: Extract<
    SpotlightExecutionEvent,
    { type: "turn_transition" }
  >["phase"],
  summary: string,
): Extract<SpotlightExecutionEvent, { type: "turn_transition" }> {
  return {
    type: "turn_transition",
    at: Date.now(),
    turnId: "turn-1",
    phase,
    summary,
  };
}

describe("resolveToolLane", () => {
  it("treats knowledge search as 获取信息", () => {
    expect(resolveToolLane("web_search")).toBe("gather");
    expect(resolveToolLane("project_knowledge_search")).toBe("gather");
    expect(resolveToolLane("query_kb")).toBe("gather");
  });

  it("splits client tools by sideEffect, not by 'is a tool'", () => {
    expect(resolveToolLane("getVideoInfo", "none")).toBe("gather");
    expect(resolveToolLane("playVideoFullscreen", "ui")).toBe("act");
  });
});

describe("LangGraph progress steps", () => {
  it("shows action tools under 操作页面, not a leftover 选择工具 step", async () => {
    const { api, getSteps } = createApi();
    applyLangGraphTransition(api, transition("routing", "正在路由"));
    applyLangGraphTransition(api, transition("router_done", "已路由到 action Agent"));
    applyLangGraphTransition(api, transition("action_agent_start", "Action Agent 已启动"));

    expect(getSteps()).toEqual([
      expect.objectContaining({ label: "理解问题", status: "done" }),
    ]);

    await applyRemoteEvent(api, {
      type: "tool_start",
      at: Date.now(),
      iteration: 1,
      call: {
        id: "play-1",
        name: "playVideoFullscreen",
        input: { name: "泸定取水口" },
        displayName: "全屏播放监控",
      },
    });

    expect(getSteps()).toEqual([
      expect.objectContaining({ label: "理解问题", status: "done" }),
      expect.objectContaining({ label: "操作页面", status: "active" }),
    ]);
    expect(responseStepLabel(api)).toBe("回答");
  });

  it("puts knowledge retrieval into 获取信息 and keeps 回答 separate", async () => {
    const { api, getSteps } = createApi();
    applyLangGraphTransition(api, transition("routing", "正在路由"));
    applyLangGraphTransition(api, transition("router_done", "已路由到 knowledge Agent"));
    applyLangGraphTransition(
      api,
      transition("knowledge_agent_start", "正在使用联网搜索搜索：“引大济岷”。"),
    );
    await applyRemoteEvent(api, {
      type: "tool_start",
      at: Date.now(),
      iteration: 1,
      call: {
        id: "web-1",
        name: "web_search",
        input: { query: "引大济岷" },
        displayName: "联网搜索",
      },
    });
    applyLangGraphTransition(
      api,
      transition("knowledge_agent_done", "联网搜索命中 3 条资料。"),
    );
    await applyRemoteEvent(api, {
      type: "assistant_response",
      at: Date.now(),
      iteration: 1,
      content: "引大济岷是一项跨流域调水工程。",
    });

    expect(getSteps()).toEqual([
      expect.objectContaining({ label: "理解问题", status: "done" }),
      expect.objectContaining({
        label: "获取信息",
        status: "done",
        toolCalls: [
          expect.objectContaining({ name: "web_search", status: "running" }),
        ],
      }),
      expect.objectContaining({
        label: "回答",
        status: "done",
        content: "引大济岷是一项跨流域调水工程。",
      }),
    ]);
    expect(responseStepLabel(api)).toBe("回答");
  });

  it("keeps web search snippets in the expandable tool result", async () => {
    const { api, getSteps } = createApi();
    await applyRemoteEvent(api, {
      type: "tool_start",
      at: Date.now(),
      iteration: 1,
      call: {
        id: "web-1",
        name: "web_search",
        input: { query: "引大济岷" },
        displayName: "联网搜索",
      },
    });
    await applyRemoteEvent(api, {
      type: "tool_result",
      at: Date.now(),
      iteration: 1,
      result: {
        call: {
          id: "web-1",
          name: "web_search",
          input: { query: "引大济岷" },
          displayName: "联网搜索",
        },
        success: true,
        summary:
          "联网搜索检索“引大济岷”命中 2 条资料：\n1. 引大济岷工程 - 维基百科\n2. 四川为什么需要引大济岷",
        output: [
          { content: "引大济岷是一项跨流域调水工程。" },
          {
            title: "引大济岷工程 - 维基百科",
            url: "https://example.com/wiki",
            content: "从大渡河引水补充岷江。",
          },
        ],
        trace: [],
      },
    });

    const gather = getSteps().find((step) => step.id === "gather");
    expect(gather?.toolCalls?.[0]?.resultText).toContain(
      "引大济岷是一项跨流域调水工程。",
    );
    expect(gather?.toolCalls?.[0]?.resultText).toContain("从大渡河引水补充岷江。");
  });

  it("labels a clarification response without pretending a tool ran", () => {
    const { api, getSteps } = createApi();
    applyLangGraphTransition(api, transition("routing", "正在路由"));
    applyLangGraphTransition(api, transition("router_done", "已路由到 clarify Agent"));
    expect(getSteps()).toEqual([
      expect.objectContaining({ label: "理解问题", status: "done" }),
    ]);
    expect(responseStepLabel(api)).toBe("回答");
  });

  it("keeps memory replay on 理解问题 and never leaves it active", async () => {
    const { api, getSteps } = createApi();
    await applyRemoteEvent(api, {
      type: "memory_decision",
      at: Date.now(),
      turnId: "turn-1",
      decision: {
        action: "ignore",
        reasonCode: "no_hit",
        confidence: 0,
        memoryIds: [],
        canForceRefresh: false,
      },
    });
    applyLangGraphTransition(api, transition("routing", "正在路由"));
    applyLangGraphTransition(api, transition("router_done", "已路由"));

    const understand = getSteps().find((step) => step.label === "理解问题");
    expect(understand?.status).toBe("done");
    expect(getSteps().some((step) => step.label === "问题拆解")).toBe(false);
  });

  it("routes getVideoInfo to 获取信息 and playVideoFullscreen to 操作页面", async () => {
    const { api, getSteps } = createApi();
    const lookup = {
      sideEffectByName: new Map([
        ["getVideoInfo", "none" as const],
        ["playVideoFullscreen", "ui" as const],
      ]),
    };

    await applyRemoteEvent(
      api,
      {
        type: "tool_start",
        at: Date.now(),
        iteration: 1,
        call: {
          id: "get-1",
          name: "getVideoInfo",
          input: {},
          displayName: "获取监控信息",
        },
      },
      lookup,
    );
    await applyRemoteEvent(
      api,
      {
        type: "tool_result",
        at: Date.now(),
        iteration: 1,
        result: {
          call: {
            id: "get-1",
            name: "getVideoInfo",
            input: {},
            displayName: "获取监控信息",
          },
          success: true,
          summary: "当前有 12 路监控",
          output: [{ name: "泸定取水口" }],
          trace: [],
        },
      },
      lookup,
    );
    await applyRemoteEvent(
      api,
      {
        type: "tool_start",
        at: Date.now(),
        iteration: 1,
        call: {
          id: "play-1",
          name: "playVideoFullscreen",
          input: { name: "泸定取水口" },
          displayName: "全屏播放监控",
        },
      },
      lookup,
    );
    await applyRemoteEvent(api, {
      type: "assistant_response",
      at: Date.now(),
      iteration: 1,
      content: "当前共有 12 路监控，已为您打开泸定取水口。",
    });

    const gather = getSteps().find((step) => step.label === "获取信息");
    const act = getSteps().find((step) => step.label === "操作页面");
    const answer = getSteps().find((step) => step.label === "回答");
    expect(gather?.toolCalls).toEqual([
      expect.objectContaining({
        name: "getVideoInfo",
        status: "done",
        summary: "当前有 12 路监控",
      }),
    ]);
    expect(act?.toolCalls).toEqual([
      expect.objectContaining({
        name: "playVideoFullscreen",
        status: "running",
      }),
    ]);
    expect(answer?.content).toBe("当前共有 12 路监控，已为您打开泸定取水口。");
    expect(gather?.status).toBe("done");
    expect(act?.status).toBe("done");
  });

  it("renders expandable knowledge tool calls on 获取信息", async () => {
    const { api, getSteps } = createApi();
    await applyRemoteEvent(api, {
      type: "tool_start",
      at: Date.now(),
      iteration: 1,
      call: {
        id: "kb-1",
        name: "project_knowledge_search",
        input: { query: "引大济岷" },
        displayName: "检索项目知识库",
      },
    });
    await applyRemoteEvent(api, {
      type: "tool_start",
      at: Date.now(),
      iteration: 1,
      call: {
        id: "query-1",
        name: "query_kb",
        input: { query: "引大济岷" },
        displayName: "query_kb",
      },
    });
    await applyRemoteEvent(api, {
      type: "tool_result",
      at: Date.now(),
      iteration: 1,
      result: {
        call: {
          id: "query-1",
          name: "query_kb",
          input: { query: "引大济岷" },
          displayName: "query_kb",
        },
        success: true,
        summary: "query_kb 已返回结果",
        output: [{ title: "工程概况" }],
        trace: [],
      },
    });

    const gather = getSteps().find((step) => step.id === "gather");
    expect(gather?.status).toBe("active");
    expect(gather?.toolCalls).toEqual([
      expect.objectContaining({
        id: "kb-1",
        name: "project_knowledge_search",
        status: "running",
      }),
      expect.objectContaining({
        id: "query-1",
        name: "query_kb",
        status: "done",
      }),
    ]);
  });

  it("shows host tool execution on 操作页面 while the frontend action is running", () => {
    const { api, getSteps } = createApi();
    const call = {
      id: "host-1",
      name: "mode.openPeopleFocus",
      input: {},
      displayName: "开启人员定位",
    };
    beginHostToolCall(api, call, {
      sideEffectByName: new Map([["mode.openPeopleFocus", "ui"]]),
    });
    expect(getSteps()[0]?.label).toBe("操作页面");
    expect(getSteps()[0]?.toolCalls).toEqual([
      expect.objectContaining({
        id: "host-1",
        name: "mode.openPeopleFocus",
        status: "running",
      }),
    ]);
    settleHostToolCall(api, call, {
      success: true,
      data: { opened: true },
      trace: [],
      executionTarget: "host",
    });
    expect(getSteps()[0]?.toolCalls).toEqual([
      expect.objectContaining({
        id: "host-1",
        status: "done",
      }),
    ]);
  });
});

describe("Thread / Turn / Item progress", () => {
  it("shows the selected Skill and exact Tool without LangGraph phase names", async () => {
    const { api, getSteps } = createApi();
    await applyLifecycleEvent(api, {
      type: "turn.started",
      at: 1,
      seq: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      turn: { id: "turn-1", threadId: "thread-1", status: "in_progress", startedAt: 1 },
    });
    await applyLifecycleEvent(api, {
      type: "item.completed",
      at: 2,
      seq: 2,
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "skill-1",
        type: "skill_use",
        skill: "skill.monitoring",
        displayName: "视频监控",
        source: "router",
        status: "completed",
        startedAt: 2,
        completedAt: 2,
      },
    });
    await applyLifecycleEvent(api, {
      type: "item.started",
      at: 3,
      seq: 3,
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "call-1",
        type: "tool_call",
        tool: "panel.openVideo",
        displayName: "打开视频",
        target: "browser",
        arguments: { name: "泸定取水口" },
        status: "in_progress",
        startedAt: 3,
      },
    });

    expect(getSteps()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "使用 Skill",
        content: "- 视频监控（skill.monitoring）",
        status: "done",
      }),
      expect.objectContaining({
        label: "操作页面",
        toolCalls: [expect.objectContaining({ name: "panel.openVideo" })],
      }),
    ]));
    expect(JSON.stringify(getSteps())).not.toContain("router_done");
  });
});
