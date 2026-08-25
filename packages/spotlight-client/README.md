# @inupedia/spotlight-client

Spotlight 的浏览器 Tool SDK。业务项目只注册 Tools / Skills，然后调用 `thread.run()`；Tool 名称、说明、JSON Schema、manifest digest、Capability Session、SSE 重连和 Tool 结果回传都由 SDK 处理。

```ts
import { defineClientTool } from "@inupedia/spotlight-client";

/** 按名称全屏播放指定监控视频。 */
export const playVideoFullscreen = defineClientTool(
  async ({ name }: { name: string }): Promise<void> => {
    await videoService.playFullscreen(name);
  },
);

const client = createSpotlightAppClient({
  serverUrl: "/spotlight-api",
  projectId: "my-project",
  frontendBuildId: import.meta.env.VITE_BUILD_SHA,
  tools: [playVideoFullscreen],
  skills: [videoMonitoringSkill],
});

const thread = client.thread();
const result = await thread.run("看看泸定取水口");
console.log(result.finalResponse);
```

Vite 项目必须启用构建插件：

```ts
import { spotlightClientTools } from "@inupedia/spotlight-client/vite";

spotlightClientTools({
  projectId: "my-project",
  frontendBuildId: process.env.GIT_SHA,
});
```

生产构建会输出 `spotlight-client-manifest.json`。首次初始化后 Server 保存不可变 Capability Snapshot，后续 Turn 不再重复上传整份 Tools / Skills。

完整接入、显式 Schema 和生产部署见 [Client Tool 接入指南](../../docs/client-tools.md)。

Node-only 的 Skill 脚本执行器仍从 `@inupedia/spotlight-client/node` 导入。主入口不包含 Node API。
