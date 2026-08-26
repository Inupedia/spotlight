# Spotlight host-app standard

This file is the **single contract** for compatibility, install, directory layout, naming, env, and boot. Do not copy another product's folders, tool names, or catalog strings.

## 1. Install this Agent Skill (human, once)

Copy the **entire** `spotlight-integrate/` directory, not only `SKILL.md`.

| Agent                | Path                                        |
| -------------------- | ------------------------------------------- |
| Cursor, this machine | `~/.cursor/skills/spotlight-integrate/`     |
| Cursor, this repo    | `<app>/.cursor/skills/spotlight-integrate/` |
| Codex                | `<app>/.codex/skills/spotlight-integrate/`  |
| Claude Code          | `<app>/.claude/skills/spotlight-integrate/` |

Then in the host frontend chat:

```
Use spotlight-integrate. Follow architecture.md and standard.md. Agentize this app with Spotlight.
```

Or use `./prompt.sh --copy` and paste the generated pack into an LLM that already has the host repo open.

## 2. Compatibility preflight (before coding)

Read `package.json`, lockfiles, Node engine, build system, frontend framework, and existing Spotlight dependencies. Write `.spotlight-integrate/COMPATIBILITY.md`.

Compatibility is **two-axis**: Core Agentization and visual UI adapter.

### Core classification

| Status                     | Condition                                                                                 | Action                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `READY`                    | Browser JS/TS host can register framework-neutral Client Tools and reach Spotlight Server | continue core pipeline                                             |
| `UPGRADE_REQUIRED`         | Core package/build/Node ranges are incompatible                                           | report exact mismatch; do not force upgrade                        |
| `BUILD_MIGRATION_REQUIRED` | Current build cannot support the Tool compiler/runtime path without migration             | analyze capabilities; stop before build migration unless requested |
| `UNSUPPORTED_AUTOMATION`   | No viable browser Tool integration path exists                                            | readiness report only                                              |

### UI adapter classification

| Status             | Condition                                                   | Action                                                             |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `VUE_READY`        | Vue 3 host satisfies `@inupedia/spotlight-vue` peer ranges  | embed Vue command UI/runtime                                       |
| `UPGRADE_REQUIRED` | Vue host exists but Vue/Pinia/Node peers are incompatible   | continue core when possible; do not force upgrade                  |
| `ADAPTER_REQUIRED` | React/other framework host has no shipped visual adapter    | continue core + headless Server benchmark; report visual-shell gap |
| `HEADLESS_ONLY`    | Product intentionally does not embed a visual command shell | continue core/runtime benchmark only                               |

A missing visual adapter is **not** the same as unsupported Core Agentization.

### Registry version check

Use the registry as the install source of truth:

```bash
npm view @inupedia/spotlight-vue version peerDependencies --json
npm view @inupedia/spotlight-client version peerDependencies --json
npm view @inupedia/spotlight-protocol version --json
```

All installed `@inupedia/spotlight-*` packages must resolve to one compatible version. Do not assume GitHub `main` equals the latest published npm version. If registry lookup is unavailable, mark version verification `BLOCKED` instead of guessing.

### Package manager

Preserve the host package manager:

- `pnpm-lock.yaml` -> pnpm
- `yarn.lock` -> yarn
- `package-lock.json` -> npm
- no lockfile -> use the package manager declared by `packageManager`, otherwise ask only if installation is required

Do not add a second lockfile.

## 3. Host app directory structure (generated)

```text
<app>/
├── package.json
├── <build config>
├── .env.example
├── .inupedia/
│   └── skills/
│       ├── skill.knowledge/SKILL.md
│       └── skill.<domain>/SKILL.md
├── src/
│   ├── <app entry>
│   └── spotlight/
│       ├── config.ts
│       ├── tools.ts
│       └── actions/                    # optional behavior-preserving extractions
├── spotlight-project/
│   ├── spotlight.project.yml
│   ├── system-prompt.md
│   ├── ui-prompts.json
│   ├── .env.example
│   └── docker-compose.yml
└── .spotlight-integrate/
    ├── PIPELINE_STATE.md
    ├── COMPATIBILITY.md
    ├── FRONTEND_OVERVIEW.md
    ├── candidates/
    ├── rejected/
    ├── verified.md
    ├── leftovers.md
    ├── gold-questions.md
    ├── benchmark-results.md            # only when live benchmark ran
    └── INTEGRATION_REPORT.md
```

If the host already has tools or `defineSpotlightConfig` elsewhere, reuse those paths and point the Tool compiler at the existing tools module. Never create a second tools entrypoint or `projectId`.

## 4. Naming

| Thing        | Rule                                                     | Shape-only example                      |
| ------------ | -------------------------------------------------------- | --------------------------------------- |
| `projectId`  | kebab-case; identical in Tool compiler, config, yml, env | `media-console`                         |
| Client Tool  | camelCase, verb-first export                             | `getItemList`, `openItem`, `addItem`    |
| Skill id     | `skill.` + dotted domain                                 | `skill.items`                           |
| Skill folder | equals id                                                | `.inupedia/skills/skill.items/SKILL.md` |
| npm packages | exact same published version                             | `0.x.y`                                 |

