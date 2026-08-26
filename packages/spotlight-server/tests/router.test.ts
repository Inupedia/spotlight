import { FakeToolCallingModel } from "langchain";
import {
  applyToolInputCompletenessFence,
  LangChainIntentRouter,
} from "../src/router.js";
import { normalizeClientToolInputDetailed } from "../src/tools.js";

const readOnlyVideoTool = {
  name: "getVideoInfo",
  version: "1.0.0",
  description: "查询摄像头覆盖场景",
  inputSchema: { type: "object", properties: {} },
  sideEffect: "none" as const,
  replayPolicy: "safe" as const,
  riskLevel: "low" as const,
};

const monitoringSkill = {
  name: "skill.monitoring",
  displayName: "现场监控",
  description: "查询摄像头数量、在线状态和覆盖场景，并打开或关闭监控画面。",
  whenToUse:
    "用户询问摄像头有哪些、数量、在线状态、覆盖哪些场景或气体监测，或要求打开、播放、关闭监控画面。",
  allowedTools: ["getVideoInfo", "openVideoMonitoring"],
  responseStrategy: "tool_answer" as const,
  capabilityExamples: ["摄像头具体涉及了哪些场景", "目前有哪些摄像头"],
};

const knowledgeSkill = {
  name: "skill.knowledge",
  displayName: "项目知识问答",
  description: "使用知识库回答项目介绍、概念解释与公开信息问题。",
  whenToUse:
    "用户询问项目是什么、工程介绍、模块含义、具体事实、公开资料，且没有要求操作当前页面。",
  responseStrategy: "direct_answer" as const,
};

