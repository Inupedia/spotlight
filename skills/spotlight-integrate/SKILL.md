---
name: spotlight-integrate
description: Agentizes an existing frontend with Inupedia Spotlight by discovering real host capabilities, classifying readiness/risk, wrapping verified capabilities as Client Tools, generating Agent Skills, wiring the framework-neutral Spotlight core and an available UI adapter when supported, and leaving measurable acceptance tests. Use when the user asks to integrate Spotlight, install Spotlight, integrate the Spotlight SDK, generate Spotlight tools/skills from an existing app, or convert a finished frontend into an Agent-ready Spotlight project.
---

# Spotlight Integrate

Turn **this** host app into a thin Spotlight 0.8.x adapter. The consumer registers
typed Tools, Resource Providers, Skills and UI context; the deployable Spotlight Server owns
LangChain/LangGraph routing, lifecycle, providers, memory and host dispatch.

Do not copy another product's domains or behavior. If a behavior does not exist
in the host, it is not a Client Tool.

## Read first (mandatory)

1. [architecture.md](architecture.md) — Agentization boundary, capability classes, safety, quality metrics
2. [standard.md](standard.md) — compatibility, install, layout, env, boot
3. [testing.md](testing.md) — smoke/gold tests, live accuracy, acceptance metrics
4. Then the pipeline files below

Pin all published `@inupedia/spotlight-*` packages to the **same registry version** unless the user pinned a compatible release. Verify the target package peer dependencies before changing the host lockfile.

## Pipeline (strict order)

Resume from `.spotlight-integrate/PIPELINE_STATE.md` if present. Template: [methodology/00-pipeline-state.md](methodology/00-pipeline-state.md).

| Stage | Spec                                                                             | Output                                                                                      |
| ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0     | [methodology/01-stage0-overview.md](methodology/01-stage0-overview.md)           | `FRONTEND_OVERVIEW.md`, `COMPATIBILITY.md`                                                  |
| 1     | [methodology/02-stage1-extract.md](methodology/02-stage1-extract.md)             | `candidates/*`                                                                              |
| 1.5   | [methodology/03-stage1.5-verify.md](methodology/03-stage1.5-verify.md)           | `verified.md`, `leftovers.md`, `rejected/`                                                  |
| 2     | [methodology/04-stage2-tools.md](methodology/04-stage2-tools.md)                 | `src/spotlight/tools.ts`, optional `src/spotlight/resources.ts`                             |
| 3     | [methodology/05-stage3-skills.md](methodology/05-stage3-skills.md)               | `.inupedia/skills/**/SKILL.md`                                                              |
| 4     | [methodology/06-stage4-pressure-test.md](methodology/06-stage4-pressure-test.md) | `gold-questions.md`, benchmark plan/results                                                 |
| 5     | [methodology/07-stage5-wire.md](methodology/07-stage5-wire.md)                   | core config, Vite, project pack, optional UI adapter — paths per [standard.md](standard.md) |
| 6     | [methodology/08-stage6-report.md](methodology/08-stage6-report.md)               | `INTEGRATION_REPORT.md`                                                                     |

Extractors: [extractors/](extractors/). File snippets: [templates.md](templates.md). Shape-only example: [examples.md](examples.md). Human install + paste-to-LLM: [README.md](README.md) / [prompt.sh](prompt.sh).

## 0.8.x runtime contract

The browser adapter must use the current lifecycle through the SDK:

1. initialize capabilities (`POST /v1/initialize`);
2. create/reuse a thread (`POST /v1/threads`);
3. start a turn (`POST /v1/threads/:threadId/turns`);
4. consume ordered SSE events (`GET /v1/turns/:turnId/events`) and execute only manifest-bound host calls;
5. acknowledge Tool results (`POST /v1/turns/:turnId/tool-results`) with correlation id, trace and refreshed UI context.

Do not hand-code this transport when the published client/UI adapter already
implements it. Never fall back to a removed legacy query loop.

## Hard rules

