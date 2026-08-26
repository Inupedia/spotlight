# Spotlight Resource Provider 接入指南

Resource Provider 用于摄像头、资产、工单、书籍、BIM 构件等大型或动态
实体目录。它把实体发现与页面动作分开：Skill 描述何时使用，Resource
Provider 负责搜索、别名、状态和稳定 ID，Tool action 只调用宿主已有能力。

## 最小接入

```ts
import { defineResourceProvider } from "@inupedia/spotlight-client";

export const videoResources = defineResourceProvider({
  namespace: "video",
  description: "视频监控通道",
  search: async ({ query, limit, cursor, filters }) =>
    videoService.search({ query, limit, cursor, filters }),
  get: async (id) => videoService.getById(id),
  actions: {
    playFullscreen: {
      toolName: "playVideoFullscreen",
      description: "按名称、别名或稳定 ID 全屏播放一个视频通道。",
      handler: async (video) => videoService.playFullscreenById(video.id),
    },
  },
});
```

每个资源至少返回：

```ts
{
  id: "stable-id",
  name: "display name",
  aliases: ["optional alias"],
  status: "online" // online | offline | unknown
}
```

然后注册到应用：

```ts
defineSpotlightConfig({
  // serverUrl / projectId / frontendBuildId ...
  tools: ordinaryTools,
  resources: [videoResources],
  skills,
});
```

Provider 自动生成：

- `video_search`：延迟加载的发现/状态查询 Tool；`query` 可省略以列出全部；
- `video_get`：按稳定 ID 获取单个资源；
- `playVideoFullscreen`：接收 `{ query: string }`，解析唯一资源后执行动作。

## 为什么 action 接收 query，而不是让模型直接给 id

用户知道的是“钢筋棚加工区 2”，系统事实源知道的是稳定 ID。模型不应猜
ID，也不应在 Prompt 里背一万个通道。SDK 把用户原始 `query` 交给 Provider：

1. 先尝试稳定 ID；
2. 再按名称、别名和 Resource search 结果匹配；
3. 没有结果或存在并列匹配时拒绝执行；
4. 唯一命中后才把稳定 ID 交给宿主动作。

## Skill 写法

已有领域 Skill 时，Provider 设置 `skill: false`，并在 Skill 中声明生成的
Tool dependencies：

```yaml
dependencies:
  tools:
    - type: browser
      value: video_search
    - type: browser
      value: video_get
    - type: browser
      value: playVideoFullscreen
```

Skill 只写流程：列出/在线状态走 `video_search`，点名播放走
`playVideoFullscreen`，并把用户原始名称放入 `query`。不要在 Skill 中复制
目录，也不要使用 Server named-target catalog。

## 运行时边界

- input 和声明的 output 会按 JSON Schema 校验；失败不会调用宿主动作。
- 普通返回值会被 SDK 标准化为 Tool Result envelope，UI 仍展示稳定的
  Skill、Tool、参数、摘要和错误。
- `search` / `get` 默认 `deferLoading`，不会把整个目录塞入常驻 Action
  Tool 面。
- Provider 必须继续调用宿主已有 Service/Store/API，不能复制权限与业务
  逻辑；动作执行时宿主仍需重新校验权限和实时状态。
- Vite 构建插件会扫描 `defineResourceProvider` 的静态 namespace、description
  和 actions，把生成的 Resource Tools 同步写入生产 Manifest；`include` 必须
  覆盖 Resource Provider 文件，构建清单与运行时 Tool 数量必须一致。

## 验收清单

- exact id、exact name、alias 均能命中同一稳定资源；
- 模糊查询返回候选，不擅自执行并列结果；
- 缺失、离线或无权限资源不会执行 action；
- 在线状态来自运行时事实源，不依赖构建期静态 JSON；
- 目录规模增长时 Manifest/Skill 大小基本不随实体数量线性增长；
- dev/prod 使用同一 SDK、Project Pack、模型与 frontend build 进行重复验证。
