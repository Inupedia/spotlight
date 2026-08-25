<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="Spotlight — one intelligent entry point for the whole frontend product">
</p>

<p align="center">
  <a href="./skills/spotlight-integrate/README.md"><strong>Integration Skill</strong></a>
  ·
  <a href="./docs/client-tools.md">Client Tools</a>
  ·
  <a href="./docs/server-deployment.md">Server Deployment</a>
  ·
  <a href="./packages/README.md">Packages</a>
</p>

## One entry point for the whole product

Spotlight is inspired by the interaction model behind **Apple's Spotlight**: start with one universal entry point, express what you want, and let the system take you to the right thing.

We think frontend products are moving in the same direction. Users should not have to learn where every feature, page, report, control, or workflow lives before they can get work done. A modern product should offer one intelligent command surface that can **search, navigate, explain, and act** across the capabilities already inside it.

Spotlight turns that idea into a framework-agnostic agent runtime for existing frontend products. It does not ask you to rebuild the UI or create a second “agent version” of the product. Instead, it connects natural-language intent to real Router / Store / Service / SDK capabilities through typed Client Tools, Skills, LangGraph, Knowledge, Memory, and recoverable Threads / Turns.

<p align="center">
  <img src="./assets/readme/demo.gif" width="100%" alt="Spotlight recognizes a request to view a camera and opens the matching live video in the host product">
</p>

The GIF above is that idea in a real host product. A user asks, in natural language, to look at a specific camera. Spotlight recognizes the intent, selects the matching Skill / Client Tool, and opens the exact live video through the host's own player — not by clicking through the UI. The command surface is only the entry point; execution still goes through real product capabilities.

> **The host product remains the source of truth.** Router, Store, Service, SDK, GIS, media players, permissions, and business rules stay in the host application. Spotlight adds the capability layer, routing, runtime state, retrieval, and memory around them.

Spotlight's architecture is **framework-agnostic**. This repository currently provides the most complete adapter and automated integration path for **Vue 3 + Vite**, but the Client Tool / Skill / Runtime model is designed to extend to other frontend stacks without forcing them to migrate to Vue.

## Architecture

<p align="center">
  <img src="./assets/readme/architecture.png" width="100%" alt="Spotlight architecture connecting user intent, the frontend product, typed Client Tools, and Spotlight Runtime">
</p>

The architecture deliberately keeps product execution and agent orchestration separate:

| Your product owns | Spotlight owns |
| --- | --- |
| Stable Router / Store / Service / SDK capabilities | Client Tool protocol and runtime invocation |
| Business-facing Skills that describe when tools should be used | Skill routing, Knowledge, Actions, and multi-step orchestration |
| `projectId`, Server URL, and stable user identity | Session state, long-term memory, Thread / Turn / Item lifecycle, and SSE recovery |
| Existing permissions, state, and business constraints | Runtime coordination, reconnect behavior, and execution boundaries |

Spotlight does not move business logic into the runtime. It creates a reliable execution layer **between user intent and real product capabilities**.

## Why not a DOM agent?

<p align="center">
  <img src="./assets/readme/capability-vs-dom.png" width="100%" alt="Symmetric comparison between Spotlight's typed capability path and fragile DOM automation">
</p>

Spotlight follows the **capability path**, not the **pixel / selector path**.

- **Stable** — layout and component changes do not automatically break the agent.
- **Verifiable** — tools have explicit names, descriptions, and input/output contracts.
- **Policy-aware** — reads, navigation, and sensitive writes can follow different execution rules.
- **Maintainable** — the agent invokes real business capabilities instead of guessing through the DOM.

When a product can expose a stable business capability, Spotlight can orchestrate it much more reliably than simulated browser clicks.

## Fastest adoption path

<p align="center">
  <img src="./assets/readme/integration-flow.png" width="100%" alt="Five-stage Spotlight integration flow from an existing frontend product to Spotlight Runtime">
</p>

