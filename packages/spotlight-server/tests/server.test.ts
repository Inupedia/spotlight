import { readFileSync } from "node:fs";
import type { RunManager } from "../src/runManager.js";
import { buildServer, SPOTLIGHT_SERVER_VERSION } from "../src/server.js";

describe("Spotlight Server metadata", () => {
  it("reports the package version from health and host tool metadata", async () => {
    const packageVersion = (
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ) as { version: string }
    ).version;
    const app = await buildServer({
      runManager: {} as RunManager,
      projectId: "test-project",
    });

    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      const hostTools = await app.inject({
        method: "GET",
        url: "/v1/meta/host-tools",
      });

      expect(SPOTLIGHT_SERVER_VERSION).toBe(packageVersion);
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ version: packageVersion });
      expect(hostTools.statusCode).toBe(200);
      expect(hostTools.json()).toMatchObject({ version: packageVersion });
    } finally {
      await app.close();
    }
  });

  it("negotiates Tool and Skill readiness before a Turn starts", async () => {
    const app = await buildServer({
      runManager: {
        listServerToolNames: () => ["project_knowledge_search"],
      } as unknown as RunManager,
      projectId: "test-project",
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/initialize",
        payload: {
          protocolVersion: "spotlight.app/1",
          projectId: "test-project",
          clientInfo: { name: "test", version: "1" },
          capabilities: {
            transports: ["sse"],
            itemTypes: ["tool_call"],
            toolResultSubmission: true,
            reconnectFromSequence: true,
          },
          toolManifest: {
            protocolVersion: "spotlight.capabilities/1",
            projectId: "test-project",
            frontendBuildId: "sha",
            manifestDigest: "digest",
            tools: [{
              name: "panel.openVideo",
              version: "1",
              description: "打开视频",
              inputSchema: { type: "object" },
              sideEffect: "ui",
              replayPolicy: "never",
            }],
          },
          skills: [
            {
              name: "video",
              description: "视频监控",
              dependencies: { tools: ["panel.openVideo"] },
            },
            {
              name: "broken",
              description: "缺失依赖",
              dependencies: { tools: ["panel.notRegistered"] },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        protocolVersion: "spotlight.app/1",
        acceptedManifestDigest: "digest",
        tools: [{ name: "panel.openVideo", status: "ready" }],
        skills: [
          { name: "video", status: "ready", missingTools: [] },
          { name: "broken", status: "missing", missingTools: ["panel.notRegistered"] },
        ],
      });
    } finally {
      await app.close();
    }
  });
});
