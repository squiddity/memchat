# World import workflow

The workflow is model-owned for semantic steps and helper-owned for deterministic operations.

Optional stage hints set stopping points without moving semantic ownership into helper code:

- `full` or omitted — run the whole workflow in one session.
- `extract` — complete normalization and extraction stage writing, then stop.
- `merge` — inspect normalized sources, extraction stages, and existing world state; merge, emit, lint, repair, then stop before orchestrator-owned checkpoint review/eval.
- `repair` — read the orchestrator-provided `reviewPacket` for `checkpointId`/`iteration`, repair only grounded requested actions, re-emit/lint, and stop.
- `review` — inspect the emitted bundle, run/coordinate eval, and summarize findings.

## 0. Determine whether this is a new world or a maintained world

Before merging any new source material, inspect whether `<output>` already contains an emitted world bundle.

- **New world** — no prior bundle of interest exists. Proceed normally.
- **Maintained world** — prior world pages already exist and should be treated as world state to revise rather than output to discard mentally.

For a maintained world, inspect the existing `world/index.md`, relevant group indexes, affected artifact pages, `world/coverage.md`, `world/log.md`, and the prior `World Overview` / `Corpus Synopsis` artifact if present. Use emitted markdown files together with `coverage-plan`, `repair-summary`, and targeted source-reading helpers.

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

### Unit-local anchor rule

`bNNNN` anchors belong only to the `unit-id` that returned them. Do not treat them as document-global or infer them from a chapter number. The manifest's `order` includes frontmatter/title/contents units, so Chapter I may not be order 1. Never write a `chapter -> order -> unit` map or a batch of guessed anchor ranges. Select a unit from `list-units`, inspect that same unit's anchors, and generate each final span through a successful helper call. If `quote-ref` rejects a span, discard it and re-read that unit rather than shifting it to an adjacent unit or suppressing the error.

Use deterministic helpers for provenance spans:

```bash
npm run world-import-helper -- resolve-ref --output <output> --unit <unit-id> --start b0001 --end b0003
npm run world-import-helper -- quote-ref --output <output> --unit <unit-id> --start b0001 --end b0003 --as-ref
```

Produce one extraction stage envelope per unit following `contracts.md`. Extract reusable world-canon candidates with source spans. Prefer exact `quote-ref --as-ref` provenance over placeholder quote strings.

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
- **Inline traversal links on every concept page.** In every authored section body, mark each unambiguous mention of a durable emitted artifact with `[[artifact-id|reader-facing label]]`, including people, places, things, facts, and style pages. Use exact artifact ids, not paths. Preserve natural aliases and possessives in the label; do not link pronouns or ambiguous mentions, self-link the current artifact, or place markers inside existing Markdown links, URLs, code, or provenance quotes. The emitter resolves known ids to final relative Markdown links; unknown markers must remain visible for lint.
- Think of `related` as the deduplication mechanism: the croquet game gets one detailed fact artifact; Alice's entry links to it rather than retelling the entire scene.
- Prefer useful discovery metadata in the merge packet: `type`, a concise `description`, and tags when they materially help indexing.
- Preserve multiple provenance refs after merge. Use heading/title refs only as broad context; detailed people/place/thing/fact/style claims should have exact source evidence when possible.
- Emitted provenance will point to retained normalized source-unit markdown pages in the bundle. Preserve accurate `SourceSpanRef` data so those links can resolve cleanly. Use `resolve-ref` and `quote-ref --as-ref`; do not guess source ids or source hashes.
- For maintained worlds, enrich existing artifacts when identity continuity is supported instead of cloning near-duplicates. If identity is uncertain, keep the ambiguity visible rather than forcing a merge.
- For maintained worlds, preserve prior provenance and make retcons/conflicts explicit in sections or metadata. Do not silently drop older evidence just because newer material exists.
- For substantive imports, include or update first-class narrative surfaces as normal `facts` artifacts: a `Plot Synopsis` / `Corpus Synopsis`, a `Timeline`, and a `Scene Guide` / `Chapter Guide` / `Episode Guide` when the source has that structure. Revise them from prior overview + affected artifacts + new evidence, not from new input alone.
- Preserve source order in timelines and scene/chapter/episode guides.
- Give major scenes/chapters/episodes durable fact coverage or an explicit omission/disposition reason rather than leaving them only implied by entity pages.
- Give plot-critical objects durable `things` artifacts or an explicit omission/disposition reason rather than silently flattening them into character summaries.
- Account for every extraction candidate through merge: list represented candidate ids on artifacts, or add a merge-level disposition of `represented`, `merged`, `deferred`, or `dropped`. Deferred/dropped candidates need a model-authored reason so omissions remain auditable.
- Add model-authored `style` artifacts when voice, tone, aphorisms/formulae, parody/poem mechanics, or character voice guidance would help future reuse. Cite source spans for style claims like any other artifact.
- Before finalizing, check whether every major source set-piece needed for reconstruction has a durable fact/event artifact or an explicit, reviewable omission reason.
- Apply inline artifact markers to clear mentions in entity, place, object, event, synopsis, timeline, guide, and style prose; `related` lists complement these links and do not replace them.
- Use `read-slice` for targeted rereads only when candidate evidence is insufficient.
- Do not invent facts to fill a taxonomy.

