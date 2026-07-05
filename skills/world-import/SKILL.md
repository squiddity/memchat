---
name: world-import
description: Import HTML/XHTML directories, ZIPs, or EPUB-like archives into provenance-rich markdown world-library artifacts. Use when asked to create or update a world library from source text while preserving source spans. Semantic extraction and merge decisions belong to the model; helper commands only normalize sources, persist stage envelopes, read slices, and emit model-authored artifact packets.
---

# World Import

You are running a model-owned, provenance-preserving world import. Keep semantic judgment in this skill workflow. Do not ask helper commands to decide entities, aliases, relationships, conflicts, merge identity, world-overview prose, or update/retcon decisions.

## Philosophy: Build a rich, browseable, vector-search-ready world library

The world library is designed to be queried via **vector search and semantic retrieval**. This means balancing two goals:

### Standalone detail
Each artifact should be useful when retrieved in isolation via vector search. Characters need descriptions, personality, and narrative context. Places need atmosphere and significance. A user or agent should get meaningful context from a single artifact.

### Progressive disclosure
Do not force a choice between brevity and completeness. Each artifact should have layers:

- **Frontmatter metadata** such as `type`, `title`, and a one-line `description` for indexes and previews.
- A **short summary/capsule section** that tells a reader what this artifact is in a few lines.
- **Detailed sections** below that preserve the rich evidence, relationships, and narrative context.

This lets the top of the page stay skimmable while the full artifact stays substantive.

### Cross-references to avoid duplication
Use `related` links to avoid repeating the same full event narrative across every participant's artifact. The principle:

- A **character artifact** has the character's own content (description, personality, role, relationships) and a **summary** of their key events, then links via `related: ["croquet-game"]` to the fact artifact for full event detail.
- A **fact/event artifact** contains the complete narrative of the event (what happened, who, when, where, causes, consequences).
- A **place artifact** describes the place itself and summarizes events that occur there, linking to fact artifacts for full event narratives.

This way the full narrative lives once under `facts/` rather than being duplicated across every related character and place, but each artifact still carries enough standalone context to be useful on its own.

### Detail balance
- **Do** include rich descriptions, personality traits, relationships, and narrative context in each artifact.
- **Do** provide `type`, a concise `description`, and useful tags when they genuinely help discovery.
- **Do** use `related` to point to fact artifacts for full event blow-by-blow, rather than retelling the entire event inside a character or place entry.
- **Do** give each artifact a Summary or Capsule section that provides the gist without requiring related-link traversal.
- **Do not** over-summarize — characters should feel like real people, places should feel vivid, facts should feel substantive.
- **Do not** duplicate the same full event text across N character artifacts.

### Preserve evidence, don't distil it
When merging candidates about the same entity, combine all useful detail from every source rather than condensing into a bare summary. Multiple provenance refs are a feature, not a bug.

### Provenance target for v1
The emitted bundle retains normalized source-unit markdown pages under `world/sources/units/`. Treat those retained normalized source pages as the canonical v1 citation target for emitted provenance links. Normalized anchors are paragraph/poem/pre source blocks when structure is available; preserve those fine-grained spans instead of citing whole chapters. Original EPUB/HTML layout fidelity may be partial; preserve original-path diagnostics, but portable source ids should not depend on local absolute paths.

### New world vs maintained world
Treat a fresh import and an update to an existing world as different postures:

- **New world** — create the initial artifact set from the normalized source units.
- **Maintained world** — inspect the existing emitted bundle first and treat it as world state to revise, not disposable output to ignore.

For maintained worlds:

- Read `world/index.md`, relevant group indexes, the existing `World Overview` / `Corpus Synopsis` artifact if present, and affected artifact pages before deciding how new source material changes the world.
- Preserve prior provenance, source history, and uncertainty unless new evidence justifies revision.
- Prefer enriching an existing artifact when identity continuity is supported; create a new artifact when identity is genuinely uncertain.
- Preserve conflicts and retcons visibly in sections such as `Uncertainty`, `Open Questions and Conflicts`, or equivalent project-owned headings rather than silently flattening them.

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

Major chapter set-pieces usually deserve durable `facts` artifacts when needed for source reconstruction. Use `related` links from characters/places to avoid duplicated full narration, but do not silently leave a major scene recoverable only from a broad overview.

## Inputs

The user should provide JSON or text containing:

- `input`: path to an HTML/XHTML directory, `.zip`, or `.epub`-style archive.
- `output`: output root for normalized sources, stages, and `world/` markdown.
- `reviewerModel` optional: stronger model to recommend for review/eval.
- `dryRun` optional: validate setup without doing model extraction.
- `stage` optional: orchestration hint for `extract`, `merge`, `review`, or `full`. If omitted, run the full workflow. Treat stages as stopping points, not as deterministic semantic ownership by helper code.
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
npm run world-import-helper -- lint --output <output>
npm run world-import-helper -- eval --output <output> --reviewer-model <provider/model>
```

Installed-package users may call `memchat-world-import-helper` with the same arguments. If invocation arguments include `helperCommand`, use that exact prefix for all helper calls.

## Workflow summary

Stage hints are optional orchestration boundaries:

- `full` or omitted — run the whole workflow below in one session.
- `extract` — complete steps 1-2, write extraction stages, then stop before merge.
- `merge` — inspect normalized sources, extraction stages, and any existing world bundle; complete steps 3-7, then stop before review/eval.
- `review` — inspect the emitted bundle, run/coordinate eval, and summarize findings.

1. Normalize the input. Inspect manifest diagnostics before continuing.
2. For each normalized unit, read bounded text and produce an extraction stage envelope. **Extract rich, detailed candidates — not chapter summaries.** Preserve provenance spans for every candidate. Follow the entity-type guidance above.
3. If the output already contains an emitted world bundle and this is not a dry run, inspect the existing world indexes, affected artifacts, coverage, log, and any existing `World Overview` / `Corpus Synopsis` artifact before merging new material.
4. Merge from staged candidates, not whole raw files. **Combine and preserve all useful detail from each candidate** rather than distilling to minimal summaries. Use `read-slice` only when candidate evidence is ambiguous or conflicting and only for the minimum anchor range needed. For maintained worlds, enrich existing artifacts when evidence supports continuity, preserve older provenance unless it is superseded or contested, and keep retcons/conflicts visible rather than silently flattening them.
5. Write a merge stage containing model-authored artifact packets with substantial, narrative-rich sections plus useful discovery metadata such as `type`, `description`, and tags when appropriate. Include candidate disposition accounting: every extraction candidate should be represented by artifact metadata, merged into a broader artifact, deferred, or dropped with a model-authored reason. For substantive imports, include or update a corpus-level `World Overview` artifact as a normal model-authored packet rather than relying on the emitter to summarize the world. Add model-authored `style` artifacts when narrative voice, tone, aphorisms/formulae, parody/poems, or character voice notes are useful for reuse.
6. Emit markdown from the artifact packets and expect provenance links to resolve to retained normalized source-unit pages when those pages are available.
7. Run deterministic `lint`. Treat diagnostics as evidence for repair, not ontology: create missing artifacts, fix/remove unresolved links, add candidate dispositions, improve source coverage, or explicitly justify acceptable omissions in metadata/sections. Re-emit and re-lint after repairs.
8. If a reviewer model is configured, run the eval helper after emission/lint; otherwise report that reviewer-model scoring was skipped.
9. Summarize outputs, lint diagnostics, candidate dispositions, style-guide coverage, and any uncertainty/disputes preserved in metadata or sections.

When `dryRun` is true, stop after normalization/listing and report whether the helper surface is available.
