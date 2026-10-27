import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { structuredOutputOptionsForModel } from "../src/model.js";

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
});
