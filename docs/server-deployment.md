# Spotlight Server 0.7.0 部署与 Project Pack

## 结论

通用 Agent 只维护在 `inupedia-spotlight`：

- `@inupedia/spotlight-server` 提供 LangGraph 路由、Knowledge Agent、Action Agent、Memory、SSE 与浏览器 Tool RPC。
- 业务项目只保留 `spotlight.project.yml`、提示词、UI 元数据，以及真正项目专属的可选 Server Tool。
- GIS、视频播放器、Cesium、页面 Store 等动作留在前端，使用 `defineClientTool` 注册。

## 最小部署

```yaml
services:
  spotlight-server:
    image: ghcr.io/inupedia/spotlight-server:0.7.0
    ports: ["8787:8787"]
    env_file: .env
    environment:
      SPOTLIGHT_PROJECT_CONFIG: /project/spotlight.project.yml
      SPOTLIGHT_DATABASE_URL: postgresql://spotlight:password@postgres:5432/spotlight
    volumes:
      - ./spotlight-project:/project:ro
```

生产环境使用 Postgres：LangGraph Checkpointer 保存会话状态，LangGraph Store 保存受控长期记忆。未配置 `SPOTLIGHT_DATABASE_URL` 时使用进程内 Memory，仅适合测试。

短期 Memory 按 `projectId + sessionId` 隔离。长期 Memory 还要求浏览器提供稳定、已认证的 `memorySubjectId`；没有该值时 Server 会拒绝“记住”请求，绝不会退化成项目级共享记忆。Router 始终只读取本轮问题，历史消息与长期记忆只进入 Knowledge Agent。

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

浏览器还可以随每个 Run 注册项目业务 Skill。Server 会限制 Skill 数量和正文大小，并把 `allowed-tools` 绑定到该浏览器构建上报的 Tool Manifest；Skill 只提供流程语义，不增加执行权限。能力说明也从当前 Run 的 Skills / Tools 动态生成，不进入长期 Memory。

## 自定义 Server Tool

仅数据库、第三方 API、企业通用能力等适合放到 Server。配置增加：

```yaml
module: ./server-tools.mjs
```

模块导出 `serverTools`：

```js
export const serverTools = [{
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
}];
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
```

也支持 `SPOTLIGHT_LLM_PROVIDER=qwen` 配合 `QWEN_API_KEY / QWEN_API_BASE / QWEN_MODEL`。Router 可通过 `SPOTLIGHT_ROUTER_*` 使用独立模型，温度固定为 0。

## 验收

```bash
curl http://127.0.0.1:8787/health
```

响应必须包含：

```json
{
  "ok": true,
  "runtime": "langchain-langgraph",
  "projectId": "video-console"
}
```
