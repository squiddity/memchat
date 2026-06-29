# World import workflow

The workflow is model-owned for semantic steps and helper-owned for deterministic operations.

## 0. Determine whether this is a new world or a maintained world

Before merging any new source material, inspect whether `<output>` already contains an emitted world bundle.

- **New world** — no prior bundle of interest exists. Proceed normally.
- **Maintained world** — prior world pages already exist and should be treated as world state to revise rather than output to discard mentally.

For a maintained world, inspect the existing `world/index.md`, relevant group indexes, affected artifact pages, `world/coverage.md`, `world/log.md`, and the prior `World Overview` / `Corpus Synopsis` artifact if present. There are not yet dedicated helper commands for all of this inspection, so use the emitted markdown files themselves together with the helper commands below.

## 1. Normalize

```bash
npm run world-import-helper -- normalize --input <input> --output <output>
```

Inspect the returned manifest. Stop on `error` diagnostics. Warnings such as skipped unsupported files should be reported but do not necessarily block import.

## 2. Extract candidates per bounded unit

List units:

```bash
npm run world-import-helper -- list-units --output <output>
```

For each unit:

```bash
npm run world-import-helper -- read-unit --output <output> --unit <unit-id>
```

Produce one extraction stage envelope per unit following `contracts.md`. Extract reusable world-canon candidates with source spans.

### Extraction detail guidelines

The world library will be used with **vector search and semantic retrieval**. Artifacts need to be **detailed and self-contained** to be useful when retrieved in isolation.

**Do not collapse everything into one summary blob.** Extract full, rich descriptions, but also preserve the material needed for a concise top-of-page summary/capsule later. For each entity or fact found in a unit, capture:

**Characters:**
- Full physical description from the text
- Personality traits as shown through actions and dialogue
- Role in this unit's events
- Key actions they take
- Relationships to others mentioned
- Dialogue excerpts that reveal character

**Places:**
- Full sensory description (look, feel, atmosphere)
- What happens in this place during this unit
- Who is present there
- Mood and significance

**Things:**
- Full description
- Context of appearance
- Who uses or possesses it
- Its role in events

**Facts/Events:**
- Full narrative detail of what happens
- Participant actions and reactions
- Temporal sequence
- Cause and effect
- Dialogue or direct speech that advances the event

Example good extraction (rich) vs poor extraction (too brief):

```
// POOR — too summary-like, loses detail:
{
  "id": "alice",
  "group": "people",
  "title": "Alice",
  "provenance": [...],
  "payload": { "description": "Alice is a curious girl who follows the White Rabbit." }
}

// GOOD — rich, retrievable, standalone:
{
  "id": "alice",
  "group": "people",
  "title": "Alice",
  "provenance": [...],
  "payload": {
    "description": "Alice is a young girl, evidently of an imaginative and curious disposition. She is shown sitting on a riverbank with her sister, feeling 'very sleepy and stupid' but is intrigued when she sees a White Rabbit with pink eyes who takes a watch out of his waistcoat pocket.",
    "personality": "Curious to the point of recklessness — she follows the Rabbit down the hole without hesitation. Also practical and level-headed for her age; she tries to make sense of the absurd situations she encounters.",
    "actionsInUnit": [
      "Sits bored on the riverbank with her sister",
      "Sees the White Rabbit and follows him",
      "Falls down the rabbit hole, observing her surroundings as she falls"
    ],
    "dialogue": "'Dear, dear! How queer everything is to-day! And yesterday things went on just as usual.'"
  }
}
```

### Merge rules

- Start from extraction candidates, not raw full text.
- **Combine all evidence** — when merging multiple candidates about the same entity, preserve all useful detail from every candidate. Do not condense.
- **Progressive disclosure:** every emitted artifact should support a one-line description plus a short summary/capsule at the top, then richer sections below.
- **Standalone summaries + cross-references for full detail.** Each artifact should have enough context to be useful when retrieved alone (via vector search), but use `related` links to avoid duplicating full event narratives across multiple entities. The full event blow-by-blow lives in a `facts` artifact — character and place artifacts summarize and link.
- Think of `related` as the deduplication mechanism: the croquet game gets one detailed fact artifact; Alice's entry links to it rather than retelling the entire scene.
- Prefer useful discovery metadata in the merge packet: `type`, a concise `description`, and tags when they materially help indexing.
- Preserve multiple provenance refs after merge.
- Emitted provenance will point to retained normalized source-unit markdown pages in the bundle. Preserve accurate `SourceSpanRef` data so those links can resolve cleanly.
- For maintained worlds, enrich existing artifacts when identity continuity is supported instead of cloning near-duplicates. If identity is uncertain, keep the ambiguity visible rather than forcing a merge.
- For maintained worlds, preserve prior provenance and make retcons/conflicts explicit in sections or metadata. Do not silently drop older evidence just because newer material exists.
- For substantive imports, include or update a `World Overview` / `Corpus Synopsis` artifact as a normal `facts` artifact. Revise it from prior overview + affected artifacts + new evidence, not from new input alone.
- Use `read-slice` for targeted rereads only when candidate evidence is insufficient.
- Do not invent facts to fill a taxonomy.
