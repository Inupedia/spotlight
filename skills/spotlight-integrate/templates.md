# Templates

Use these as **shape only**. Replace names/imports with real host symbols. Never copy placeholder catalog values into a shipped integration.

## `src/spotlight/tools.ts`

```ts
import { defineClientTool } from "@inupedia/spotlight-client";
// import existing host actions/services/stores — do not invent behavior

/** 列出当前资源的名称与数量。 */
export const getItemList = defineClientTool(
  async (): Promise<unknown> => listItems(),
  {
    sideEffect: "none",
    replayPolicy: "safe",
    riskLevel: "low",
  },
);

/** 按用户给出的名称打开已有资源。 */
export const openItem = defineClientTool(
  async ({ name }: { name: string }): Promise<void> => {
    await openItemByName(name);
  },
  {
    sideEffect: "ui",
    replayPolicy: "never",
    riskLevel: "low",
  },
);

/** 对已有资源执行可逆更新。 */
export const updateItem = defineClientTool(
  async ({ id, value }: { id: string; value: number }): Promise<void> => {
    await updateExistingItem(id, value);
  },
  {
    sideEffect: "ui",
    replayPolicy: "never",
    riskLevel: "medium",
  },
);

export const spotlightTools = [getItemList, openItem, updateItem];
```

Do not add destructive/high-risk examples to the default template. Such capabilities are `GATED` until explicitly approved.

## Explicit schema override

Use only when the Vite plugin cannot safely infer a type:

```ts
/** 切换宿主已有页签。 */
export const switchMainTab = defineClientTool(
  async ({ tab }: { tab: "overview" | "detail" }): Promise<void> => {
    await setMainTab(tab);
  },
  {
    sideEffect: "ui",
    replayPolicy: "never",
    riskLevel: "low",
    schema: {
      input: {
        type: "object",
        properties: {
          tab: { type: "string", enum: ["overview", "detail"] },
        },
        required: ["tab"],
        additionalProperties: false,
      },
      output: { type: "null" },
    },
  },
);
```

Enum values come from the host store/router, never from this template.

## Explicit Tool for non-Vite builds

```ts
import { defineTool } from "@inupedia/spotlight-client";

export const openItem = defineTool({
  name: "openItem",
  description: "按用户给出的名称打开已有资源。",
  schema: {
    input: {
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
      additionalProperties: false,
    },
    output: { type: "null" },
  },
  sideEffect: "ui",
  replayPolicy: "never",
  riskLevel: "low",
  handler: async ({ name }: { name: string }) => openItemByName(name),
});
```

This path is framework/build-tool neutral. Do not migrate a non-Vite host only
to obtain automatic metadata inference.

## Dynamic Resource Provider

```ts
import { defineResourceProvider } from "@inupedia/spotlight-client";

export const itemResources = defineResourceProvider({
  namespace: "item",
  description: "宿主项目中的资源",
  search: async ({ query, limit }) => ({
    items: await itemService.search(query, limit),
  }),
  get: async (id) => itemService.getById(id),
  actions: {
    open: {
      toolName: "openItem",
      description: "按名称、别名或稳定 ID 打开一个已有资源。",
      handler: async (resource) => openItemById(resource.id),
    },
  },
});
```

Every returned item must have a stable `id` and display `name`; add `aliases`
and live `status` when the host provides them. The generated action accepts
`{ query: string }`, resolves exactly one item, then calls the handler by stable
id. Use `skill: false` when a richer hand-written domain Skill already exists.

## `src/spotlight/config.ts`

```ts
import {
  defineSpotlightConfig,
  loadBundledSkillsFromGlob,
  readSpotlightEnv,
} from "@inupedia/spotlight-vue";
import { spotlightTools } from "./tools";
import { itemResources } from "./resources";

const skills = loadBundledSkillsFromGlob(
  import.meta.glob("../../.inupedia/skills/**/SKILL.md", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
);

export default defineSpotlightConfig({
  ...readSpotlightEnv(import.meta.env, { projectId: "your-project-id" }),
  frontendBuildId: import.meta.env.VITE_BUILD_SHA,
  tools: spotlightTools,
  resources: [itemResources],
  skills,
  getUiContext: () => ({
    routePath: window.location.pathname,
    // Add only already-available selected entity / active tab / scene context.
  }),
  getMemorySubjectId: () => undefined,
});
```

