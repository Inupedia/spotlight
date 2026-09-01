import { describe, expect, it } from "vitest";
import { parseCorsOrigin, resolveModelConfigs } from "../src/cli.js";

describe("resolveModelConfigs", () => {
  it("uses SiliconFlow for both the agent and router by default", () => {
    const resolved = resolveModelConfigs({
      SILICONFLOW_API_KEY: "sf-key",
      SILICONFLOW_API_BASE: "https://api.siliconflow.cn/v1",
      SILICONFLOW_MODEL: "Qwen/Qwen3-32B",
      QWEN_API_KEY: "expired-qwen-key",
      QWEN_API_BASE: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      QWEN_MODEL: "qwen-plus",
    });

    expect(resolved.modelConfig).toMatchObject({
      apiKey: "sf-key",
      baseURL: "https://api.siliconflow.cn/v1",
      model: "Qwen/Qwen3-32B",
    });
    expect(resolved.routerConfig).toMatchObject({
      apiKey: "sf-key",
      baseURL: "https://api.siliconflow.cn/v1",
      model: "Qwen/Qwen3-32B",
    });
  });

  it("only uses Qwen when the provider is explicitly qwen", () => {
    const resolved = resolveModelConfigs({
      SPOTLIGHT_LLM_PROVIDER: "qwen",
      SILICONFLOW_API_KEY: "sf-key",
      QWEN_API_KEY: "qwen-key",
      QWEN_API_BASE: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      QWEN_MODEL: "qwen-plus",
    });

    expect(resolved.modelConfig.apiKey).toBe("qwen-key");
    expect(resolved.routerConfig.apiKey).toBe("qwen-key");
    expect(resolved.routerConfig.model).toBe("qwen-plus");
  });

  it("allows an explicit independent router override", () => {
    const resolved = resolveModelConfigs({
      SILICONFLOW_API_KEY: "sf-key",
      SILICONFLOW_API_BASE: "https://api.siliconflow.cn/v1",
      SILICONFLOW_MODEL: "Qwen/Qwen3-32B",
      SPOTLIGHT_ROUTER_API_KEY: "router-key",
      SPOTLIGHT_ROUTER_BASE_URL: "https://router.example/v1",
      SPOTLIGHT_ROUTER_MODEL: "router-model",
    });

    expect(resolved.routerConfig).toMatchObject({
      apiKey: "router-key",
      baseURL: "https://router.example/v1",
      model: "router-model",
    });
  });

  it("splits comma-separated CORS origins", () => {
    expect(parseCorsOrigin("http://localhost:3000, http://localhost:5173")).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
    ]);
    expect(parseCorsOrigin("*")).toBe("*");
  });
});
