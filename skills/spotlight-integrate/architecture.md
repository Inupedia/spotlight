# Spotlight Agentization architecture

Spotlight integration is an **adapter architecture**, not DOM automation and not a second business layer.

## Two-agent model

There are two different agents in the lifecycle:

1. **Coding agent** — reads `spotlight-integrate`, inspects the host repo, and generates the adapter layer.
2. **Runtime agent** — receives end-user language through Spotlight Server and invokes only capabilities exposed by the host.

Do not mix these responsibilities. `spotlight-integrate` may refactor the host only to expose an existing capability cleanly; it must never invent new business behavior.

## Runtime layers

```text
user language
  -> Spotlight Client lifecycle (initialize/thread/turn/SSE)
  -> Spotlight Server LangGraph router
  -> host Skill (intent + allowed-tools)
  -> optional Resource Provider (search/get/resolve dynamic entities)
  -> Client Tool (typed adapter + safety metadata)
  -> existing Store / Service / Router / page engine
  -> existing UI or business state
```

A successful integration keeps **one source of truth** for business behavior: the host app.

## Capability classes

Every user-facing capability discovered in the host must end in exactly one class:

| Class      | Meaning                                                                                | Default action                                                              |
| ---------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DIRECT`   | exported/callable, speakable, safe enough                                              | wrap as Client Tool                                                         |
| `REFACTOR` | real behavior exists but is trapped in component-local code                            | extract a behavior-preserving host function, then wrap only if allowed      |
| `GATED`    | real behavior exists but is destructive, external, irreversible, or security-sensitive | do not auto-expose; require explicit user allowlist and confirmation design |
| `REJECT`   | invented, generic escape hatch, renderer-internal, or not speakable                    | never expose                                                                |

Coverage must report all four classes. “Not exposed” is not the same as “missing”.

## Integration quality dimensions

Do not report a single vague completion percentage. Report these separately:

- **Discovery coverage** — user-facing capabilities classified / discovered.
- **Direct exposure coverage** — `DIRECT` capabilities wrapped / `DIRECT` capabilities.
- **Skill coverage** — wrapped tools represented by a Skill / wrapped tools.
- **Static integrity** — tool exports, Skill allowlists, projectId, schemas, and wiring are consistent.
- **Runtime routing accuracy** — measured only with a live Spotlight Server + target LLM.
- **Argument accuracy** — expected tool arguments match the gold set.
- **End-to-end success** — expected host state/UI delta occurs.
- **Safety accuracy** — destructive/gated/ambiguous prompts do not execute without the expected confirmation or clarification.

Never call dry/static checks “LLM accuracy”.

## Router boundary

Generic Spotlight Server code must not contain product names, project-specific Skill ids, catalog strings, or tool names. Product semantics belong in:

- the host Skill body / `when_to_use` / examples;
- Client Tool description + schema + safety metadata;
- consumer Resource Provider search/get/action contracts for large or dynamic entity sets;
- `uiContext` and conversation context.

The Server may apply **generic** intent families (read/list, named open/view, mutation, clarify) based on Skill/tool metadata, but it must not special-case `skill.<product>`.

## Compatibility boundary

Compatibility has two independent axes:

- **Core Agentization:** a JS/TS host that can register Client Tools and reach the Server can be `READY`, regardless of visual framework.
- **UI Adapter:** Vue 3 has the published `@inupedia/spotlight-vue` shell; React/other hosts remain Core-ready but `ADAPTER_REQUIRED` until a compatible shell exists.

Vite is the shipped automatic Tool compiler path. A non-Vite JS/TS host uses
explicit `defineTool({ name, description, schema, handler })` declarations and
does not require a build migration solely because it lacks Vite. Classify
`BUILD_MIGRATION_REQUIRED` only when the host cannot bundle or execute the
framework-neutral client/runtime contract.

## State and identity boundary

- `uiContext` is a bounded observation of current route/selection/scene; it is not a duplicate global store.
- Client Tool results carry a post-action observation so the Server sees the new host state.
- Conversation/thread memory is separate from optional cross-session memory.
- Cross-session memory requires a stable authenticated subject id; opaque access tokens disable it rather than becoming identity.
- Entity catalogs remain consumer data. Register them as Resource Providers so they can be searched and refreshed at runtime without rebuilding the generic Server or expanding the LLM prompt with every entity.

## Tool, Resource and Skill boundary

| Layer             | Owns                                                                          | Does not own                              |
| ----------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Tool              | one narrow executable host action                                             | large entity catalogs or workflow policy  |
| Resource Provider | search/get, aliases, live status and stable-id resolution for one entity type | cross-domain orchestration                |
| Skill             | when a domain/workflow applies and which Tools are allowed                    | entity truth or duplicated business logic |

Use a Resource Provider when the target set is large, dynamic, status-bearing or
alias-heavy. A provider exposes deferred `namespace_search` / `namespace_get`
Tools plus declared resource actions. The action accepts the user's original
`query`, resolves it to one stable resource id in the browser, rejects ambiguous
matches, and then calls the existing host capability.

## Safety defaults

- Reads: low risk by default.
- Reversible UI navigation: low/medium depending on host semantics.
- Mutations: medium unless clearly read-only.
- Delete/pay/transfer/submit-order/logout/reset/wipe and external commits: `GATED` by default.
- Missing required arguments: clarify, never guess.
- Referential commands (“that one”, “继续”, “买这个”) require resolvable UI/conversation context.

## Definition of agentized

A host is **agentized** when a user can express supported jobs in natural language and Spotlight reaches the same existing host capabilities that buttons/routes/stores already use, with measurable routing/argument/state accuracy and explicit safety boundaries.

It is not necessary — or desirable — for every UI control to become a Tool.
