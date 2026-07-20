---
name: world-import
description: Legacy shell-runner workflow for provenance-rich Markdown world imports. Invoke explicitly for CLI compatibility, staged runner debugging, or legacy helper operation.
disable-model-invocation: true
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

### Inline artifact links

Make every model-authored concept page a traversable wiki page, not just a page with a `Related` list. In every substantive section body under `people`, `places`, `things`, `facts`, or `style`, mark each unambiguous mention of another durable emitted artifact with an id-based inline marker:

```md
[[victor-frankenstein|Victor Frankenstein]] abandons [[the-creature|the creature]] at [[ingolstadt|Ingolstadt]].
```

Use the exact artifact id, not a title, filename, or relative path. The optional label preserves natural wording, aliases, capitalization, and possessives. The emitter resolves known markers to portable relative Markdown links after it has planned final paths. Do not invent links for pronouns or ambiguous common nouns, do not self-link an artifact, and do not put markers inside existing Markdown links, URLs, code, or provenance quotes. Leave `related` links in place as structured navigation; inline links complement them rather than replace them. Unknown markers remain visible for lint to report, so do not silently remove a reference to an intended artifact.

This applies equally to plot synopsis/timeline/scene-guide pages and to individual entity, event, object, place, and style pages. For maintained worlds, preserve stable existing ids when identity continuity is supported so existing inline references continue to resolve.

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

### Required helper posture

Do **not** write ad hoc Python or shell scripts to invent source ids, unit ids, anchor validation, provenance refs, or giant merge JSON packets. Use deterministic helper commands for deterministic work:

- `resolve-ref` to build canonical source/unit/anchor refs from the manifest.
- `quote-ref --as-ref` to populate exact provenance quotes.

### Anchor and source-order safety (mandatory)

Anchors are **local to one normalized unit**, not global chapter or document line numbers. Never infer an anchor range from chapter number, prose length, a neighboring unit, or a prior run. EPUBs commonly place title, contents, license, or other frontmatter units before Chapter I, so a chapter number is not a manifest `order` value.

Before requesting any provenance span, identify its exact `unitId` from `list-units`/the manifest, then read that specific unit (or use its manifest `anchors`) and use only anchors returned for it. Do not construct shell/Python maps such as `chapter -> manifest order -> unitId`, and do not batch hard-coded `bNNNN` ranges across units. For each selected span, call `quote-ref --as-ref` (or `resolve-ref` then `quote-ref`) against its exact unit; its successful result is the only authority for the final ref.

If a helper reports an unknown anchor, source mismatch, or invalid span, stop using that proposed span. Re-read/list the specific unit and select a valid span; do not suppress the failure in a shell loop, shift the unit/order heuristically, or persist the invalid ref.
- `validate-artifact` before adding complex artifacts.
- `write-artifact` to add or replace one artifact, or `write-artifacts` to atomically persist a bounded JSON array.
- `coverage-plan` after durable batches and before final merge review.
- `emit-lint-repair-loop` before declaring success.
- `repair-summary` to turn diagnostics into a model-actionable checklist.
- `provenance-audit` after clean lint to find structurally valid but weak citations.
- `find-text` and `suggest-ref-candidates` to locate precise evidence before reading whole units during provenance repair.

Ad hoc scripts are acceptable only for one-off inspection that has no corresponding helper. If you find yourself coding `sid()`, `uid()`, `ref()`, source hash maps, anchor checks, or merge-stage rewrite loops, stop and use the helper surface documented in `references/helper-tools.md`.

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

### Narrative / plot surfaces for substantive narrative corpora

When the source is a substantive narrative corpus (novel, play, saga, episode/chapter sequence, or similarly plot-driven work), the emitted bundle should support a reader who wants to understand the story in order before drilling into entity pages.

For these imports, author normal artifact packets — usually under `group: facts` — for the following surfaces when the source supports them:

- **Plot Synopsis** or **Corpus Synopsis** — a browsable start-here page for the overall story.
- **Timeline** — ordered major beats in source order.
- **Scene Guide / Chapter Guide / Episode Guide** — a navigable breakdown of the source structure.
- **Act Summary / Chapter Summary / Episode Summary** pages when the source naturally has those divisions.
- **Plot-critical object coverage** — durable `things` artifacts for major props, documents, tokens, weapons, poisons, letters, keepsakes, or other objects that materially affect the plot.

Keep this semantic and model-owned: TypeScript helpers may route and promote these artifacts, but they do not generate the prose, decide whether a scene is important, or infer object significance.

