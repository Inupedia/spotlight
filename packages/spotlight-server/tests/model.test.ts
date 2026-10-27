import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import {
  createRouterModel,
  structuredOutputOptionsForModel,
} from "../src/model.js";

describe("structuredOutputOptionsForModel", () => {
  it("uses function calling for DeepSeek Chat Completions models", () => {
    const model = new ChatOpenAI({ apiKey: "test-key", model: "deepseek-flash" });

    expect(structuredOutputOptionsForModel(model)).toEqual({
      method: "functionCalling",
    });
  });

  it("keeps the provider default for other models", () => {
    const model = new ChatOpenAI({ apiKey: "test-key", model: "gpt-4.1-mini" });

    expect(structuredOutputOptionsForModel(model)).toEqual({});
  });

  it("disables DeepSeek thinking on the router for forced structured tool calls", () => {
    const model = createRouterModel({
      apiKey: "test-key",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-flash",
    });

    expect(model.modelKwargs).toEqual({ thinking: { type: "disabled" } });
  });

  it("leaves non-DeepSeek router model settings unchanged", () => {
    const model = createRouterModel({
      apiKey: "test-key",
      baseURL: "https://api.siliconflow.cn/v1",
      model: "Qwen/Qwen3-32B",
    });

    expect(model.modelKwargs).toEqual({});
  });
});
