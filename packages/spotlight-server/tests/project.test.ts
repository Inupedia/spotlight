import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProjectPack } from "../src/project.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Spotlight project video targets", () => {
  it("routes a named video target by stable ID through the resource query input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spotlight-project-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "spotlight.project.yml");

    await writeFile(
      configPath,
      "projectId: test-project\nvideoChannelsFile: ./video-channels.json\n",
      "utf8",
    );
    await writeFile(
      join(directory, "video-channels.json"),
      JSON.stringify([
        {
          id: "yls-support-portal",
          name: "二郎山隧洞1#施工支洞洞口",
          aliases: ["洞口", "支洞口"],
        },
      ]),
      "utf8",
    );

    const project = await loadProjectPack(configPath);

    expect(project.namedTargetCatalogs).toContainEqual({
      skillName: "skill.monitoring",
      toolName: "playVideoFullscreen",
      inputKey: "query",
      targets: [
        {
          id: "yls-support-portal",
          name: "二郎山隧洞1#施工支洞洞口",
          aliases: ["洞口", "支洞口"],
        },
      ],
    });
  });

  it("expands unset and empty environment variables with default values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spotlight-project-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "spotlight.project.yml");
    vi.stubEnv("KNOWLEDGE_AGENT_SLUG", "");
    vi.stubEnv("KNOWLEDGE_AGENT_MODEL", "");

    await writeFile(
      configPath,
      [
        "projectId: test-project",
        "providers:",
        "  knowledge:",
        "    type: yuxi",
        "    baseUrl: http://yuxi.test",
        "    agentApiKey: test-agent-key",
        "    agentSlug: ${KNOWLEDGE_AGENT_SLUG:-knowledge-base-qa}",
        "    agentModel: ${KNOWLEDGE_AGENT_MODEL:-siliconflow-cn:deepseek-ai/DeepSeek-V4-Flash}",
        "",
      ].join("\n"),
      "utf8",
    );

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/agents/sessions") && init?.method === "POST")
        return new Response(JSON.stringify({ id: "session-defaults" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/api/v1/agents/sessions/session-defaults/events")) {
        if (init?.method === "POST")
          return new Response(JSON.stringify({ status: "accepted" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        return new Response(
          [
            'id: tool-call\nevent: agent.session.turn.item.added\ndata: {"type":"agent.session.turn.item.added","turn_id":"turn-defaults","item":{"type":"function_call","call_id":"query-defaults","name":"query_kb","arguments":{"query":"test query"},"status":"in_progress"}}',
            'id: tool-result\nevent: agent.session.turn.item.done\ndata: {"type":"agent.session.turn.item.done","turn_id":"turn-defaults","item":{"type":"function_call_output","call_id":"query-defaults","output":[{"title":"Project knowledge"}],"status":"completed"}}',
            'id: output\nevent: agent.session.turn.output_text.delta\ndata: {"type":"agent.session.turn.output_text.delta","turn_id":"turn-defaults","delta":"ok"}',
            'id: complete\nevent: agent.session.turn.completed\ndata: {"type":"agent.session.turn.completed","turn_id":"turn-defaults","turn":{"id":"turn-defaults","status":"completed"}}',
            "",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const project = await loadProjectPack(configPath);
    const evidence = await project.knowledgeProvider?.search({
      query: "test query",
      projectId: "test-project",
      sessionId: "test-defaults",
    });
    const sessionRequest = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/api/v1/agents/sessions") &&
      init?.method === "POST",
    );

    expect(evidence?.[0]?.content).toBe("ok");
    expect(JSON.parse(String(sessionRequest?.[1]?.body))).toMatchObject({
      agent_id: "knowledge-base-qa",
      agent: { model: "siliconflow-cn:deepseek-ai/DeepSeek-V4-Flash" },
    });
  });
});
