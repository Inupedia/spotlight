import { describe, expect, it } from "vitest";
import { memoryNamespace } from "../src/tools.js";

describe("memoryNamespace", () => {
  it("preserves existing safe namespace labels", () => {
    expect(memoryNamespace("ydjm-construction-map", "user-42")).toEqual([
      "ydjm-construction-map",
      "subjects",
      "user-42",
    ]);
  });

  it("escapes all LangGraph PostgreSQL namespace metacharacters", () => {
    const namespace = memoryNamespace(
      "project.v2%internal",
      "user_name@example.com\\tenant",
    );

    expect(namespace).toHaveLength(3);
    expect(namespace[0]).toMatch(/^x-[a-f0-9]+$/u);
    expect(namespace[1]).toBe("subjects");
    expect(namespace[2]).toMatch(/^x-[a-f0-9]+$/u);
    expect(namespace.every((label) => !/[.%_\\]/u.test(label))).toBe(true);
  });

  it("keeps escaped-looking raw labels distinct from encoded dotted labels", () => {
    const encodedLooking = memoryNamespace("project", "x-757365722e6e616d65");
    const dotted = memoryNamespace("project", "user.name");

    expect(encodedLooking[2]).not.toBe(dotted[2]);
  });
});