Read names, route titles, and button labels from **this** host repo.

## 5. Install SDK into a compatible host (stage 5)

### Core packages

Use the host package manager and exact verified version `<ver>`.

```bash
# pnpm
pnpm add @inupedia/spotlight-client@<ver> @inupedia/spotlight-protocol@<ver>

# npm
npm install @inupedia/spotlight-client@<ver> @inupedia/spotlight-protocol@<ver>

# yarn
yarn add @inupedia/spotlight-client@<ver> @inupedia/spotlight-protocol@<ver>
```

For a Vite host, the framework-neutral `spotlightClientTools({ projectId, frontendBuildId, include })` plugin can infer Tool metadata. Other JS/TS builds register explicit `defineTool` contracts; Vite is not mandatory.

### Vue visual adapter

Only when `ui adapter = VUE_READY`, install the same version of `@inupedia/spotlight-vue`:

```bash
pnpm add @inupedia/spotlight-vue@<ver>
# or equivalent npm/yarn command
```

Verify its Vue/Pinia peers first. Never use `--force` or `--legacy-peer-deps` to hide a mismatch.

Vue visual wiring:

1. Tool compiler `spotlightClientTools({ projectId, frontendBuildId, include })`
2. `src/spotlight/config.ts` + `loadBundledSkillsFromGlob('.inupedia/skills/**/SKILL.md')`
3. `main.*`: Spotlight CSS + `app.use(SpotlightVue, { config, enabled: true })`
4. Dev proxy: frontend `VITE_SPOTLIGHT_SERVER_URL` -> Spotlight Server `:8787`

For React/other frameworks with `ui adapter = ADAPTER_REQUIRED`, do **not** install `@inupedia/spotlight-vue`. Continue Client Tool/Skill/Server wiring and headless live benchmarks. Report visual embedding as remaining adapter work.

## 6. Client Tool contract

Every generated Tool must:

- call an existing host function/export;
- preserve the host application's authorization checks and backend permission enforcement;
- use either JSDoc immediately above `defineClientTool` on the Vite inference path, or explicit `name`, `description` and `schema` through `defineTool`;
- expose the narrowest input schema needed by the host capability;
- preserve the actual callable boundary's field names, types, enums, requiredness, and identity semantics unless an explicit adapter performs a documented transform;
- declare correct `sideEffect`, `replayPolicy`, `riskLevel`, and confirmation requirements supported by the runtime;
- avoid returning entire stores or arbitrary internal objects when a small result is enough;
- never provide a generic `invokeStoreMethod(name, args)` or DOM selector escape hatch.

**Schema fidelity rule:** derive Tool schemas from the actual Store/Service/API/function boundary, not from a convenient benchmark shape. Do not casually widen `Long`/numeric ids to `string | number`, and do not narrow a real host union merely to improve model scoring. If the Tool intentionally adapts the host contract, the adapter must contain the explicit conversion and the generated report/gold set must test the Tool's real adapter contract. Never add generic Server-side coercion just to compensate for an inaccurate Tool schema.

The Server recursively removes optional `null`/`undefined` values and undeclared object fields when the Tool schema forbids additional properties. In 0.9.x the client and Server also validate Tool input at the execution boundary, and the client validates declared output. This is not permission to declare loose or inaccurate schemas. A field that legitimately accepts `null` must declare it with `type: ["string", "null"]`, `anyOf`, or `oneOf`.

### Resource Provider contract

Use `defineResourceProvider` for large or runtime-dynamic target sets such as cameras, assets, tickets, books or BIM components. A provider owns:

- one stable `namespace`;
- runtime `search`（空 query 表示列出全部）and `get` functions;
- resource `id`, display `name`, aliases and live status;
- optional actions that resolve a required user `query` to exactly one resource before executing host behavior.

Do not copy thousands of entity names into Skill text, Tool enums, Server Project Packs or generic router code. Do not trust the LLM to invent stable ids. The Resource Provider is consumer code and may call the host's existing list/status APIs at runtime.

**Behavior fidelity rule:** a user-visible action is not `DIRECT` merely because its final step is an HTTP call. Follow the real behavior through component state, session data, route/query state, validation, chained calls, and all writes. If the UI behavior depends on component-local state or performs multiple/transitive writes, classify it `REFACTOR` (and `GATED` when risk requires it) until the complete behavior is extracted into a stable host capability shared by UI and Agent. Do not fabricate a simplified Tool that skips those invariants.

