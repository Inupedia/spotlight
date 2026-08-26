# Inupedia Spotlight SDK packages

| Package | npm name | Role |
| --- | --- | --- |
| `spotlight-protocol` | `@inupedia/spotlight-protocol` | Client、Server 共享协议 |
| `spotlight-client` | `@inupedia/spotlight-client` | Client Tool、HTTP 与构建清单 |
| `spotlight-vue` | `@inupedia/spotlight-vue` | Vue Plugin、UI Shell 与远程执行管线 |
| `spotlight-memory` | `@inupedia/spotlight-memory` | 可选的旧版答案缓存原语；Spotlight Server Agent 主链路不再使用 |

## 最小接入

```ts
/** 打开指定视频。 */
export const openVideo = defineClientTool(
  async ({ videoId }: { videoId: string }): Promise<void> => {
    await videoService.open(videoId);
  },
);

export const spotlightConfig = defineSpotlightConfig({
  serverUrl: "/spotlight-api",
  projectId: "my-project",
  frontendBuildId: import.meta.env.VITE_BUILD_SHA,
  tools: [openVideo],
});
```

非 Vue 项目可以直接使用统一入口：

```ts
const client = createSpotlightAppClient({
  serverUrl: "/spotlight-api",
  projectId: "my-project",
  tools: [openVideo],
  skills: [videoSkill],
});

const thread = client.thread();
const answer = await thread.run("打开 1 号视频");
```

构建期自动推导导出名、JSDoc 和 TypeScript 类型。前端不需要了解 LangChain；Server 将可信清单转换为 LangChain Tool，并用 LangGraph 编排关键多步工作流。

完整说明见 [Client Tool 接入指南](../docs/client-tools.md)。

## 构建与发布

```bash
pnpm install
pnpm test
pnpm build
```

发布前必须从本仓库构建，CI 会校验所有 package export。Node-only 能力必须留在 `/node` 子入口，不能进入浏览器主入口。