The preferred integration model is to let a Coding Agent understand the product you already have, discover stable actions and data flows, and generate a thin Spotlight layer instead of reimplementing business logic.

This repository includes [`spotlight-integrate`](./skills/spotlight-integrate/README.md), a Skill Pack for that workflow.

Copy the entire directory into your Coding Agent's skills folder:

```text
skills/spotlight-integrate/
```

Then run it inside the host frontend repository:

```text
Use spotlight-integrate.
Agentize this app with Spotlight.
Follow architecture.md and standard.md.
```

You can also flatten the complete Skill Pack into one prompt:

```bash
bash skills/spotlight-integrate/prompt.sh --copy
```

During integration, the project-specific details you typically need to confirm are:

- `projectId`
- Spotlight Server URL / API key
- a stable user identity for Memory
- sensitive actions that should be gated rather than exposed automatically

> **Current implementation maturity:** automated integration is strongest for **Vue 3 + Vite** today. That is the current adapter implementation, not Spotlight's architectural boundary.

## Current Vue adapter example

The repository currently ships `@inupedia/spotlight-vue`, so Vue 3 + Vite projects can integrate with a very thin adapter layer. The example below demonstrates the current first-class adapter; it does **not** define Spotlight's product scope.

### 1. Install

```bash
pnpm add @inupedia/spotlight-client @inupedia/spotlight-vue
```

### 2. Wrap an existing capability as a Client Tool

```ts
// src/spotlight/tools.ts
import { defineClientTool } from "@inupedia/spotlight-client";
import { videoService } from "@/service/video";

/** Play a named video in fullscreen. */
export const playVideoFullscreen = defineClientTool(
  async ({ name }: { name: string }): Promise<void> => {
    await videoService.playFullscreen(name);
  },
);

export const spotlightTools = [playVideoFullscreen];
```

In the current TypeScript / Vite adapter, Spotlight can derive tool metadata from the **exported symbol name + JSDoc + TypeScript types**, including the JSON Schema used by the runtime. Business code does not need to hand-write bulky LangChain tool metadata.

### 3. Register Spotlight

```ts
// src/main.ts
import { createApp } from "vue";
import { SpotlightVue } from "@inupedia/spotlight-vue";
import App from "./App.vue";
import spotlightConfig from "./spotlight/config";

createApp(App)
  .use(SpotlightVue, spotlightConfig)
  .mount("#app");
```

For the complete Vite plugin, configuration, Skill loading, and environment-variable setup, see **[Client Tool / Skill Integration Guide](./docs/client-tools.md)**.

## Runtime boundary

<p align="center">
  <img src="./assets/readme/runtime-boundary.png" width="100%" alt="Balanced responsibility boundary between the frontend host and Spotlight Runtime">
</p>

The frontend host executes real product actions. Spotlight coordinates intent, retrieval, state, and recovery.

The host remains responsible for:

- UI / components
- Router / Store / Service execution
- Client Tool execution
- returning fresh `uiContext` after actions

Spotlight Runtime remains responsible for:

- Skills
- LangGraph routing and planning
- Thread / Turn / Item lifecycle and SSE coordination
- Knowledge / RAG
- Memory
- model / provider integrations

Generic server logic should not hard-code the semantics of a specific product. Product-specific meaning belongs in host Skills, tool descriptions, schemas, and `uiContext`.

## Safety boundaries

`spotlight-integrate` does not expose every discovered function automatically. Candidate capabilities are classified first:

| Class | Meaning |
| --- | --- |
| `DIRECT` | A stable capability already exists and can be safely exposed as a Tool |
| `REFACTOR` | The capability is real, but currently trapped inside component-local logic and should be extracted without changing behavior |
| `GATED` | A sensitive action such as delete, payment, transfer, or submit; it should not be auto-exposed |
| `REJECT` | A fabricated capability, arbitrary script / DOM executor, or another unsafe abstraction |

The goal is not to let the agent click everything. The goal is to expose **real, describable, verifiable business capabilities**.