## 3. Merge writing and coverage planning

### Persist-first merge protocol

A merge session must create durable progress before it spends substantial time on synopsis prose, full-source rereads, or automation design:

1. Inspect complete extraction payloads once in manifest source order (never lexicographic shell-glob order) and choose canonical ids/identity consolidations.
2. If a merge stage already exists, treat it as the resume checkpoint; preserve valid artifacts and identify only unfinished groups/candidates.
3. Write the first bounded artifact batch promptly. Continue in batches of roughly 5-12 model-authored packets.
4. Build core people, places, things, facts, and style coverage plus candidate accounting before polishing synopsis/timeline/guide surfaces.
5. Run coverage after durable batches and use its compact counts to choose the next batch.

Use atomic batch writes instead of giant merge JSON heredocs or executable generators:

```bash
npm run world-import-helper -- write-artifacts --output <output> --mode upsert --file artifacts.json
npm run world-import-helper -- validate-artifact --output <output> --file artifact.json
npm run world-import-helper -- write-artifact --output <output> --mode upsert --file artifact.json
```

`artifacts.json` is a JSON array. All ids in the batch are treated as planned targets during validation, so cross-links within the batch do not require a huge `--planned-ids` argument. The helper writes nothing unless every packet validates. It does not choose ids, merge identities, groups, prose, links, or dispositions.

Do not write JavaScript/Python/shell programs that embed artifact prose, and do not postpone all persistence until one monolithic packet is complete. If a later batch fails, keep and resume from earlier valid batches.

Before final emission, inspect deterministic coverage:

```bash
npm run world-import-helper -- coverage-plan --output <output>
```

Use coverage diagnostics to decide model-authored repairs: add artifacts, add provenance, add represented candidate ids, or add candidate dispositions with reasons.

## 4. Coverage repair loop

After writing artifacts, run the deterministic emit/lint loop:

```bash
npm run world-import-helper -- emit-lint-repair-loop --output <output>
```

If there are diagnostics, inspect the repair summary:

```bash
npm run world-import-helper -- repair-summary --output <output>
```

For each diagnostic, repair semantically rather than obeying blindly:

- unresolved `related` ids or `[[wikilinks]]`: create the intended artifact, rename the link to the emitted id, remove the link, or explain why the unresolved reference should remain visible;
- provenance/source-anchor failures: fix the cited span or rerun normalization/emission if retained source pages are stale;
- unaccounted candidates: represent them, merge them into a broader artifact, defer them, or drop them with a reason;
- body coverage gaps: inspect the source unit and extraction stage, then add missing artifacts or record why no durable artifact is warranted.

