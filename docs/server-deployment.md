# Spotlight Server 0.8.5 部署与 Project Pack

## 结论

通用 Agent 只维护在 `inupedia-spotlight`：

- `@inupedia/spotlight-server` 提供 LangGraph 路由、Knowledge Agent、Action Agent、显式长期记忆、SSE 与浏览器 Tool RPC。
- 业务项目只保留 `spotlight.project.yml`、提示词、UI 元数据，以及真正项目专属的可选 Server Tool。
- GIS、视频播放器、Cesium、页面 Store 等动作留在前端，使用 `defineClientTool` 注册。

## 最小部署

```yaml
services:
  spotlight-server:
    image: ghcr.io/inupedia/spotlight-server:0.8.5
    ports: ["8787:8787"]
    env_file: .env
    environment:
      SPOTLIGHT_PROJECT_CONFIG: /project/spotlight.project.yml
      SPOTLIGHT_DATABASE_URL: postgresql://spotlight:password@postgres:5432/spotlight
      SPOTLIGHT_STATE_DIR: /data/spotlight-state
    volumes:
      - ./spotlight-project:/project:ro
      - spotlight-state:/data/spotlight-state
```

生产环境使用 Postgres：LangGraph Checkpointer 保存图执行状态，LangGraph Store 保存受控长期记忆。`SPOTLIGHT_STATE_DIR` 另行保存产品级 Capability Session、Thread、Turn、事件重放与 fork；这两类状态不能混用。未配置 `SPOTLIGHT_DATABASE_URL` 时使用进程内 Memory，仅适合测试。

短期 Memory 按 `projectId + sessionId` 隔离。长期 Memory 还要求浏览器提供稳定、已认证的 `memorySubjectId`；没有该值时 Server 会拒绝“记住”请求，绝不会退化成项目级共享记忆。Router 始终只读取本轮问题；长期记忆在路由之后读取，只作为有界上下文进入后续 Agent，不会替代知识检索、当前证据、Tool 选择、权限检查或必填参数。Server 不会自动保存或语义回放完整回答。

## Project 配置

```yaml
projectId: video-console
systemPromptFile: ./system-prompt.md
uiPromptsFile: ./ui-prompts.json

providers:
  knowledge:
    type: yuxi
    baseUrl: ${KNOWLEDGE_BASE_URL}
    apiKey: ${KNOWLEDGE_API_KEY:-}
    username: ${KNOWLEDGE_AUTH_USERNAME:-}
    password: ${KNOWLEDGE_AUTH_PASSWORD:-}
  webSearch:
    type: hikari
    baseUrl: ${TAVILY_API_BASE}
    token: ${TAVILY_API_KEY}
```

Agent 只看见稳定的逻辑 Tool：

- `project_knowledge_search`：当前配置可用 Yuxi。仅当问题是本系统/未公开资料时调用；公开介绍与新闻走 `web_search`，二者不会并行。
- `web_search`：当前可用 Hikari。知识问答默认走这里，避免 Yuxi 拖慢能公开检索的问题。

浏览器在 `initialize` 时一次注册项目业务 Skill。Server 会把完整 Skill 和 Tool Manifest 固化为 Capability Session；后续 Turn 只携带 Session ID。Skill 只提供流程语义，不增加执行权限。

Project module 可以注册新的知识库或联网搜索 Provider，不需要修改 Spotlight 核心。例如把 Yuxi 换成 RAGFlow：

```js
export function registerProviders(registry) {
  registry.registerKnowledge(
    "ragflow",
    (config) => new RagflowProvider(config),
  );
}
```

配置随后只需写 `providers.knowledge.type: ragflow`。LangChain `StructuredTool` 可通过 `adaptLangChainTool()` 直接转换成 Spotlight Server Tool。

## 自定义 Server Tool

仅数据库、第三方 API、企业通用能力等适合放到 Server。配置增加：

```yaml
module: ./server-tools.mjs
```

模块导出 `serverTools`：

```js
export const serverTools = [
  {
    name: "query_project_weather",
    description: "查询项目现场天气",
    schema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: ["date"],
      additionalProperties: false,
    },
    metadata: {
      domain: "project",
      effect: "read",
      risk: "low",
    },
    async invoke({ date }) {
      return projectWeatherApi.query(date);
    },
  },
];
```

`domain / effect / risk` 缺失会导致 Server 启动失败。信息路径只加载 `effect: read` 的 Server Tool；Client Tool 只进入 Action Agent。

## 必需环境变量

```dotenv
SPOTLIGHT_PROJECT_CONFIG=/project/spotlight.project.yml
SPOTLIGHT_API_KEYS=replace-me
SPOTLIGHT_LLM_API_KEY=replace-me
SPOTLIGHT_LLM_BASE_URL=https://api.openai.com/v1
SPOTLIGHT_LLM_MODEL=gpt-4.1-mini
SPOTLIGHT_DATABASE_URL=postgresql://spotlight:password@postgres:5432/spotlight
SPOTLIGHT_STATE_DIR=/data/spotlight-state
```

也支持 `SPOTLIGHT_LLM_PROVIDER=qwen` 配合 `QWEN_API_KEY / QWEN_API_BASE / QWEN_MODEL`。Router 可通过 `SPOTLIGHT_ROUTER_*` 使用独立模型，温度固定为 0。

## 验收

```bash
curl http://127.0.0.1:8787/health
curl -H 'Authorization: Bearer replace-me' http://127.0.0.1:8787/v1/diagnostics
```

响应必须包含：

```json
{
  "ok": true,
  "runtime": "langchain-langgraph",
  "projectId": "video-console"
}
```
