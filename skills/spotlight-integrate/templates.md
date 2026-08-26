# Templates

Use these as **shape only**. Replace names/imports with real host symbols. Never copy placeholder catalog values into a shipped integration.

## `src/spotlight/tools.ts`

```ts
import { defineClientTool } from "@inupedia/spotlight-client";
// import existing host actions/services/stores — do not invent behavior

/** List current resource names and counts. */
export const getItemList = defineClientTool(
  async (): Promise<unknown> => listItems(),
  {
    sideEffect: "none",
    replayPolicy: "safe",
    riskLevel: "low",
  },
);

/** Open an existing resource by the name the user provided. */
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

/** Apply a reversible update to an existing resource. */
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
/** Switch an existing host tab. */
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
  description: "Open an existing resource by the name the user provided.",
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
  description: "Resources in the host product",
  search: async ({ query, limit }) => ({
    items: await itemService.search(query, limit),
  }),
  get: async (id) => itemService.getById(id),
  actions: {
    open: {
      toolName: "openItem",
      description: "Open one existing resource by name, alias, or stable id.",
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
name: Resources
description: Query the resource list, open an existing name, and apply a reversible host update.
when_to_use: Use when the user asks for a resource list, clearly asks to open a resource, or asks to update a resource field. Do not use for introductions or explanations.
allowed-tools: getItemList, openItem, updateItem
spotlight-response-strategy: tool_answer
capability-examples: What resources are available, Open <exact host catalog name>, Change <real field> to <real value>
tool-examples: <acceptance-critical exact utterance> => <registeredToolName>
---

# Resources

- List / count -> `getItemList`. Do not open a resource.
- Open / view + a specific name -> `openItem`. Keep the user's original name.
- Update -> `updateItem`. Every required argument must come from user input or reliable uiContext.
- Missing name / id / value -> clarify. Do not guess.
- Introduction, explanation, news -> do not call this Skill's Client Tools.
```

## Knowledge Skill (always)

```md
---
id: skill.knowledge
name: Project knowledge
description: Answer introductions, concepts, facts, and public information. Do not use the project knowledge base when a web search can answer. Do not operate the page.
when_to_use: The user asks what the project is, about public materials or news, or what a module in this system means, and does not ask to operate the current page.
spotlight-response-strategy: direct_answer
capability-examples: Introduce this project, Any recent public news, What does this module mean
---

# Project knowledge

- Introductions, news, and public facts go through web search. Do not call the project knowledge base.
- Use the knowledge base only for this system's modules, internal metrics, and unpublished material.
- Do not call any Client Tool.
- A business noun by itself is not an action intent.
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
