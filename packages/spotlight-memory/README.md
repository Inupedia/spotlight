# @inupedia/spotlight-memory

Optional exact + semantic answer-cache primitives for repeated deterministic
requests.

This package is no longer wired into the Spotlight Server Agent lifecycle. The
Server uses LangGraph Checkpointer for Thread state and LangGraph Store for
explicit, user-approved long-term memory. It never semantically replays complete
assistant answers.

Use this package only when an application explicitly needs an independently
versioned response cache. A cache hit must not bypass Agent routing, Knowledge,
authorization, or Tool execution.

## Role

| Layer | Storage | Package API |
|-------|---------|-------------|
| L0 Exact | `packs/<id>/memory/exact/` | `ExactMemoryStore` |
| L1 Semantic | `packs/<id>/memory/semantic/` (Phase 3) | `findSemantic` (MVP: bigram scan) |
| Gate | — | `createMemoryGate` |

## Install

```bash
pnpm add @inupedia/spotlight-memory @inupedia/spotlight-protocol
```

## Legacy cache usage

```typescript
import { createPackMemoryStores } from "@inupedia/spotlight-memory/node";

const { gate } = createPackMemoryStores({
  packsRoot: "/app/packs",
  projectId: "ydjm-construction-map",
  gateConfig: { semanticThreshold: 0.92 },
});

// Application-owned cache lookup. Do not place this before Agent routing.
const result = await gate.lookup({
  projectId,
  question: request.userQuestion,
  invalidation: {
    assetsVersion: assetsMeta.version,
    catalogVersion: catalogHash,
  },
});

// Cache only a deterministic, versioned artifact after independent validation.
await gate.write({
  projectId,
  question: request.userQuestion,
  kind: "qa_answer",
  answer: finalReply,
  invalidation: { assetsVersion, catalogVersion },
  confidence: 0.9,
  sourceRunId: run.id,
});
```

## Exports

| Entry | Runtime | Purpose |
|-------|---------|---------|
| `@inupedia/spotlight-memory` | isomorphic | normalize, classify, gate factory |
| `@inupedia/spotlight-memory/node` | Node | pack paths, exact jsonl store |

## Build

```bash
pnpm install
pnpm build
pnpm test
```
