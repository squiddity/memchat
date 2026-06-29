---
name: world-import
description: Import HTML/XHTML directories, ZIPs, or EPUB-like archives into provenance-rich markdown world-library artifacts. Use when asked to create or update a world library from source text while preserving source spans. Semantic extraction and merge decisions belong to the model; helper commands only normalize sources, persist stage envelopes, read slices, and emit model-authored artifact packets.
---

# World Import

You are running a model-owned, provenance-preserving world import. Keep semantic judgment in this skill workflow. Do not ask helper commands to decide entities, aliases, relationships, conflicts, or merge identity.

## Philosophy: Build a rich, browseable, vector-search-ready world library

The world library is designed to be queried via **vector search and semantic retrieval**. This means balancing two goals:

### Standalone detail
Each artifact should be useful when retrieved in isolation via vector search. Characters need descriptions, personality, and narrative context. Places need atmosphere and significance. A user or agent should get meaningful context from a single artifact.

### Cross-references to avoid duplication
Use `related` links to avoid repeating the same full event narrative across every participant's artifact. The principle:

- A **character artifact** has the character's own content (description, personality, role, relationships) and a **summary** of their key events, then links via `related: ["croquet-game"]` to the fact artifact for full event detail.
- A **fact/event artifact** contains the complete narrative of the event (what happened, who, when, where, causes, consequences).
- A **place artifact** describes the place itself and summarizes events that occur there, linking to fact artifacts for full event narratives.

This way the full narrative lives once under `facts/` rather than being duplicated across every related character and place, but each artifact still carries enough standalone context to be useful on its own.

### Detail balance
- **Do** include rich descriptions, personality traits, relationships, and narrative context in each artifact.
- **Do** use `related` to point to fact artifacts for full event blow-by-blow, rather than retelling the entire event inside a character or place entry.
- **Do** give each artifact a Summary section that provides the gist without requiring related-link traversal.
- **Do not** over-summarize — characters should feel like real people, places should feel vivid, facts should feel substantive.
- **Do not** duplicate the same full event text across N character artifacts.

### Preserve evidence, don't distil it
When merging candidates about the same entity, combine all useful detail from every source rather than condensing into a bare summary. Multiple provenance refs are a feature, not a bug.

## Extraction guidance by entity type

### Characters / People
Extract for each character:
- **Physical description** — appearance, distinctive features
- **Personality traits** — temperament, habits, speech patterns
- **Role in narrative** — protagonist, antagonist, mentor, foil, etc.
- **Key actions and events** — what does this character DO in the story?
- **Relationships** — connections to other characters, how they interact
- **Character arc** — how they change or grow across the narrative
- **Dialogue and voice** — notable things they say, how they speak

### Places / Locations
Extract for each location:
- **Physical description** — what it looks like, feels like
- **Atmosphere and mood** — how it's described (foreboding, beautiful, etc.)
- **Narrative significance** — why this place matters to the story
- **Notable events** — what happens here
- **Visitors/inhabitants** — who goes there, who lives there
- **Symbolic meaning** — if the text suggests thematic significance

### Things / Objects
Extract for each notable object:
- **Physical description** — what it looks like
- **Significance** — why it matters to the story or characters
- **Possessor or user** — who has it, who wants it
- **Narrative context** — when and how it appears, what happens with it

### Facts / Events
Extract for each important fact or event:
- **What happened** — the event itself with detail
- **When and where** — temporal and spatial context
- **Who was involved** — participants, witnesses
- **Causes and consequences** — what led to it, what resulted
- **Narrative significance** — how it fits into the broader story

## Inputs

The user should provide JSON or text containing:

- `input`: path to an HTML/XHTML directory, `.zip`, or `.epub`-style archive.
- `output`: output root for normalized sources, stages, and `world/` markdown.
- `reviewerModel` optional: stronger model to recommend for review/eval.
- `dryRun` optional: validate setup without doing model extraction.
- `helperCommand` optional: exact helper command prefix to use, such as `npm run world-import-helper --` or `memchat-world-import-helper`.

If either `input` or `output` is missing, ask one focused question for the missing path.

## References

Read these before importing:

- `references/workflow.md` — command sequence and model-pass workflow.
- `references/contracts.md` — skill-owned candidate and artifact packet contracts.
- `references/artifact-format.md` — markdown output packet expectations and detail guidance.

## Helper commands

Prefer package scripts while developing this repo:

```bash
npm run world-import-helper -- normalize --input <input> --output <output>
npm run world-import-helper -- list-units --output <output>
npm run world-import-helper -- read-unit --output <output> --unit <unit-id>
npm run world-import-helper -- read-slice --output <output> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- write-extraction --output <output> --unit <unit-id> < stage.json
npm run world-import-helper -- write-merge --output <output> < merged-stage.json
npm run world-import-helper -- emit --output <output>
npm run world-import-helper -- eval --output <output> --reviewer-model <provider/model>
```

Installed-package users may call `memchat-world-import-helper` with the same arguments. If invocation arguments include `helperCommand`, use that exact prefix for all helper calls.

## Workflow summary

1. Normalize the input. Inspect manifest diagnostics before continuing.
2. For each normalized unit, read bounded text and produce an extraction stage envelope. **Extract rich, detailed candidates — not chapter summaries.** Preserve provenance spans for every candidate. Follow the entity-type guidance above.
3. Merge from staged candidates, not whole raw files. **Combine and preserve all useful detail from each candidate** rather than distilling to minimal summaries. Use `read-slice` only when candidate evidence is ambiguous or conflicting and only for the minimum anchor range needed.
4. Write a merge stage containing model-authored artifact packets with substantial, narrative-rich sections.
5. Emit markdown from the artifact packets.
6. If a reviewer model is configured, run the eval helper after emission; otherwise report that reviewer-model scoring was skipped.
7. Summarize outputs, diagnostics, and any uncertainty/disputes preserved in metadata or sections.

When `dryRun` is true, stop after normalization/listing and report whether the helper surface is available.