[`docs/design/capability-protocol-v2.md`](./docs/design/capability-protocol-v2.md) describes a further capability-tier and replay design, but that document is explicitly marked as a **deferred design** and should not be treated as shipped runtime behavior.

## Thread / Turn / Item and reconnect

A Spotlight conversation uses three stable primitives:

- **Thread** — one resumable conversation.
- **Turn** — one user request through completion, failure, or interruption.
- **Item** — a typed unit such as Skill use, Tool call, knowledge search, reasoning summary, Memory decision, or final message.

The frontend never consumes LangGraph node names or routing phases. It receives
`turn.started`, `item.started`, `item.updated`, `item.completed`,
`turn.completed`, and `turn.failed`.

A Spotlight **Turn** is not tied to one SSE connection.

- Each event carries a sequence number.
- Reconnects can continue from `Last-Event-ID` (or `?lastEventId=`) instead of re-running the whole turn.
- A browser disconnect can move a run into `waiting_for_host` rather than failing it immediately.
- When the host returns, unfinished browser-side work can continue.
- Expired Turns return `410`, allowing clients to stop retrying.
- After each tool execution, the browser can return fresh `uiContext`, so the next agent step sees the state **after** the action.

This gives multi-step product execution much stronger recovery semantics than restarting the entire interaction after every connection failure.

## Memory

Spotlight separates two memory scopes.

### Session memory

Managed by the LangGraph Checkpointer and scoped by:

- `projectId`
- `sessionId`

### Cross-session long-term memory

Requires a **stable** `memorySubjectId` from the host product.

If the host cannot provide a stable user identity, Spotlight should not silently fall back to a shared project-wide memory bucket. That would risk memory leakage across users.

## Packages

| Package | Role |
| --- | --- |
| `@inupedia/spotlight-protocol` | Shared client / server protocol |
| `@inupedia/spotlight-client` | `defineClientTool`, App Client, Thread / Turn stream, and build-time tool manifest |
| `@inupedia/spotlight-vue` | Current Vue adapter: plugin, command UI, Skill reporting, and browser execution pipeline |
| `@inupedia/spotlight-memory` | Memory Gate and cache-backed storage |
| `@inupedia/spotlight-server` | Deployable LangChain / LangGraph runtime |

See [`packages/README.md`](./packages/README.md) for the package-level overview.

## Versioning and compatibility

Check current releases from npm:

```bash
npm view @inupedia/spotlight-vue version
npm view @inupedia/spotlight-server version
```

`@inupedia/spotlight-*` packages and:

```text
ghcr.io/inupedia/spotlight-server:<version>
```

should stay aligned to the same semver.

Repository-level requirements:

- **Node.js >= 22**
- **pnpm >= 9**

The current Vue package targets **Vue >= 3.5** and **Pinia >= 3**. That is an implementation maturity statement, not Spotlight's architectural boundary.

## Development

```bash
pnpm install
pnpm test
pnpm build
```

Common checks:

```bash
pnpm typecheck
pnpm smoke:packages
pnpm test:ci
```

The release flow is tag-driven. CI validates workspace versions, runs tests, publishes npm packages, and publishes the server image.

Node-only capabilities must remain behind `/node` entry points and must not leak into browser-facing package entry points.

## Further reading

| Goal | Document |
| --- | --- |
| Use a Coding Agent to agentize an existing frontend product | [`skills/spotlight-integrate/README.md`](./skills/spotlight-integrate/README.md) |
| Define Client Tools and Skills manually | [`docs/client-tools.md`](./docs/client-tools.md) |
| Deploy Spotlight Server and the Project Pack | [`docs/server-deployment.md`](./docs/server-deployment.md) |
| Review the deferred capability / replay design | [`docs/design/capability-protocol-v2.md`](./docs/design/capability-protocol-v2.md) |
| Explore package structure | [`packages/README.md`](./packages/README.md) |

---

<p align="center">
  <sub>One intelligent entry point. Real product capabilities underneath.</sub>
</p>
