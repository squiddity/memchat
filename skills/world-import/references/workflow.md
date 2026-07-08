# World import workflow

The workflow is model-owned for semantic steps and helper-owned for deterministic operations.

Optional stage hints set stopping points without moving semantic ownership into helper code:

- `full` or omitted — run the whole workflow in one session.
- `extract` — complete normalization and extraction stage writing, then stop.
- `merge` — inspect normalized sources, extraction stages, and existing world state; merge, emit, lint, repair, then stop.
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
- Use `read-slice` for targeted rereads only when candidate evidence is insufficient.
- Do not invent facts to fill a taxonomy.

## 3. Merge writing and coverage planning

Prefer incremental artifact writing instead of giant merge JSON heredocs:

```bash
npm run world-import-helper -- validate-artifact --output <output> --file artifact.json
npm run world-import-helper -- write-artifact --output <output> --mode upsert --file artifact.json
```

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

## 6. Helper anti-patterns

If you find yourself doing any of these, stop and use `references/helper-tools.md`:

- writing Python or shell functions named `sid`, `uid`, or `ref`;
- hard-coding source-hash maps from manifest rows;
- using placeholder quote text in final artifacts;
- rewriting the entire merge stage to fix one provenance reference;
- declaring success without lint/coverage checks.
