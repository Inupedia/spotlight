# Pattern example (generic)

Do **not** copy names, files, or domains from this page into a host app. Copy the **shape**. Catalog strings must be read from the host repo.

A typical domain is a **resource** the UI can search, open, and close. When the
catalog is runtime-backed or expected to grow, use a Resource Provider rather
than copying its names into a Skill or Tool enum.

## Host already has (hypothetical)

```
src/services/items.ts
  listItems(): { id: string, name: string }[]
  openItemByName(name: string): Promise<void>
  closeItem(): Promise<void>
```

Visible UI: an “open” button, a search box, a list whose `name` fields are real product strings.

## Resource + Tool (shape)

```ts
export const itemResources = defineResourceProvider({
  namespace: "item",
  description: "Host resources",
  search: async ({ query, limit }) => ({
    items: (await listItems())
      .filter((item) => item.name.includes(query))
      .slice(0, limit),
  }),
  get: async (id) => (await listItems()).find((item) => item.id === id) ?? null,
  actions: {
    open: {
      toolName: "openItem",
      description: "Open the matching resource by name or stable id.",
      handler: (item) => openItemByName(item.name),
    },
  },
});

/** Close the current resource view. */
export const closeItem = defineClientTool(async () => closeCurrentItem());
```

## Skill (shape)

```yaml
id: skill.items
name: Resources
when_to_use: The user asks what resources exist, or asks to open or close an existing name
allowed-tools: item_search, item_get, openItem, closeItem
spotlight-response-strategy: tool_answer
```

Body must include the list-vs-open contract in [testing.md](testing.md). Examples in frontmatter must use **host catalog strings**, not `item-1`.

## Gold rows (shape)

| prompt                                       | expectTool              |
| -------------------------------------------- | ----------------------- |
| What … are available                         | item_search             |
| View \<exact name from host catalog\>        | openItem                |
| Close …                                      | closeItem               |
| Introduce this system                        | (none, skill.knowledge) |

If the host has no list/search API, do not invent a Resource Provider. If it has no open API, do not invent `openItem`.