Re-emit and re-run lint after repairs. Lint diagnoses structural/accounting facts; it does not decide ontology, canon importance, prose quality, or whether a drop reason is semantically persuasive.

## 5. Provenance quality repair

After structural lint is clean, audit provenance quality:

```bash
npm run world-import-helper -- provenance-audit --output <output> --format markdown --write
```

Prioritize heading-only refs on important artifacts, style artifacts with too few examples, long artifacts with one ref, fact/event pages citing only story headings, and reviewer-identified weak examples.

To locate better evidence, use exact search first:

```bash
npm run world-import-helper -- find-text --output <output> --query "distinctive phrase" --context 2
```

For paraphrased claims, use lexical candidate search:

```bash
npm run world-import-helper -- suggest-ref-candidates \
  --output <output> \
  --artifact <artifact-id> \
  --claim "claim text needing support"
```

Then generate exact refs with `quote-ref --as-ref` and repair provenance using `patch-merge` or `write-artifact`. Do not blindly rewrite artifact prose just to satisfy audit density; better provenance means claim-supporting evidence, not maximum citation count.

## 6. Staged readiness and post-merge checkpoint repair

In staged mode, the TypeScript runner first assesses deterministic merge readiness. A merge is not ready merely because one Markdown file exists: the merge must be non-empty and parseable, emission and lint must pass, and coverage/candidate accounting must have no errors. The runner persists bounded diagnostic packets such as:

- `stages/checkpoints/merge-readiness-01.review.json`
- `stages/checkpoints/merge-readiness-02.review.json`
- `stages/repair-summary.md`

A `merge-readiness` repair invocation must resume the durable merge, preserve valid artifacts, and address only the packet's structural/accounting blockers. It must not restart extraction, discard valid groups, or invent a recursive retry loop. The TypeScript runner reassesses after the repair and stops on readiness, unchanged diagnostics, or budget exhaustion.

After readiness passes, the runner can run a focused semantic post-merge review before final eval. It persists packets such as:

- `stages/checkpoints/post-merge-01.review.json`
- `stages/checkpoints/post-merge-01.repair.json`

The review packet may request bounded repairs for missing narrative surfaces, plot-critical object/prop pages, hidden candidate omissions, or weak provenance. Treat those requests as model-owned semantic guidance, not helper decisions.

When invoked as `stage: "repair"`:

1. Read the provided `reviewPacket` and current `stages/merge/merged-candidates.json` plus emitted `world/` pages.
2. Address only grounded `requestedActions`; do not redo extraction or the whole merge.
3. Use source-reading helpers (`read-slice`, `find-text`, `suggest-ref-candidates`, `quote-ref --as-ref`) when the packet says to reread source or when evidence is insufficient.
4. Update merge artifacts with `write-artifacts`, `write-artifact`, or `patch-merge` only as needed, preserving candidate accounting and provenance.
5. Re-emit and run lint/repair-summary. Report which requested actions were attempted and which remain residual.

The orchestrator owns loop bounds and final status. Before repair it records target artifact hashes for `strengthen-artifact` and `strengthen-provenance` actions. After readiness re-emits the durable merge, it may mark those actions `verified-structural` only when the artifact changed, requested source spans are represented, emitted Markdown/indexes are current, and scoped lint is clean. This is not a semantic quality verdict; final reviewer evaluation remains responsible for judging whether the strengthened prose or evidence is adequate. The repair model must not start another unbounded review/repair loop.

## 7. Helper anti-patterns

If you find yourself doing any of these, stop and use `references/helper-tools.md`:

- writing Python or shell functions named `sid`, `uid`, or `ref`;
- hard-coding source-hash maps from manifest rows;
- mapping chapter numbers to manifest orders or using precomputed cross-unit anchor ranges;
- suppressing `quote-ref`/`resolve-ref` failures in a batch loop instead of correcting the specific unit/span;
- using placeholder quote text in final artifacts;
- rewriting the entire merge stage to fix one provenance reference;
- declaring success without lint/coverage checks.
