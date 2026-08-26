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

  it("escapes periods in project and subject labels", () => {
    const namespace = memoryNamespace("project.v2", "user.name@example.com");

    expect(namespace).toHaveLength(3);
    expect(namespace[0]).toMatch(/^x_[A-Za-z0-9_-]+$/u);
    expect(namespace[1]).toBe("subjects");
    expect(namespace[2]).toMatch(/^x_[A-Za-z0-9_-]+$/u);
    expect(namespace.every((label) => !label.includes("."))).toBe(true);
  });

  it("keeps escaped-looking raw labels distinct from encoded dotted labels", () => {
    const encodedLooking = memoryNamespace("project", "x_dXNlci5uYW1l");
    const dotted = memoryNamespace("project", "user.name");

    expect(encodedLooking[2]).not.toBe(dotted[2]);
  });
});
