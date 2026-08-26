import { describe, expect, it } from "vitest";
import { validateJsonSchemaValue } from "../src/jsonSchema.js";

describe("JSON Schema runtime validation", () => {
  const targetSchema = {
    type: "object",
    properties: {
      videoChannelId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
    },
    oneOf: [{ required: ["videoChannelId"] }, { required: ["name"] }],
    additionalProperties: false,
  };

  it("rejects an object that satisfies neither branch", () => {
    expect(validateJsonSchemaValue({}, targetSchema).valid).toBe(false);
  });

  it("accepts exactly one concrete target", () => {
    expect(
      validateJsonSchemaValue({ name: "钢筋棚" }, targetSchema).valid,
    ).toBe(true);
  });

  it("rejects undeclared properties", () => {
    expect(
      validateJsonSchemaValue({ name: "钢筋棚", bogus: true }, targetSchema)
        .valid,
    ).toBe(false);
  });
});
