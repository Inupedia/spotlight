import { describe, expect, it, vi } from "vitest";
import { defineResourceProvider } from "../src/resourceProvider.js";
import { createClientToolRegistry } from "../src/clientTool.js";

describe("resource providers", () => {
  it("generates searchable namespaced tools and resolves aliases before actions", async () => {
    const play = vi.fn();
    const provider = defineResourceProvider({
      namespace: "video",
      description: "video channels",
      async search() {
        return {
          items: [
            {
              namespace: "video",
              id: "v6",
              name: "钢筋棚加工区",
              aliases: ["钢筋棚加工区2"],
              status: "online" as const,
            },
          ],
        };
      },
      actions: {
        play: {
          toolName: "playVideoFullscreen",
          description: "Play a named video channel",
          handler: play,
        },
      },
    });
    const registry = createClientToolRegistry(provider.tools);
    expect(registry.descriptors.map((tool) => tool.namespace)).toEqual([
      "video",
      "video",
    ]);
    expect(registry.descriptors[0]?.deferLoading).toBe(true);
    expect(registry.descriptors[0]?.inputSchema.required).toBeUndefined();
    await expect(registry.execute("video_search", {})).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "v6" })],
    });
    await registry.execute("playVideoFullscreen", { query: "钢筋棚加工区2" });
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ id: "v6" }));
    expect(provider.skill?.allowedTools).toContain("playVideoFullscreen");
  });

  it("returns a structured input error before invoking a handler", async () => {
    const provider = defineResourceProvider({
      namespace: "video",
      description: "video channels",
      async search() {
        return { items: [] };
      },
      actions: {
        play: { description: "Play video", handler: vi.fn() },
      },
    });
    const registry = createClientToolRegistry(provider.tools);
    const result = await registry.executeResult("video_play", {});
    expect(result).toMatchObject({
      success: false,
      error: { code: "TOOL_INPUT_INVALID" },
    });
  });
});
