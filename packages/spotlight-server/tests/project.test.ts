import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectPack } from "../src/project.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
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
});
