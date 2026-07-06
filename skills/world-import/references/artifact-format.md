# Artifact format

The merge model emits artifact packets. The deterministic emitter renders them without interpreting domain semantics.

## Directories

- `world/people/`
- `world/places/`
- `world/things/`
- `world/facts/`
- `world/style/`

The `group` field chooses the directory. The emitter does not decide whether the group is semantically correct. A corpus-level `World Overview` / `Corpus Synopsis` is still a normal model-authored artifact and can live under `world/facts/`. Style pages are also normal model-authored artifacts; TypeScript routes and validates them but does not generate voice/tone analysis.

## Markdown shape

Each artifact becomes one markdown file:

```markdown
---
id: "artifact-id"
group: people
type: "Character"
title: "Artifact title"
description: "One-line capsule used for indexes and previews."
tags: ["character"]
related: ["other-id"]
---

# Artifact title

## Summary

Brief overview of who or what this is.

## Description

Rich, detailed description drawn from source passages. Include physical descriptions, personality traits, sensory details, and narrative context. Make this detailed enough that someone reading only this artifact can understand the entity fully.

## Role in Narrative

How this entity functions in the story. What actions do they take? What role do they play? How do they drive events forward?

## Relationships

Detailed connections to other entities. For each relationship, include the nature of the relationship, relevant events that demonstrate it, and supporting quotes.

## Key Events

Important narrative events involving this entity, in chronological order where possible. Include context about what happened, who else was involved, and the significance.

## Uncertainty

Optional: any ambiguity, disputes, or gaps in knowledge about this entity. This is where contradictions or weak evidence should be preserved rather than silently resolved.

## Related

- [other-artifact-id](other-artifact-id.md)

## Provenance

1. [`source-id/unit-id#b0001-b0002`](../sources/units/unit-id.md#b0001)
   > Supporting quote.
```

## Guidance for sections

### People (characters)

Recommended sections:
- **Summary** — who they are at a glance
- **Description** — appearance, age, distinguishing features, clothing
- **Personality** — temperament, habits, values, speech patterns, how others perceive them
- **Role in Narrative** — protagonist, antagonist, mentor, foil, comic relief, etc.
- **Relationships** — connections to other characters with evidence
- **Key Events** — narrative events they participate in, with context
- **Dialogue** — notable quotes that reveal character
- **Character Arc** — how they change over the course of the story
- **Uncertainty**

### Places

Recommended sections:
- **Summary**
- **Description** — physical layout, appearance, sensory details
- **Atmosphere** — mood, emotional tone, how it feels to be there
- **Notable Events** — what happens in this location
- **Visitors & Inhabitants** — who goes there
- **Significance** — why this place matters to the narrative
- **Uncertainty**

### Things

Recommended sections:
- **Summary**
- **Description** — appearance, material, design
- **Significance** — why it matters
- **Possessor & Use** — who has it, who wants it, what it's used for
- **Narrative Context** — when and how it appears in the story
- **Uncertainty**

### Facts

Recommended sections:
- **Summary**
- **What Happened** — detailed account of the event
- **Participants** — who was involved and their actions
- **Cause & Effect** — what led to this event and what resulted
- **Setting** — when and where it occurred
- **Significance** — how it fits into the broader narrative
- **Uncertainty**

### Style guides

Recommended sections:
- **Summary** — what style feature this page captures
- **Narrative Voice** — narrator stance, address, syntax, rhythm, and recurring rhetorical moves
- **Tone** — comic, ominous, formal, absurd, lyrical, satirical, etc., with evidence
- **Aphorisms & Formulae** — recurring phrases, maxims, rules, nonsense logic, or verbal formulas
- **Poems & Parodies** — catalog poems, songs, parody mechanics, typography, lineation, and source spans
- **Character Voice Notes** — character-specific diction, rhythm, catchphrases, and dialogue examples
- **Source Examples** — quoted source spans with concise explanation
- **Uncertainty**

### World overview / corpus synopsis

Recommended sections:
- **Current Synopsis** — the current story-so-far or world-state overview
- **Major Characters** — linked summary of the most important people
- **Major Places** — linked summary of major settings
- **Timeline / Story So Far** — high-level sequence of consequential events
- **Open Questions and Conflicts** — visible contradictions, retcons, or unresolved continuity
- **Provenance Notes** — optional notes on how older and newer evidence interact

## Detail principle

**Progressive disclosure + cross-references for deduplication.** These artifacts are designed for vector search retrieval, but also for humans browsing the world library.

- Each artifact should be **useful when retrieved alone** — frontmatter `description` plus a Summary/Capsule section should give the gist before the reader reaches the denser sections.
- Use **`related` to avoid duplicating full event narratives** across artifacts. The full blow-by-blow of an event lives once under `facts/`. Character and place artifacts link to it via `related: ["event-id"]` rather than retelling the entire event.
- Include **narrative context in the entity's own artifact** (e.g., "Alice participated in the croquet game where the Queen ordered beheadings") and link to the fact artifact for the scene-by-scene detail.
- Use quotes and direct evidence generously.
- Keep sections substantive — a one-sentence section is a sign of over-summary.
- Cross-reference in both directions when helpful: fact artifacts should reference which characters/places were involved.
- A `World Overview` / `Corpus Synopsis` should link out to the detailed entity/event artifacts it summarizes; it is not a replacement for them.

## Provenance

Every artifact needs at least one provenance ref. Prefer short quotes that establish the claim. When an artifact combines multiple sources, include multiple refs. Quote accuracy matters for the provenance dimension of evaluation.

Use helper commands while drafting provenance:

```bash
npm run world-import-helper -- resolve-ref --output <output> --unit <unit-id> --start b0001 --end b0002
npm run world-import-helper -- quote-ref --output <output> --unit <unit-id> --start b0001 --end b0002 --as-ref
```

Do not leave placeholder quote strings such as `[Source span b0001-b0002]` in final artifacts. Use `quote-ref --as-ref` to fill `quote` with exact normalized source text.

The emitted bundle retains normalized source-unit pages under `world/sources/units/`. In v1, provenance links should resolve to those retained normalized source pages when available. Treat those as the canonical emitted citation target, while preserving original-source metadata separately. Prefer paragraph/poem/pre anchors over whole-chapter citations when normalization exposes them.

For maintained worlds, overview artifacts and revised entity/event pages should preserve older provenance where it still matters and make continuity changes explicit rather than silently rewriting history.

## Incremental artifact writing

Prefer writing artifacts one at a time:

```bash
npm run world-import-helper -- validate-artifact --output <output> --file artifact.json
npm run world-import-helper -- write-artifact --output <output> --mode upsert --file artifact.json
```

Before final output, run:

```bash
npm run world-import-helper -- coverage-plan --output <output>
npm run world-import-helper -- emit-lint-repair-loop --output <output>
```

If diagnostics remain, use `repair-summary` for a concise checklist. See `helper-tools.md` for command details and anti-patterns.