1. **Host is the source of truth.** Client Tools call existing Store / Service / Router / page-engine capabilities; wrappers do not reimplement business logic.
2. **No invented behavior.** Do not create new players, maps, checkout APIs, calculations, or HTTP endpoints just to satisfy a spoken request.
3. **Page engines stay in the browser** (maps, video, canvas, framework stores/routers). Server gets providers via `spotlight-project/` only.
4. **No custom Agent** in the host app.
5. **Skills do not grant capabilities.** `allowed-tools` ⊆ exported Client Tool names.
6. **Generic Server, product-specific Skills.** Never require a Server hardcode for a host Skill id, catalog, or tool name.
7. **Intent families must be explicit.** Distinguish list/read, named open/view, mutation, close, knowledge, and clarify behavior when those families exist.
8. **Gated actions default-deny.** Delete, pay, transfer, submit-order, logout, reset/wipe, or irreversible external commits are not auto-exposed.
9. **Two Tool declaration paths:** use `defineClientTool` + the Vite compiler for automatic metadata, or explicit `defineTool({ name, description, schema, handler })` in any JS/TS build. Both paths are framework-neutral.
10. **Always** emit `skill.knowledge` (`direct_answer`, no client tools).
11. **Layout** must match [standard.md](standard.md). Do not invent a second `projectId` or tools entrypoint.
12. **Do not claim runtime accuracy without a live run.** Static/dry checks are readiness only.
13. **Do not confuse Core Agentization with the visual shell.** `@inupedia/spotlight-client` + protocol + Server/Skills/Tools are the core path. `@inupedia/spotlight-vue` is the currently shipped Vue UI/runtime adapter, not a requirement for Server benchmarking of a non-Vue host.
14. **Dynamic catalogs are Resources.** Runtime entity names, aliases, status and stable ids belong in consumer `defineResourceProvider` registrations; Skills describe the workflow and generic Server code never hard-codes product catalogs.
15. **Schemas are strict.** Optional non-null fields may be omitted; nullable fields must declare `null`; unknown properties are rejected when `additionalProperties: false`. The Server normalizes model output recursively but does not repair a dishonest schema.
16. **Memory identity is stable.** Use an authenticated immutable subject id. Never use a bearer token, token prefix, email display string, or anonymous session id as cross-session identity.
17. **Production parity is a gate.** Dev success is insufficient: repeat representative prompts against the exact production model, Project Pack, frontend build manifest and Server image.
18. **Tool Results are structured.** Tool handlers may return plain values, but the SDK boundary normalizes them to the shared Tool Result envelope and validates declared input/output schemas at runtime.

## Compatibility behavior

Compatibility is two-axis: **Core Agentization** and **UI Adapter**.

- Any browser TypeScript/JavaScript host that can register explicit `defineTool` contracts and reach the Server → core path may continue without Vite.
- Vite hosts may use `defineClientTool` for automatic name/description/schema inference.
- Vue 3 + Vite + compatible Spotlight Vue peers → `core=READY`, `uiAdapter=VUE_READY`; continue automatically.
- Vue 3 + Vite with incompatible Vue/Pinia/Node peers → core analysis may continue; `uiAdapter=UPGRADE_REQUIRED`; do not force-upgrade unless requested.
- React/other Vite host → `core=READY` when the framework-neutral client/tool path is compatible; `uiAdapter=ADAPTER_REQUIRED` unless a supported adapter exists. Continue Tool/Skill/Spotlight Server benchmarks headlessly instead of declaring the whole app unsupported.
- Host without Vite → use explicit `defineTool`; require build migration only when the host cannot bundle or execute the framework-neutral client at all.
- Legacy/non-JS host with no viable browser Tool integration → `core=UNSUPPORTED_AUTOMATION`; still produce the readiness report.
- Zero verified tools → knowledge-only integration is valid; report all leftovers.

A missing visual adapter blocks embedding the Spotlight command UI, **not** the validity of a Server + Skill + Tool benchmark. See [architecture.md](architecture.md) for the current two-axis matrix; do not use the older Vue-only classification.

## Refactor behavior

A real user-facing capability trapped in component-local code is `REFACTOR`, not fake and not automatically rejected. Extract it only when the change is behavior-preserving and the user asked for a full integration/refactor. Otherwise leave it in `leftovers.md` with the exact source location.

## Autonomy / confirmation

If the user said “integrate fully”, “agentize this app”, or equivalent, run the safe pipeline end-to-end without pausing after each stage. Pause only for:

- build-system migration;
- dependency upgrades outside declared compatible ranges;
- exposing a `GATED` capability;
- an ambiguity that would materially change product behavior.

A missing UI adapter alone is not a reason to stop Core Agentization or a headless Spotlight Server benchmark.

Otherwise report intermediate WRAP / REFACTOR / GATED / REJECT classifications briefly before wiring.

## Final handoff

Do not finish with only a file list. Report:

- core compatibility status + UI adapter status separately;
- capability coverage by `DIRECT / REFACTOR / GATED / REJECT`;
- wrapped Tool + Skill count;
- static integrity status;
- live benchmark metrics if actually run;
- unverified runtime items and exact blockers;
- env keys + boot order;
- remaining refactors/gated actions/UI-adapter work.
