# Spotlight Integrate

Upgrade an existing frontend into an **Agent-ready Spotlight app**. A coding agent reads this skill pack, discovers real host capabilities, wraps them as Client Tools + Resource Providers + Agent Skills, then wires the 0.8.x initialize / thread / turn / SSE / host-result lifecycle with measurable acceptance. Vue 3 has a shipped visual adapter; other JS/TS hosts can still complete Core Agentization.

Core rule: **host business code is the only source of truth. Spotlight is the agentization adapter, not a second business system and not a DOM click bot.**

Start with [architecture.md](architecture.md) for the full architecture.

## What it actually does

```text
Existing Vue app
Store / Service / Router / page engine
        ↓
spotlight-integrate (coding agent, development time)
        ↓
Client Tools + Resource Providers + Skills + uiContext + Project Pack
        ↓
Spotlight Server + LLM (runtime agent)
        ↓
User natural language invokes existing host capabilities
```

So “this skill is enough” means: **a coding agent can follow this directory and finish the adapter**. Runtime still needs the Spotlight SDK, Spotlight Server, and the target LLM.

## Two ways to use it

### A. Install as an Agent Skill

Copy the whole directory:

```text
~/.cursor/skills/spotlight-integrate/
<app>/.cursor/skills/spotlight-integrate/
<app>/.codex/skills/spotlight-integrate/
<app>/.claude/skills/spotlight-integrate/
```

Then, in the host repository:

```text
Use spotlight-integrate. Agentize this app with Spotlight. Follow architecture.md and standard.md.
```

### B. Paste into any LLM

```bash
./prompt.sh
./prompt.sh --copy
./prompt.sh -o /tmp/spotlight-integrate.prompt.md
./prompt.sh --check
```

`prompt.sh` expands the full pack in a fixed order and fails if a file is missing.

## Agentization pipeline

| Stage | Purpose                                         | Main output                                |
| ----- | ----------------------------------------------- | ------------------------------------------ |
| 0     | Compatibility precheck + frontend capability map | `COMPATIBILITY.md`, `FRONTEND_OVERVIEW.md` |
| 1     | Extract candidate capabilities from Router/Store/Service/UI | `candidates/*`                   |
| 1.5   | Verify and classify                             | `DIRECT / REFACTOR / GATED / REJECT`       |
| 2     | Generate thin Tool / Resource adapters          | `src/spotlight/tools.ts`, `resources.ts`   |
| 3     | Generate Skills by business domain              | `.inupedia/skills/**/SKILL.md`             |
| 4     | Gold prompts + pressure-test design             | `gold-questions.md` / benchmark            |
| 5     | Wire Core / optional UI / Server Project Pack   | config / env / project pack                |
| 6     | Emit an acceptable result                       | `INTEGRATION_REPORT.md`                    |

## Four capability classes

- `DIRECT`: already a stable export, speakable, and safe to expose → wrap as a Tool.
- `REFACTOR`: real capability exists, but logic is trapped in a component → extract with behavior-preserving refactors when allowed.
- `GATED`: delete, pay, submit-order, transfer, wipe, and similar high-risk actions → do not auto-expose.
- `REJECT`: invented capabilities, render-internal functions, arbitrary method/DOM/script executors → never expose.

Capabilities that do not become Tools still have an explicit reason; they are not silent coverage gaps.

## Compatibility

Compatibility has two axes: Core Agentization and UI Adapter. Any browser host that can bundle JS/TS can register Tools with explicit `defineTool`; Vite only adds automatic inference. Vue 3 with compatible peers can install the visual shell. React / other frameworks are `ADAPTER_REQUIRED`, which is not Core Agentization failure. Mark `BUILD_MIGRATION_REQUIRED` only when the host cannot execute the Core Client.

Spotlight npm package versions must be verified from the **registry**. Do not assume GitHub `main` matches the published npm version.

## Generated host layout

```text
<app>/
├── src/spotlight/
│   ├── config.ts
│   ├── tools.ts
│   └── resources.ts             # only for large / dynamic entity catalogs
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
    ├── benchmark-results.md       # only after a live benchmark
    └── INTEGRATION_REPORT.md
```

If the host already has Spotlight paths, **extend them in place. Do not relocate files just to match the template.**

## Why not DOM automation

Spotlight prefers:

```text
natural language → Skill → Client Tool → existing Store / Service / Router
```

not:

```text
natural language → CSS selector → simulated mouse click
```

The first path reuses existing business constraints, types, state, and tests. Classify component-local logic as `REFACTOR` only when there is no stable business entry point.

## Router boundary

The generic Spotlight Server **must not hard-code product semantics**. Business Skill ids, product names, BIM names, monitoring tool names, and similar vocabulary stay in the host Skill / Tool / Resource Provider / uiContext. Large dynamic catalogs such as cameras, assets, and tickets are searched, status-checked, and resolved to stable ids at runtime by a Resource Provider. Do not dump them into the Server Project Pack or the LLM prompt.

The Server only handles generic semantics: read/list, named open/view, mutation, clarify, and similar families.

## Testing is not one thing

Static checks prove wiring consistency, not LLM accuracy. The final report must report separately:

- Route Accuracy
- Skill Accuracy
- Tool Accuracy
- Argument Accuracy
- E2E Success Rate
- Clarification Accuracy
- Unsafe Execution Rate

If a real Spotlight Server + target model did not run, write: `LIVE BENCHMARK: NOT RUN`.

Production-grade routing should use **100+ Gold Prompts**. A simple integration starts with an 8–20 prompt smoke set. See [testing.md](testing.md).

## Environment and boot

Frontend:

```env
VITE_SPOTLIGHT_PROJECT_ID=<projectId>
VITE_SPOTLIGHT_SERVER_URL=/spotlight-api
VITE_SPOTLIGHT_API_KEY=local-dev-key
```

Do not put Server provider keys in `VITE_*`.

Standard boot:

```bash
cd spotlight-project && docker compose up -d
curl -sfS http://127.0.0.1:8787/health
# then start the host app and run gold prompts
```

Before release, also verify `/v1/initialize`, thread/turn, SSE, host Tool acknowledgements, and UI state changes. Repeat representative prompts at least 3 times on both dev and prod. A Server-only release rebuilds the Server service, leaves database volumes untouched, and rolls back to the previous image on health failure.

Full contract: [standard.md](standard.md). Skill entry: [SKILL.md](SKILL.md). Testing: [testing.md](testing.md).

## This directory

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

Manual integration can still follow `docs/client-tools.md` and `docs/server-deployment.md`. This skill standardizes, automates, and makes measurable the method of distilling that adapter from an existing frontend.