**Authorization rule:** static Skill/Tool declarations describe capability; they never grant permission. If availability depends on the current role, tenant, record ownership, workflow state, feature flag, or another live host condition, keep that guard in the host and include the capability in the live Tool set only when it is currently available. The Tool handler/backend must re-check authorization at execution time. Never duplicate or weaken product-specific RBAC/ABAC rules inside the generic Spotlight Server.

`DIRECT` capabilities become Tools. `REFACTOR` capabilities become Tools only after an approved behavior-preserving extraction. `GATED` capabilities are not auto-exposed.

## 7. Environment

Frontend `<app>/.env.example`:

```env
VITE_SPOTLIGHT_PROJECT_ID=<projectId>
VITE_SPOTLIGHT_SERVER_URL=/spotlight-api
VITE_SPOTLIGHT_API_KEY=local-dev-key
```

Vite proxy `/spotlight-api` -> `http://127.0.0.1:8787`.

Server `spotlight-project/.env.example`:

```env
SPOTLIGHT_API_KEYS=local-dev-key
SPOTLIGHT_POSTGRES_PASSWORD=spotlight
CORS_ORIGIN=http://localhost:5173
SPOTLIGHT_LLM_PROVIDER=siliconflow
SILICONFLOW_API_KEY=
SILICONFLOW_API_BASE=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=
KNOWLEDGE_BASE_URL=
KNOWLEDGE_API_KEY=
KNOWLEDGE_TIMEOUT_MS=120000
TAVILY_API_BASE=
TAVILY_API_KEY=
```

Never copy host secrets into Skills. Never put LLM/provider keys in `VITE_*`.

Provider adapters are selected in `spotlight.project.yml`. Built-ins are conveniences, not lock-in: a project module may register a custom knowledge/web provider (for example RAGFlow or a private Tavily proxy) without changing generic Server routing.

## 8. Runtime lifecycle and deployment

The published client/UI adapter owns the transport sequence:

```text
POST /v1/initialize
POST /v1/threads
POST /v1/threads/:threadId/turns
GET  /v1/turns/:turnId/events         (SSE, resumable)
POST /v1/turns/:turnId/tool-results
```

Do not implement a consumer-side query loop or call a legacy `/query` endpoint.
The frontend manifest version and build id must match the deployed browser build;
otherwise host Tool dispatch must fail closed.

Production deployment must:

- pin an immutable Server image/package version;
- preserve persistent database and memory volumes;
- recreate only the Spotlight Server service for a Server-only release;
- wait for `/health` before declaring success;
- retain the previous image and roll back on failed health;
- verify the frontend build id separately after its own deployment.

## 9. Boot order

Core/headless benchmark:

1. `cd spotlight-project && docker compose up -d`
2. `curl -sfS http://127.0.0.1:8787/health`
3. Start the host app/backend as required by its own stack
4. Run the Spotlight Server gold benchmark through registered Client Tools

Vue visual integration adds opening the embedded Spotlight command UI after the host frontend starts.

## 10. Definition of done

Integration is done only when all applicable gates hold:

- Core compatibility and UI-adapter compatibility are reported separately;
- every discovered user-facing capability is classified `DIRECT / REFACTOR / GATED / REJECT`;
- every `DIRECT` capability selected for exposure is wrapped;
- every generated Tool schema is traceable to a real host boundary or an explicit adapter transform;
- component-local multi-step behavior is not mislabeled as a simple DIRECT Tool;
- `skill.knowledge` exists;
- every Skill `allowed-tools` name is an exported registered Client Tool;
- projectId is identical across Tool compiler/config/project/env;
- host authorization, record-ownership, and workflow-state guards still protect every exposed capability, and Tool registration is never treated as permission;
- smoke gold rows cover all actionable Skills;
- static checks pass;
- `INTEGRATION_REPORT.md` distinguishes static readiness, Core Agentization, UI embedding, and live accuracy;
- live metrics are reported only if the Server + target LLM actually ran.
- `/v1/initialize`, thread creation, SSE, host Tool acknowledgement and refreshed UI context are verified through the published SDK path;
- representative production prompts pass repeatedly against the production model/config/build, not only once in dev;
- Server-only deployment does not recreate the database service and has a tested rollback path.

A project may be Core-Agentized and benchmarked successfully while its visual adapter remains `ADAPTER_REQUIRED`; that state must be reported explicitly rather than mislabeled as a complete embedded UI integration.

## 11. What must not appear in the host app

- LangGraph/custom planner added solely for Spotlight integration
- copied product-specific Skill ids/tool names from the integration pack
- a second `projectId`
- Client Tools that do not reach an existing host capability
- simplified Tools that bypass real validation, session state, chained writes, or state-machine invariants
- forced peer-dependency installation
- framework-specific package installation into an incompatible host
- DOM-click automation where a stable Store/Service/Router capability exists
- authorization bypasses or generic Server copies of product-specific RBAC/ABAC rules
- claims such as “95% accuracy” derived only from grep/static checks
- bearer token bytes used as `memorySubjectId`
- a consumer-side replacement for the Server LangGraph lifecycle
