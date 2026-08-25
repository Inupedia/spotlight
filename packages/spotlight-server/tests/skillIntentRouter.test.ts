import {
  buildSkillCatalog,
  enrichSkillToolRoute,
  extractMonitorTargetName,
  extractOpenTargetName,
  hasOpenTargetIntent,
  isSkillListQuery,
  type SkillRouteResult,
} from "../src/skillIntentRouter.js";

const productSkill = {
  name: "skill.products",
  description: "商品浏览",
  allowedTools: ["getProductList", "openProduct"],
  responseStrategy: "tool_answer" as const,
};

const mediaSkill = {
  name: "skill.media",
  description: "媒体频道",
  allowedTools: ["getChannelList", "playChannel"],
  responseStrategy: "tool_answer" as const,
};

const cartSkill = {
  name: "skill.cart",
  description: "购物车",
  allowedTools: ["addToCart", "removeFromCart"],
  responseStrategy: "tool_answer" as const,
};

const reservationSkill = {
  name: "skill.reservations",
  description: "图书预约",
  allowedTools: ["getReservationList", "reserveBookByTitle"],
  responseStrategy: "tool_answer" as const,
};

const inventorySkill = {
  name: "skill.inventory",
  description: "库存查询",
  allowedTools: ["listInventory"],
  responseStrategy: "tool_answer" as const,
};

const clientTools = [
  {
    name: "getProductList",
    version: "1.0.0",
    description: "列出商品",
    inputSchema: { type: "object" },
    sideEffect: "none" as const,
    replayPolicy: "safe" as const,
    riskLevel: "low" as const,
  },
  {
    name: "openProduct",
    version: "1.0.0",
    description: "打开商品详情",
    inputSchema: {
      type: "object",
      properties: { productName: { type: "string" } },
      required: ["productName"],
    },
    sideEffect: "ui" as const,
    replayPolicy: "never" as const,
    riskLevel: "low" as const,
  },
  {
    name: "getChannelList",
    version: "1.0.0",
    description: "列出频道",
    inputSchema: { type: "object" },
    sideEffect: "none" as const,
    replayPolicy: "safe" as const,
    riskLevel: "low" as const,
  },
  {
    name: "playChannel",
    version: "1.0.0",
    description: "播放频道",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    sideEffect: "ui" as const,
    replayPolicy: "never" as const,
    riskLevel: "low" as const,
  },
  {
    name: "addToCart",
    version: "1.0.0",
    description: "加入购物车",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string" },
        quantity: { type: "number" },
      },
      required: ["productName", "quantity"],
    },
    sideEffect: "ui" as const,
    replayPolicy: "never" as const,
    riskLevel: "medium" as const,
  },
  {
    name: "removeFromCart",
    version: "1.0.0",
    description: "从购物车移除",
    inputSchema: {
      type: "object",
      properties: { productName: { type: "string" } },
      required: ["productName"],
    },
    sideEffect: "ui" as const,
    replayPolicy: "never" as const,
    riskLevel: "medium" as const,
  },
  {
    name: "getReservationList",
    version: "1.0.0",
    description: "查看当前预约记录",
    inputSchema: { type: "object" },
    sideEffect: "none" as const,
    replayPolicy: "safe" as const,
    riskLevel: "low" as const,
  },
  {
    name: "reserveBookByTitle",
    version: "1.0.0",
    description: "创建图书预约",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
    sideEffect: "external" as const,
    replayPolicy: "never" as const,
    riskLevel: "high" as const,
    requiresConfirmation: true,
  },
  {
    name: "listInventory",
    version: "1.0.0",
    description: "查询库存，可按最大库存量筛选",
    inputSchema: {
      type: "object",
      properties: { maxQty: { type: "number" } },
    },
    sideEffect: "none" as const,
    replayPolicy: "safe" as const,
    riskLevel: "low" as const,
  },
];