describe("LangChain intent router", () => {
  it("drops null optional client-tool fields before schema validation", () => {
    const playVideoTool = {
      name: "playVideoFullscreen",
      version: "1.0.0",
      description: "按通道 ID 或名称播放视频",
      inputSchema: {
        type: "object" as const,
        properties: {
          videoChannelId: { type: "string" },
          name: { type: "string" },
        },
        additionalProperties: false,
      },
      sideEffect: "ui" as const,
      replayPolicy: "never" as const,
      riskLevel: "low" as const,
    };
    const decision = applyToolInputCompletenessFence(
      {
        route: "action",
        confidence: 1,
        reason: "monitoring target",
        requestedToolNames: [playVideoTool.name],
        explicitActionEvidence: "查看",
        requestedToolInput: {
          videoChannelId: null,
          name: "钢筋棚加工区2",
          invented: null,
        },
      },
      [playVideoTool],
    );

    expect(decision.route).toBe("action");
    expect(decision.requestedToolInput).toEqual({ name: "钢筋棚加工区2" });
    expect(decision.toolInputNormalization).toEqual([
      { path: "$.videoChannelId", reason: "optional_null" },
      { path: "$.invented", reason: "unknown_property" },
    ]);
  });

  it("recursively normalizes nested client-tool input and reports what changed", () => {
    const descriptor = {
      name: "openAsset",
      version: "1.0.0",
      description: "打开资产",
      inputSchema: {
        type: "object" as const,
        properties: {
          target: {
            type: "object",
            properties: {
              name: { type: "string" },
              floor: { type: "string" },
              nullableNote: { type: ["string", "null"] },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      sideEffect: "ui" as const,
      replayPolicy: "never" as const,
      riskLevel: "low" as const,
    };

    const result = normalizeClientToolInputDetailed(descriptor, {
      target: {
        name: "泸定取水口",
        floor: null,
        nullableNote: null,
        invented: "模型臆造",
      },
      unexpected: true,
    });

    expect(result.input).toEqual({
      target: { name: "泸定取水口", nullableNote: null },
    });
    expect(result.removed).toEqual([
      { path: "$.target.floor", reason: "optional_null" },
      { path: "$.target.invented", reason: "unknown_property" },
      { path: "$.unexpected", reason: "unknown_property" },
    ]);
  });

  it("routes informational questions to knowledge when no consumer skills are registered", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        route: "action",
        confidence: 1,
        reason: "wrong",
        requestedToolNames: ["startTunnelPatrol"],
      },
    });
    const router = new LangChainIntentRouter(model);
    const decision = await router.route("介绍下引大济岷", []);
    expect(decision.route).toBe("knowledge");
    expect(decision.requestedToolNames).toEqual([]);
    expect(decision.knowledgeSource).toBe("web");
  });

  it.each([
    "返回项目主场景",
    "查看水工建筑物中场景",
    "切换主场景到工程总览",
    "进入二郎山二号支洞巡检",
  ])(
    "routes an explicit action without asking the model to preselect a tool: %s",
    async (question) => {
      const model = new FakeToolCallingModel({
        structuredResponse: {
          route: "clarify",
          confidence: 0,
          reason: "unstable model output",
          requestedToolNames: [],
        },
      });
      const router = new LangChainIntentRouter(model);
      const decision = await router.route(question, []);
      expect(decision.route).toBe("action");
      expect(decision.confidence).toBe(1);
      expect(decision.requestedToolNames).toEqual([]);
      expect(decision.explicitActionEvidence).not.toBeNull();
      expect(model.index).toBe(0);
    },
  );

  it("routes monitoring list questions semantically via the skill catalog", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        route: "action",
        matchedSkillNames: ["skill.monitoring"],
        requestedToolNames: ["getVideoInfo"],
        confidence: 0.95,
        reason: "Monitoring list query matches tool_answer skill.",
      },
    });
    const router = new LangChainIntentRouter(model);
    const decision = await router.route(
      "目前有哪些监控",
      [readOnlyVideoTool],
      [monitoringSkill],
    );

    expect(decision.route).toBe("action");
    expect(decision.requestedToolNames).toEqual(["getVideoInfo"]);
    expect(decision.matchedSkillNames).toEqual(["skill.monitoring"]);
    expect(decision.explicitActionEvidence).toBe("skill:skill.monitoring");
  });

  it("routes project introductions to skill.knowledge instead of action skills", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        route: "knowledge",
        matchedSkillNames: ["skill.knowledge"],
        requestedToolNames: [],
        confidence: 0.98,
        reason: "Project introduction belongs to knowledge skill.",
      },
    });
    const router = new LangChainIntentRouter(model);
    const decision = await router.route(
      "介绍下引大济岷",
      [readOnlyVideoTool],
      [
        knowledgeSkill,
        {
          ...monitoringSkill,
          capabilityExamples: ["介绍下引大济岷"],
        },
      ],
    );

    expect(decision.route).toBe("knowledge");
    expect(decision.matchedSkillNames).toEqual(["skill.knowledge"]);
    expect(decision.requestedToolNames).toEqual([]);
  });

  it("uses structured output to narrow a multi-tool Skill to one registered tool", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        route: "action",
        matchedSkillNames: ["skill.progress.filters"],
        requestedToolNames: ["selectQualityYear"],
        toolInput: { year: "2024" },
        confidence: 1,
        reason: "Quality year filter",
      },
    });
    const router = new LangChainIntentRouter(model);
    const tool = (name: string, description: string) => ({
      name,
      version: "1.0.0",
      description,
      inputSchema: { type: "object" as const, properties: {} },
      sideEffect: "ui" as const,
      replayPolicy: "never" as const,
      riskLevel: "low" as const,
    });
    const decision = await router.route(
      "查看2024年质量数据",
      [
        tool("selectQualitySegment", "切换质量标段"),
        tool("selectQualityYear", "切换质量年份"),
      ],
      [
        {
          name: "skill.progress.filters",
          description: "质量筛选",
          allowedTools: ["selectQualitySegment", "selectQualityYear"],
          responseStrategy: "tool_answer",
          capabilityExamples: ["查看2024年质量数据"],
        },
      ],
    );

    expect(decision.route).toBe("action");
    expect(decision.requestedToolNames).toEqual(["selectQualityYear"]);
    expect(decision.requestedToolInput).toEqual({ year: "2024" });
    expect(decision.matchedSkillNames).toEqual(["skill.progress.filters"]);
  });

  it("routes an exact consumer tool example deterministically and extracts enum input", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        route: "clarify",
        matchedSkillNames: [],
        requestedToolNames: [],
        confidence: 1,
        reason: "This response must not override an exact tool example.",
      },
    });
    const router = new LangChainIntentRouter(model);
    const decision = await router.route(
      "查看 2024 年质量数据",
      [
        {
          name: "selectQualityYear",
          version: "1.0.0",
          description: "切换质量年份",
          inputSchema: {
            type: "object",
            properties: {
              year: { type: "string", enum: ["2023", "2024", "2025"] },
            },
            required: ["year"],
            additionalProperties: false,
          },
          sideEffect: "ui",
          replayPolicy: "never",
          riskLevel: "low",
        },
      ],
      [
        {
          name: "skill.progress.filters",
          description: "质量筛选",
          allowedTools: ["selectQualityYear"],
          responseStrategy: "tool_answer",
          toolExamples: [
            {
              example: "查看2024年质量数据",
              toolName: "selectQualityYear",
            },
          ],
        },
      ],
    );

    expect(decision).toMatchObject({
      route: "action",
      requestedToolNames: ["selectQualityYear"],
      requestedToolInput: { year: "2024" },
      matchedSkillNames: ["skill.progress.filters"],
      confidence: 1,
    });
  });

  it("keeps exact tool selection while using structured extraction for required free-form input", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        toolName: "openPersonDetail",
        toolInput: { name: "张三" },
      },
    });
    const router = new LangChainIntentRouter(model);
    const decision = await router.route(
      "打开张三的人员详情",
      [
        {
          name: "openPersonDetail",
          version: "1.0.0",
          description: "打开人员详情",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
          sideEffect: "ui",
          replayPolicy: "never",
          riskLevel: "low",
        },
        {
          name: "closePersonDetail",
          version: "1.0.0",
          description: "关闭人员详情",
          inputSchema: { type: "object", properties: {} },
          sideEffect: "ui",
          replayPolicy: "never",
          riskLevel: "low",
        },
      ],
      [
        {
          name: "skill.onsite",
          description: "人员详情操作",
          allowedTools: ["openPersonDetail", "closePersonDetail"],
          responseStrategy: "tool_answer",
          toolExamples: [
            {
              example: "打开张三的人员详情",
              toolName: "openPersonDetail",
            },
          ],
        },
      ],
    );

    expect(decision).toMatchObject({
      route: "action",
      requestedToolNames: ["openPersonDetail"],
      requestedToolInput: { name: "张三" },
      matchedSkillNames: ["skill.onsite"],
    });
  });

  it("copies an exact resource target into the required query without a model guess", async () => {
    const router = new LangChainIntentRouter(new FakeToolCallingModel());
    const decision = await router.route(
      "我想看一下钢筋棚加工区2",
      [
        {
          name: "playVideoFullscreen",
          namespace: "video",
          version: "1.0.0",
          description: "播放指定视频资源",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", minLength: 1 } },
            required: ["query"],
            additionalProperties: false,
          },
          resource: {
            namespace: "video",
            operation: "action",
            action: "play",
            inputKey: "query",
          },
          sideEffect: "ui",
          replayPolicy: "safe",
          riskLevel: "low",
        },
      ],
      [
        {
          name: "skill.monitoring",
          description: "现场监控",
          allowedTools: ["playVideoFullscreen"],
          responseStrategy: "tool_answer",
          toolExamples: [
            {
              example: "我想看一下钢筋棚加工区2",
              toolName: "playVideoFullscreen",
            },
          ],
        },
      ],
    );

    expect(decision).toMatchObject({
      route: "action",
      requestedToolNames: ["playVideoFullscreen"],
      requestedToolInput: { query: "钢筋棚加工区2" },
    });
  });

  it("infers a read-only tool when the skill route omits requestedToolNames", async () => {
    const model = new FakeToolCallingModel({
      structuredResponse: {
        route: "action",
        matchedSkillNames: ["skill.monitoring"],
        requestedToolNames: [],
        confidence: 0.92,
        reason: "Monitoring list query",
      },
    });
    const router = new LangChainIntentRouter(model);
    const decision = await router.route(
      "摄像头具体涉及了哪些场景",
      [readOnlyVideoTool],
      [monitoringSkill],
    );

    expect(decision.route).toBe("action");
    expect(decision.requestedToolNames).toEqual(["getVideoInfo"]);
  });
});
