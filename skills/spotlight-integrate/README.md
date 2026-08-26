# Spotlight Integrate

把现有前端升级成 **Agent-ready Spotlight 应用**：编码 Agent 读取本 Skill Pack，分析宿主真实业务能力，把它们包装成 Client Tools + Resource Providers + Agent Skills，再接入 0.9.x 的 initialize/thread/turn/SSE/host-result 生命周期与可量化验收。Vue 3 有现成视觉适配器；其他 JS/TS 宿主仍可完成 Core Agentization。

核心原则：**宿主业务代码是唯一事实源，Spotlight 是 Agent 化适配层，不是第二套业务系统，也不是 DOM 点击机器人。**

完整架构先看 [architecture.md](architecture.md)。

## 它到底做什么

```text
现有 Vue 应用
Store / Service / Router / 页面引擎
        ↓
spotlight-integrate（开发阶段 Coding Agent）
        ↓
Client Tools + Resource Providers + Skills + uiContext + Project Pack
        ↓
Spotlight Server + LLM（运行阶段 Runtime Agent）
        ↓
用户自然语言调用原有业务能力
```

因此，“只靠这个 Skill”指的是：**开发 Agent 可以按本目录说明完成 Agent 化改造**；最终运行仍需要 Spotlight SDK、Spotlight Server 和目标 LLM。

## 两种使用方式

### A. 安装成 Agent Skill

复制整个目录：

```text
~/.cursor/skills/spotlight-integrate/
<app>/.cursor/skills/spotlight-integrate/
<app>/.codex/skills/spotlight-integrate/
<app>/.claude/skills/spotlight-integrate/
```

然后在宿主仓库中说：

```text
Use spotlight-integrate. Agentize this app with Spotlight. Follow architecture.md and standard.md.
```

### B. 粘贴给任意 LLM

```bash
./prompt.sh
./prompt.sh --copy
./prompt.sh -o /tmp/spotlight-integrate.prompt.md
./prompt.sh --check
```

`prompt.sh` 会把完整 pack 按固定顺序展开；缺文件会直接失败。

## 新的 Agentization 流程

| Stage | 目的                                      | 主要输出                                   |
| ----- | ----------------------------------------- | ------------------------------------------ |
| 0     | 兼容性预检 + 前端能力地图                 | `COMPATIBILITY.md`, `FRONTEND_OVERVIEW.md` |
| 1     | 从 Router/Store/Service/UI 中抽取候选能力 | `candidates/*`                             |
| 1.5   | 验证并分类                                | `DIRECT / REFACTOR / GATED / REJECT`       |
| 2     | 生成薄 Tool / Resource 适配器             | `src/spotlight/tools.ts`, `resources.ts`   |
| 3     | 按业务域生成 Skills                       | `.inupedia/skills/**/SKILL.md`             |
| 4     | Gold prompts + 压测设计                   | `gold-questions.md` / benchmark            |
| 5     | Core/可选 UI/Server Project Pack 接线     | config / env / project pack                |
| 6     | 输出可验收结果                            | `INTEGRATION_REPORT.md`                    |

## 四类能力

- `DIRECT`：已有稳定导出、可说、可安全暴露 → 直接包 Tool。
- `REFACTOR`：真实能力存在，但逻辑困在组件内部 → 允许时先做行为不变的抽取。
- `GATED`：删除、支付、提交订单、转账、wipe 等高风险动作 → 默认不自动暴露。
- `REJECT`：虚构能力、渲染内部函数、任意方法/DOM/脚本执行器 → 永不暴露。

这样最终“没做成 Tool”的能力也有明确原因，不再简单算作完成度不足。

## 兼容性

兼容性分两轴：Core Agentization 与 UI Adapter。任意能打包 JS/TS 的浏览器宿主都可用显式 `defineTool` 注册 Tool；Vite 只是额外提供自动推导。Vue 3 + 兼容 peer 可直接装视觉壳，React/其他框架标记 `ADAPTER_REQUIRED`，并不等于 Agent 化失败。只有宿主无法执行 Core Client 时才标记 `BUILD_MIGRATION_REQUIRED`。