Contract details:

- Use existing groups only. Do **not** invent a new `plot` group; route narrative surfaces through normal artifact packets, most often `group: facts`, with clear `type`, `description`, tags, and optional metadata.
- Preserve source order in timeline and scene/chapter/episode guide pages.
- Link narrative surfaces to relevant people, places, things, facts, and style pages via `related` plus inline artifact markers for every clear mention in the authored prose.
- Do not hide the whole story inside only `world-overview`; the plot synopsis, timeline, and scene/chapter guide should be first-class browseable pages.
- Major scenes/chapters/episodes and plot-critical objects should get dedicated pages or an explicit omission/disposition reason. Do not silently flatten them away into broad character pages.

## Inputs

The user should provide JSON or text containing:

- `input`: path to an HTML/XHTML directory, `.zip`, or `.epub`-style archive.
- `output`: output root for normalized sources, stages, and `world/` markdown.
- `reviewerModel` optional: stronger model to recommend for review/eval.
- `dryRun` optional: validate setup without doing model extraction.
- `stage` optional: orchestration hint for `extract`, `merge`, `repair`, `review`, or `full`. If omitted, run the full workflow. Treat stages as stopping points, not as deterministic semantic ownership by helper code.
- Repair-stage fields, used only with `stage: "repair"`: `checkpointId`, `reviewPacket`, and `iteration`. The repair stage must read the persisted checkpoint packet, address only its grounded requested actions, update model-authored merge artifacts, re-emit/lint, and report attempted/residual work.
- `helperCommand` optional: exact helper command prefix to use, such as `npm run world-import-helper --` or `memchat-world-import-helper`.

If either `input` or `output` is missing, ask one focused question for the missing path.

## References

Read these before importing:

- `references/workflow.md` — command sequence and model-pass workflow.
- `references/contracts.md` — skill-owned candidate and artifact packet contracts.
- `references/artifact-format.md` — markdown output packet expectations and detail guidance.
- `references/helper-tools.md` — deterministic helper command cheat sheet for provenance refs, artifact writing, coverage, lint repair, and anti-patterns.

## Helper commands

Prefer package scripts while developing this repo:

