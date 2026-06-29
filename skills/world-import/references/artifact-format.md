# Artifact format

The merge model emits artifact packets. The deterministic emitter renders them without interpreting domain semantics.

## Directories

- `world/people/`
- `world/places/`
- `world/things/`
- `world/facts/`

The `group` field chooses the directory. The emitter does not decide whether the group is semantically correct.

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

- [other-artifact-id](/people/other-artifact-id.md)

## Provenance

1. [`source-id/unit-id#b0001-b0002`](/sources/units/unit-id.md#b0001)
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

## Detail principle

**Progressive disclosure + cross-references for deduplication.** These artifacts are designed for vector search retrieval, but also for humans browsing the world library.

- Each artifact should be **useful when retrieved alone** — frontmatter `description` plus a Summary/Capsule section should give the gist before the reader reaches the denser sections.
- Use **`related` to avoid duplicating full event narratives** across artifacts. The full blow-by-blow of an event lives once under `facts/`. Character and place artifacts link to it via `related: ["event-id"]` rather than retelling the entire event.
- Include **narrative context in the entity's own artifact** (e.g., "Alice participated in the croquet game where the Queen ordered beheadings") and link to the fact artifact for the scene-by-scene detail.
- Use quotes and direct evidence generously.
- Keep sections substantive — a one-sentence section is a sign of over-summary.
- Cross-reference in both directions when helpful: fact artifacts should reference which characters/places were involved.

## Provenance

Every artifact needs at least one provenance ref. Prefer short quotes that establish the claim. When an artifact combines multiple sources, include multiple refs. Quote accuracy matters for the provenance dimension of evaluation.

The emitted bundle retains normalized source-unit pages under `world/sources/units/`. In v1, provenance links should resolve to those retained normalized source pages when available. Treat those as the canonical emitted citation target, while preserving original-source metadata separately.