describe("skill tool route enrichment", () => {
  it("extracts named targets without product-specific cleanup", () => {
    expect(extractOpenTargetName("打开 Classic Tee")).toBe("Classic Tee");
    expect(extractMonitorTargetName("查看 Main Camera")).toBe("Main Camera");
  });

  it("routes a named product request to the skill's open tool", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.products"],
      requestedToolNames: ["getProductList"],
      confidence: 0.9,
      reason: "model picked list tool",
    };
    const enriched = enrichSkillToolRoute(
      "打开 Classic Tee",
      route,
      [productSkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual(["openProduct"]);
    expect(enriched.toolInput).toEqual({ productName: "Classic Tee" });
  });

  it("routes a named media request using its own required argument name", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.media"],
      requestedToolNames: ["getChannelList"],
      confidence: 0.9,
      reason: "model picked list tool",
    };
    const enriched = enrichSkillToolRoute(
      "播放 Main Camera",
      route,
      [mediaSkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual(["playChannel"]);
    expect(enriched.toolInput).toEqual({ name: "Main Camera" });
  });

  it("corrects a catalog opener to the targetable player for a named item", () => {
    const skill = {
      name: "skill.monitoring",
      description: "视频监控",
      allowedTools: ["openVideoMonitoring", "playVideoFullscreen"],
      responseStrategy: "tool_answer" as const,
    };
    const tools = [
      {
        name: "openVideoMonitoring",
        version: "1.0.0",
        description: "仅打开视频监控列表，不播放具体通道",
        inputSchema: { type: "object", properties: {} },
        sideEffect: "ui" as const,
        replayPolicy: "never" as const,
        riskLevel: "low" as const,
      },
      {
        name: "playVideoFullscreen",
        version: "1.0.0",
        description: "按通道 ID 或名称播放监控",
        inputSchema: {
          type: "object",
          properties: {
            videoChannelId: { type: "string" },
            name: { type: "string" },
          },
        },
        sideEffect: "ui" as const,
        replayPolicy: "never" as const,
        riskLevel: "low" as const,
      },
    ];
    const enriched = enrichSkillToolRoute(
      "查看二郎山隧洞项目隧洞洞口",
      {
        route: "action",
        matchedSkillNames: [skill.name],
        requestedToolNames: ["openVideoMonitoring"],
        confidence: 0.9,
        reason: "model selected the catalog opener",
      },
      [skill],
      tools,
    );

    expect(enriched.requestedToolNames).toEqual(["playVideoFullscreen"]);
    expect(enriched.toolInput).toEqual({
      name: "二郎山隧洞项目隧洞洞口",
    });
  });

  it("keeps list queries on a unique read-only tool", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.products"],
      requestedToolNames: [],
      confidence: 0.9,
      reason: "list",
    };
    const enriched = enrichSkillToolRoute(
      "目前有哪些商品",
      route,
      [productSkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual(["getProductList"]);
    expect(isSkillListQuery("目前有哪些商品")).toBe(true);
  });

  it("preserves optional list filters extracted from the user request", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.inventory"],
      requestedToolNames: ["listInventory"],
      toolInput: { maxQty: 10 },
      confidence: 0.93,
      reason: "filtered inventory list",
    };
    const enriched = enrichSkillToolRoute(
      "查看库存低于10的物料有哪些",
      route,
      [inventorySkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual(["listInventory"]);
    expect(enriched.toolInput).toEqual({ maxQty: 10 });
  });

  it("does not rewrite non-open mutations from another action family", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.cart"],
      requestedToolNames: ["addToCart"],
      toolInput: { productName: "Classic Tee", quantity: 2 },
      confidence: 0.94,
      reason: "cart mutation",
    };
    const enriched = enrichSkillToolRoute(
      "把 Classic Tee 加 2 件到购物车",
      route,
      [cartSkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual(["addToCart"]);
    expect(enriched.toolInput).toEqual({
      productName: "Classic Tee",
      quantity: 2,
    });
  });

  it("never infers a write tool as open from a single string argument", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.reservations"],
      requestedToolNames: ["getReservationList"],
      confidence: 0.91,
      reason: "model chose safe read",
    };
    const enriched = enrichSkillToolRoute(
      "查看《活着》",
      route,
      [reservationSkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual(["getReservationList"]);
    expect(enriched.requestedToolNames).not.toContain("reserveBookByTitle");
  });

  it("does not guess a tool when multiple skills are matched", () => {
    const route: SkillRouteResult = {
      route: "action",
      matchedSkillNames: ["skill.products", "skill.media"],
      requestedToolNames: [],
      confidence: 0.72,
      reason: "ambiguous domain",
    };
    const enriched = enrichSkillToolRoute(
      "打开 Main Camera",
      route,
      [productSkill, mediaSkill],
      clientTools,
    );
    expect(enriched.requestedToolNames).toEqual([]);
  });

  it("recognizes English list and open intent families", () => {
    expect(isSkillListQuery("list available products")).toBe(true);
    expect(hasOpenTargetIntent("open Classic Tee")).toBe(true);
  });

  it("keeps query-relevant examples even when they are late in a large Skill catalog", () => {
    const catalog = buildSkillCatalog(
      [
        {
          ...mediaSkill,
          capabilityExamples: [
            "打开大坝监控",
            "播放隧洞监控",
            "看看进水口",
            "显示厂房视频",
            "查看生活区",
            "打开料场",
            "我想看一下钢筋棚加工区2",
            "关闭当前监控",
          ],
        },
      ],
      clientTools,
      "我想看一下钢筋棚加工区2",
    );

    expect(catalog[0]?.capabilityExamples).toContain("我想看一下钢筋棚加工区2");
    expect(catalog[0]?.capabilityExamples).toHaveLength(6);
  });
});