```bash
npm run world-import-helper -- normalize --input <input> --output <output>
npm run world-import-helper -- list-units --output <output>
npm run world-import-helper -- read-unit --output <output> --unit <unit-id>
npm run world-import-helper -- read-slice --output <output> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- resolve-ref --output <output> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- quote-ref --output <output> --unit <unit-id> --start <anchor> --end <anchor> --as-ref
npm run world-import-helper -- validate-artifact --output <output> --file artifact.json
npm run world-import-helper -- write-artifact --output <output> --mode upsert --file artifact.json
npm run world-import-helper -- write-artifacts --output <output> --mode upsert --file artifacts.json
npm run world-import-helper -- coverage-plan --output <output>
npm run world-import-helper -- repair-summary --output <output>
npm run world-import-helper -- provenance-audit --output <output> --format markdown --write
npm run world-import-helper -- find-text --output <output> --query <phrase> --context 2
npm run world-import-helper -- suggest-ref-candidates --output <output> --artifact <artifact-id> --claim <claim-text>
npm run world-import-helper -- emit-lint-repair-loop --output <output>
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
- `merge` — inspect normalized sources, extraction stages, and any existing world bundle; complete steps 3-9, then stop before orchestrator-owned post-merge review/eval.
- `repair` — read `reviewPacket` for `checkpointId`/`iteration`, inspect current merge/emitted state, perform only requested model-owned repairs, re-emit/lint, and stop.
- `review` — inspect the emitted bundle, run/coordinate eval, and summarize findings.

1. Normalize the input. Inspect manifest diagnostics and the complete ordered unit listing before continuing. Treat `order` as source-file order, not as a chapter number; retain title/frontmatter units in that listing.
2. For each normalized unit, read bounded text and produce an extraction stage envelope. **Extract rich, detailed candidates — not chapter summaries.** Preserve provenance spans for every candidate. Anchors must come from that exact unit only: do not transfer `bNNNN` values or map chapter labels to manifest order with an ad hoc script. Obtain each final span through a successful `quote-ref --as-ref`/`resolve-ref` call. In staged extraction, explicitly consider minor named entities, plot-critical props/documents, and poems/songs/parodies or other style surfaces; if a mention is too minor for a standalone page, still preserve a candidate or a later model-authored disposition note rather than silently losing it. Follow the entity-type guidance above.
3. If the output already contains an emitted world bundle and this is not a dry run, inspect the existing world indexes, affected artifacts, coverage, log, and any existing `World Overview` / `Corpus Synopsis` artifact before merging new material.
4. Merge from staged candidates, not whole raw files. **Combine and preserve all useful detail from each candidate** rather than distilling to minimal summaries. Inspect the complete candidate payloads once in manifest source order (not shell-glob filename order), choose canonical artifact ids and identity consolidations, then begin persistence; do not repeatedly project away payload fields or reread full units before the first write. Use `read-slice` only when candidate evidence is ambiguous or conflicting and only for the minimum anchor range needed. For maintained worlds, enrich existing artifacts when evidence supports continuity, preserve older provenance unless it is superseded or contested, and keep retcons/conflicts visible rather than silently flattening them. For every dropped candidate, explain why its content remains discoverable in a broader artifact or why standalone omission is acceptable.
5. **Persist before polishing.** Treat the first durable merge write as the first merge milestone, not the last. Resume an existing merge in place and preserve its valid artifacts. Write model-authored artifacts as small JSON batches (normally 5-12 packets) with `write-artifacts --mode upsert`; use `write-artifact` for isolated repairs. A batch may reference every id in that same batch without a giant `--planned-ids` argument. Do not generate executable JavaScript/Python, shell heredoc programs, or one enormous merge packet to manufacture prose. After each meaningful batch, continue from the persisted artifact count rather than restarting strategy. Build core people/place/thing/fact/style coverage and candidate accounting before spending substantial time on corpus synopsis/timeline/guide polish.
6. Use `resolve-ref` and `quote-ref --as-ref` for provenance rather than guessing source ids or writing source-id mapping scripts. Artifact packets should have substantial, narrative-rich sections plus useful discovery metadata such as `type`, `description`, and tags when appropriate. Include candidate disposition accounting: every extraction candidate should be represented by artifact metadata, merged into a broader artifact, deferred, or dropped with a model-authored reason. For substantive imports, include or update a corpus-level `Plot Synopsis` / `Corpus Synopsis`, plus a `Timeline` and `Scene Guide` / `Chapter Guide` / `Episode Guide`, as normal model-authored packets rather than relying on the emitter to summarize the world. Add model-authored `style` artifacts when narrative voice, tone, aphorisms/formulae, parody/poems, or character voice notes are useful for reuse.
7. Run `coverage-plan` after durable batches and before final emission to inspect group coverage, unit coverage, retained source pages, and candidate accounting. Repair omissions semantically or record model-authored dispositions.
8. Emit markdown from the artifact packets and expect provenance links to resolve to retained normalized source-unit pages when those pages are available.
9. Run deterministic `emit-lint-repair-loop` or `lint` plus `repair-summary`. Treat diagnostics as evidence for repair, not ontology: create missing artifacts, fix/remove unresolved links, add candidate dispositions, improve source coverage, or explicitly justify acceptable omissions in metadata/sections. Re-emit and re-lint after repairs.
10. Run `provenance-audit` before eval or before declaring high-quality success. Clean lint is necessary but not sufficient: heading/title refs can identify story context, but should not be the sole evidence for detailed people/place/thing/fact/style claims. Long synopsis, timeline, and chapter-guide pages need evidence distributed through their substantive sections, not only bookend citations. Use `find-text`, `suggest-ref-candidates`, and `quote-ref --as-ref` to add or replace weak refs without blindly rewriting semantic prose.
11. In staged orchestration, the TypeScript runner inserts deterministic `merge-readiness` checkpoints before semantic review and may insert a focused post-merge reviewer checkpoint afterward. If invoked with `stage: "repair"`, first read the supplied checkpoint packet. For `merge-readiness`, resume the current merge, preserve valid durable artifacts, and resolve the listed lint/coverage/accounting blockers; do not restart extraction or redesign the whole merge. For `post-merge`, repair only its grounded semantic actions (for example missing `things`, missing plot surfaces, hidden omissions, or sparse provenance). Re-emit and re-lint before returning. The orchestrator owns retry bounds, so never start a recursive repair loop inside the model session.
12. If a reviewer model is configured, run the final eval helper after emission/lint/provenance-audit and any bounded checkpoint repair; otherwise report that reviewer-model scoring was skipped.
13. Summarize outputs, lint diagnostics, provenance-audit warnings, checkpoint repair/residual status, candidate dispositions, style-guide coverage, and any uncertainty/disputes preserved in metadata or sections.

When `dryRun` is true, stop after normalization/listing and report whether the helper surface is available.