Spotlight npm 包版本必须从 **registry** 验证；不要假设 GitHub `main` 与 npm 已发布版本一致。

## 宿主生成结构

```text
<app>/
├── src/spotlight/
│   ├── config.ts
│   ├── tools.ts
│   └── resources.ts             # 大型/动态实体目录才需要
├── .inupedia/skills/
│   ├── skill.knowledge/SKILL.md
│   └── skill.<domain>/SKILL.md
├── spotlight-project/
│   ├── spotlight.project.yml
│   ├── system-prompt.md
│   ├── ui-prompts.json
│   └── .env.example
└── .spotlight-integrate/
    ├── COMPATIBILITY.md
    ├── FRONTEND_OVERVIEW.md
    ├── verified.md
    ├── leftovers.md
    ├── gold-questions.md
    ├── benchmark-results.md       # live benchmark 才有
    └── INTEGRATION_REPORT.md
```

旧项目已有 Spotlight 路径时，**原地扩展，不为了对齐模板搬家**。

## 为什么不做 DOM 自动化

Spotlight 推荐：

```text
自然语言 → Skill → Client Tool → 原 Store/Service/Router
```

而不是：

```text
自然语言 → CSS Selector → 模拟鼠标点击
```

前者复用原业务约束、类型、状态和测试，稳定性更高；只有没有稳定业务入口时才把组件逻辑列为 `REFACTOR`。

## Router 边界

通用 Spotlight Server **不能写死产品语义**。业务 Skill id、商品名、BIM 名称、监控工具名等都应留在宿主 Skill / Tool / Resource Provider / uiContext 中。摄像头、资产、工单等大型动态目录由 Resource Provider 在运行时搜索、取状态并解析稳定 ID，不再塞进 Server Project Pack 或 LLM 提示词。

Server 只处理通用语义：read/list、named open/view、mutation、clarify 等。

## 测试不是一件事

静态检查只能证明“接线一致”，不能证明 LLM 准确率。最终报告分别给出：

- Route Accuracy
- Skill Accuracy
- Tool Accuracy
- Argument Accuracy
- E2E Success Rate
- Clarification Accuracy
- Unsafe Execution Rate

没有真实 Spotlight Server + 目标模型运行时，必须写：`LIVE BENCHMARK: NOT RUN`。

生产级建议使用 **100+ Gold Prompts**；简单接入先做 8–20 条 smoke set。详见 [testing.md](testing.md)。

## 环境与启动

前端：

```env
VITE_SPOTLIGHT_PROJECT_ID=<projectId>
VITE_SPOTLIGHT_SERVER_URL=/spotlight-api
VITE_SPOTLIGHT_API_KEY=local-dev-key
```

Server Provider key 不得放进 `VITE_*`。

标准启动：

```bash
cd spotlight-project && docker compose up -d
curl -sfS http://127.0.0.1:8787/health
# 再启动宿主应用，运行 gold prompts
```

发布前还要验证 `/v1/initialize`、thread/turn、SSE、host Tool 回执与 UI 状态变化，并对 dev/prod 代表性问题各重复至少 3 次。Server-only 发布只重建 Server 服务，数据库卷不动，健康失败回滚旧镜像。

完整约定：[standard.md](standard.md)。Skill 入口：[SKILL.md](SKILL.md)。测试：[testing.md](testing.md)。

## 本目录

```text
spotlight-integrate/
├── README.md
├── SKILL.md
├── architecture.md
├── standard.md
├── testing.md
├── prompt.sh
├── templates.md
├── examples.md
├── methodology/              # stage 0 -> 6
└── extractors/
```

手工接入仍可参考仓库 `docs/client-tools.md` 与 `docs/server-deployment.md`。本 Skill 只是把“从现有前端蒸馏出这套适配层”的方法标准化、自动化和可验收化。