Use a stable login user id when available. Return `undefined`/`null` for opaque
tokens; this disables cross-session memory while preserving thread memory. Never
hash, slice, or otherwise derive identity from rotating bearer-token bytes.

## Vite plugin

```ts
import { spotlightClientTools } from "@inupedia/spotlight-client/vite";

const frontendBuildId = process.env.GIT_SHA ?? "local-dev";

plugins: [
  spotlightClientTools({
    projectId: "your-project-id",
    frontendBuildId,
    include: "/src/spotlight/tools.ts",
  }),
  vue(),
];
```

Reuse an existing Tool path/projectId when the host already has Spotlight.

## Vue entry

```ts
import { SpotlightVue } from "@inupedia/spotlight-vue";
import "@inupedia/spotlight-vue/styles/spotlight-vue.css";
import spotlightConfig from "./spotlight/config";

app.use(SpotlightVue, { config: spotlightConfig, enabled: true });
```

## Domain Skill

```md
---
id: skill.items
name: 资源
description: 查询资源清单，打开某个已存在名称，并执行宿主已有的可逆更新。
when_to_use: 用户询问资源列表、明确要求打开某个资源、或要求更新资源字段时使用；介绍说明类问题不要使用。
allowed-tools: getItemList, openItem, updateItem
spotlight-response-strategy: tool_answer
capability-examples: 目前有哪些资源, 打开<exact host catalog name>, 把<real field>改为<real value>
tool-examples: <acceptance-critical exact utterance> => <registeredToolName>
---

# 资源

- 清单/数量 -> `getItemList`，不要打开资源。
- 打开/查看 + 具体名称 -> `openItem`，保留用户原始名称。
- 更新 -> `updateItem`，所有 required 参数必须来自用户输入或可靠 uiContext。
- 缺少名称/id/value -> 澄清，不猜。
- 介绍、解释、新闻 -> 不调用本 Skill Client Tool。
```

## Knowledge Skill (always)

```md
---
id: skill.knowledge
name: 项目知识问答
description: 回答介绍、概念、事实与公开信息；能联网搜索的不走项目知识库。不操作页面。
when_to_use: 用户问项目是什么、公开资料、新闻，或问本系统模块含义，且没有要求操作当前页面。
spotlight-response-strategy: direct_answer
capability-examples: 介绍这个项目, 最近有什么公开新闻, 这个模块是什么意思
---

# 项目知识问答

- 介绍、新闻、公开事实走联网搜索，不要调用项目知识库。
- 只有本系统模块、内部指标、未公开资料才走知识库。
- 不调用任何 Client Tool。
- 业务名词本身不是操作意图。
```

## Project Pack

`spotlight-project/spotlight.project.yml`:

```yaml
projectId: your-project-id
systemPromptFile: ./system-prompt.md
uiPromptsFile: ./ui-prompts.json

providers:
  knowledge:
    type: yuxi
    baseUrl: ${KNOWLEDGE_BASE_URL}
    apiKey: ${KNOWLEDGE_API_KEY:-}
    timeoutMs: ${KNOWLEDGE_TIMEOUT_MS:-120000}
  webSearch:
    type: hikari
    baseUrl: ${TAVILY_API_BASE}
    token: ${TAVILY_API_KEY}
```

For Docker image/package versions, follow the registry verification rules in [standard.md](standard.md); do not assume GitHub `main` equals published npm.

## Frontend env

```env
VITE_SPOTLIGHT_SERVER_URL=/spotlight-api
VITE_SPOTLIGHT_API_KEY=local-dev-key
VITE_SPOTLIGHT_PROJECT_ID=your-project-id
```
