import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClientToolManifest,
  createClientToolRegistry,
  defineClientTool,
  defineTool,
} from "../src/clientTool.js";

const schema = {
  input: {
    type: "object",
    properties: { videoId: { type: "string" } },
    required: ["videoId"],
    additionalProperties: false,
  },
  output: { type: "string" },
};

describe("client tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers and executes a build-described browser tool", async () => {
    const openVideo = defineClientTool(
      async ({ videoId }: { videoId: string }) => `opened:${videoId}`,
      { name: "openVideo", description: "Open a video", schema },
    );
    const registry = createClientToolRegistry([openVideo]);
    expect(registry.descriptors[0]?.name).toBe("openVideo");
    await expect(
      registry.execute("openVideo", { videoId: "camera-1" }),
    ).resolves.toBe("opened:camera-1");
  });

  it("defines a Tool without Vite build transformation", async () => {
    const tool = defineTool({
      name: "openVideoExplicit",
      description: "Open a video without build-time metadata",
      schema,
      handler: async ({ videoId }: { videoId: string }) => videoId,
    });
    await expect(
      createClientToolRegistry([tool]).execute("openVideoExplicit", {
        videoId: "v13",
      }),
    ).resolves.toBe("v13");
  });

  it("derives a tier from the legacy descriptor fields", () => {
    const readTool = defineClientTool(
      async ({ videoId }: { videoId: string }) => videoId,
      {
        name: "readVideo",
        description: "Read video state",
        schema,
        sideEffect: "none",
        replayPolicy: "safe",
      },
    );
    const uiTool = defineClientTool(
      async ({ videoId }: { videoId: string }) => videoId,
      { name: "openVideo", description: "Open a video", schema },
    );
    const registry = createClientToolRegistry([readTool, uiTool]);

    expect(registry.descriptors.map((tool) => tool.tier)).toEqual([
      "query",
      "navigate",
    ]);
  });

  it("refuses to register a tool the runtime could not safely re-dispatch", () => {
    const submit = defineClientTool(
      async ({ videoId }: { videoId: string }) => videoId,
      {
        name: "submitPurchaseOrder",
        description: "Submit a purchase order",
        schema,
        tier: "mutate",
      },
    );

    expect(() => createClientToolRegistry([submit])).toThrow(
      /submitPurchaseOrder/u,
    );
  });

  it("builds a deterministic build-pinned manifest", async () => {
    const tool = defineClientTool(async () => undefined, {
      name: "closePanel",
      description: "Close panel",
      schema: {
        input: { type: "object", properties: {}, additionalProperties: false },
        output: { type: "null" },
      },
    });
    const first = await createClientToolManifest({
      projectId: "ydjm",
      frontendBuildId: "build-1",
      tools: [tool],
    });
    const second = await createClientToolManifest({
      projectId: "ydjm",
      frontendBuildId: "build-1",
      tools: [tool],
    });
    expect(first.manifestDigest).toMatch(/^sha256:/);
    expect(second.manifestDigest).toBe(first.manifestDigest);
    expect(JSON.parse(JSON.stringify(first)).manifestDigest).toBe(
      first.manifestDigest,
    );
  });

  it("builds the same manifest without Web Crypto on an insecure HTTP origin", async () => {
    const tool = defineClientTool(async () => undefined, {
      name: "closePanel",
      description: "Close panel",
      schema: {
        input: { type: "object", properties: {}, additionalProperties: false },
        output: { type: "null" },
      },
    });
    const options = {
      projectId: "ydjm",
      frontendBuildId: "build-http",
      tools: [tool],
    } as const;
    const expected = await createClientToolManifest(options);

    vi.stubGlobal("crypto", {});
    const actual = await createClientToolManifest(options);

    expect(actual.manifestDigest).toBe(expected.manifestDigest);
  });
});
