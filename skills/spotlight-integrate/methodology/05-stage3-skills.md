# Stage 3 — Distill Skills

Skills tell the **generic Spotlight Server router** which host capabilities apply to a user intent. Skills carry product semantics; the Server must not need product-specific Skill ids or tool names.

## Clustering

Group verified Tools by domain from stage 0.

| Cluster rule | Skill |
|---|---|
| same catalog + read/open/update jobs | one `skill.<domain>` |
| pure navigation across scenes/tabs | `skill.navigate` or a coherent navigation subdomain |
| filters tightly coupled to one panel/domain | same Skill as that panel |
| cross-cutting explanation/knowledge | `skill.knowledge` |

Do not make one Skill per Tool. Do not make one mega-Skill for the whole app.

## File

`.inupedia/skills/<id>/SKILL.md`

Required frontmatter shape:

```yaml
id: skill.items
name: <short host-language label>
description: <what user jobs this domain supports>
when_to_use: <user intents and exclusions, not implementation detail>
allowed-tools: getItemList, openItem, addItem
spotlight-response-strategy: tool_answer
capability-examples: <host-grounded examples>
# 0.7.5+: use this only for an exact, stable consumer contract when sibling
# Skills or Tools can interpret the same wording differently.
tool-examples: <exact utterance> => <registered Client Tool name>
```

`allowed-tools` must exactly match registered Client Tool exports.

`capability-examples` are semantic hints and still go through model routing. `tool-examples` are deterministic consumer contracts: after whitespace and punctuation normalization, an exact match selects the bound registered Tool before model routing. Use them for acceptance-critical phrases and genuinely ambiguous sibling Tools. The Server extracts an explicitly mentioned unique enum value directly; since 0.7.6, any remaining required arguments use structured extraction against that one preselected Tool, so the model cannot switch to a sibling Tool. Missing or invalid input still goes through the normal clarification fence.

## Body: intent-to-tool contract

Write only the intent families the host actually supports. A domain with read + named-open + mutation should say, in the host UI language:

```text
- list/count/status phrasing -> <readTool>; do not open or mutate
- open/view/play + exact named target -> <openTool>; preserve the user's target string
- add/update/remove phrasing + complete required args -> the exact mutation Tool
- missing target/quantity/required arg -> clarify; do not guess
- introduction/explanation/news -> do not call this Skill's Client Tools; use knowledge
- do not use this Skill for <nearest colliding domain>
```

For high-risk/gated host behavior that was not exposed, state the limitation when it helps prevent a near-match from selecting a safer-but-wrong Tool.

## Tool descriptions and schemas matter

The router receives Tool descriptions, `sideEffect`, risk metadata, and input schema. Make Tool names/descriptions semantic and schemas narrow enough that a generic router can distinguish:

- read-only Tool
- open-like UI Tool
- mutation Tool
- required arguments

Do not depend on a Server patch that recognizes this product by name.

When one Skill exposes both a no-argument catalog/list opener and a targetable open/play Tool, make that distinction explicit in their descriptions. Since 0.7.7, a named-target request that the model assigns to the catalog opener is corrected to the single targetable Tool, with the target copied into its preferred string input. This rule is generic and does not replace project catalog search or ambiguity handling.

Since 0.7.8, deployable project packs may also provide server-side named-target catalogs. Exact names and aliases are resolved before semantic Skill routing and produce a stable ID input for the bound Tool. Use this for camera channels or other large, dynamic entity sets: keep the catalog out of the LLM prompt, synchronize it from the system of record, and let the frontend Tool resolve only the returned ID.

## Knowledge Skill

`skill.knowledge`:

- `spotlight-response-strategy: direct_answer`
- no Client Tools
- body: public introductions/news use web search; only in-product unpublished facts use the project knowledge base; business nouns alone must not manipulate the live page

## Collision review

If two Skills could match the same utterance:

- identify catalog/domain boundaries in `when_to_use`;
- add a “do not use when ...” sentence to both;
- add a bait/negative row in [testing.md](../testing.md).

## Required examples

Use exact strings from the host repo. Include at least one example per supported intent family and one ambiguity/negative example when the domain can collide or lacks required parameters.
