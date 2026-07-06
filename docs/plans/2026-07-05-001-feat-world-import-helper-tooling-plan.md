---
title: "feat: Add world-import helper tooling for provenance refs, merge authoring, and repair loops"
type: feat
date: 2026-07-05
origin: world-output/frankenstein-deepseek import run observations
---

# feat: Add world-import helper tooling for provenance refs, merge authoring, and repair loops

## Summary

Improve `world-import` by promoting the ad hoc deterministic Python that models currently write during strong import runs into first-class helper commands and skill guidance.

The DeepSeek V4 Pro Frankenstein run produced much better output than the GPT-5.4 run, but it did so by inventing operational glue inside `bash`: source-id mapping functions, provenance reference constructors, large JSON merge-stage generation, provenance repair scripts, and emit/lint/retry loops. That behavior is a signal that the semantic workflow is right, but the deterministic helper surface is missing ergonomic tools.

This plan adds helper commands for canonical source-span references, exact quote extraction, merge/artifact packet validation and patching, coverage planning, and an explicit emit-lint-repair loop. It also updates the `world-import` skill and reference docs so future import agents know to use these tools instead of writing brittle one-off Python.

The boundary stays unchanged: TypeScript helpers handle deterministic structure, references, validation, file writing, and diagnostics. The model remains responsible for entity identity, artifact selection, synopsis prose, style interpretation, merge decisions, retcons/conflicts, and candidate disposition reasons.

---

## Problem Frame

During the successful Frankenstein DeepSeek V4 Pro import, the model repeatedly used ad hoc Python code to perform deterministic chores:

- map normalized EPUB chapter numbers to `sourceId` / `unitId` values;
- create helper functions such as `sid(n)`, `uid(n)`, and `ref(n, start, end, quote)`;
- generate a large `stages/merge/merged-candidates.json` artifact packet;
- repair a `sourceHash` vs `fileHash` mismatch for Letter 1;
- emit, lint, inspect diagnostics, patch the merge packet, and retry;
- summarize source-unit and artifact coverage manually.

This produced a strong bundle: 36 artifacts, 75 markdown files, all 30 source pages retained, 88/88 provenance links resolved, and clean deterministic lint. But the path there was fragile. Another model may generate invalid JSON, use stale hashes, omit quote text, or miss a repair diagnostic.

The desired workflow is not to remove model agency. Instead, make the deterministic operations reliable and obvious so the model can spend its budget on semantic judgment and writing high-quality artifacts.

---

## Goals

- G1. Remove the need for import agents to hand-code source-id and provenance-reference helpers in Python.
- G2. Make exact quote capture easy enough that provenance `quote` fields are real excerpts, not placeholder strings like `[Source span b0002-b0004]`.
- G3. Let models write or patch artifacts incrementally without emitting one huge handwritten merge JSON document.
- G4. Provide a deterministic coverage planning view before final merge so agents can see unrepresented units, missing groups, and candidate accounting gaps.
- G5. Provide pre-emit validation that catches invalid source refs, anchors, related IDs, duplicate artifact IDs, missing quote text, and malformed sections before full emission.
- G6. Provide a repeatable emit-lint-repair loop that reports actionable diagnostics without making semantic decisions.
- G7. Update skill instructions and reference docs so import agents know which helpers to use and when.
- G8. Preserve skill-first semantics and avoid encoding entity ontology or literary-quality judgments in TypeScript.

## Non-goals

- NG1. Do not auto-decide whether a candidate should become an artifact, be merged, or be dropped.
- NG2. Do not auto-generate entity summaries, relationship meaning, style analysis, or world overview prose.
- NG3. Do not replace model-authored candidate dispositions with deterministic disposition inference.
- NG4. Do not require a single ontology for all corpora beyond existing output groups: `people`, `places`, `things`, `facts`, `style`.
- NG5. Do not hide lint failures by silently mutating semantic content.

---

## Proposed Helper Commands

All commands are exposed through the existing helper entrypoint:

```bash
npm run world-import-helper -- <command> ...
```

Equivalent installed binary behavior should follow existing helper conventions.

### 1. `resolve-ref`

Resolve a human-friendly source selector and anchor range into the canonical `SourceSpanRef` envelope used by extraction and merge stages.

#### Usage

```bash
npm run world-import-helper -- resolve-ref \
  --output world-output/frankenstein-deepseek \
  --unit oebps-8687221241995638950-84-h-2-htm-html-9b60c0ff-u001 \
  --start b0001 \
  --end b0003
```

Optional selector modes:

```bash
# by exact unit id
--unit <unit-id>

# by source id + unit number when available
--source <source-id> [--unit-index 1]

# by manifest order, useful for EPUB spine/chapter workflows
--order <number>

# by archive/source entry path substring, if unique
--entry-path <substring>

# by title substring, if unique
--title <substring>
```

#### Output

```json
{
  "sourceId": "oebps-8687221241995638950-84-h-2-htm-html-9b60c0ff",
  "unitId": "oebps-8687221241995638950-84-h-2-htm-html-9b60c0ff-u001",
  "startAnchor": "b0001",
  "endAnchor": "b0003",
  "quote": ""
}
```

#### Deterministic checks

- Validate `output/sources/manifest.json` exists.
- Resolve selector to exactly one unit or return a diagnostic listing candidates.
- Validate anchors exist and `startAnchor <= endAnchor` in normalized block order.
- Return canonical `sourceId` and `unitId` from manifest/normalized files, not model-guessed hashes.

#### Motivation

This replaces ad hoc `sid(n)`, `uid(n)`, and `ref(...)` Python helpers and prevents sourceHash/fileHash mismatches.

---

### 2. `quote-ref`

Resolve a source span and return an exact or lightly trimmed quote from normalized source blocks. This may optionally output a complete `SourceSpanRef` with the quote populated.

#### Usage

```bash
npm run world-import-helper -- quote-ref \
  --output world-output/frankenstein-deepseek \
  --unit <unit-id> \
  --start b0002 \
  --end b0004
```

Convenience form using `resolve-ref` selectors:

```bash
npm run world-import-helper -- quote-ref \
  --output world-output/frankenstein-deepseek \
  --order 6 \
  --start b0001 \
  --end b0002 \
  --as-ref
```

#### Output, default

```json
{
  "sourceId": "...",
  "unitId": "...",
  "startAnchor": "b0002",
  "endAnchor": "b0004",
  "text": "Exact normalized source text for the selected block span...",
  "blockCount": 3,
  "truncated": false
}
```

#### Output with `--as-ref`

```json
{
  "sourceId": "...",
  "unitId": "...",
  "startAnchor": "b0002",
  "endAnchor": "b0004",
  "quote": "Exact normalized source text for the selected block span..."
}
```

#### Options

- `--max-chars <n>`: trim quote text safely with ellipsis metadata.
- `--joiner <text>`: join multiple blocks with newline by default.
- `--plain`: strip markdown-ish block markers if source blocks carry formatting.
- `--as-ref`: emit complete `SourceSpanRef` with `quote` field.

#### Deterministic checks

- Same selector/anchor checks as `resolve-ref`.
- Preserve exact source text from normalized blocks unless `--max-chars` or `--plain` is requested.
- If truncated, include `truncated: true` and retain enough leading/trailing context for auditability.

#### Motivation

The DeepSeek reviewer noted that some provenance quotes were placeholders. This tool makes exact quote inclusion cheap and reliable.

---

### 3. `validate-artifact`

Validate one artifact packet before it is written into the merge stage.

#### Usage

```bash
npm run world-import-helper -- validate-artifact \
  --output world-output/frankenstein-deepseek \
  --file /tmp/victor-artifact.json
```

Or stdin:

```bash
npm run world-import-helper -- validate-artifact --output <dir> < artifact.json
```

#### Checks

- Required fields: `id`, `group`, `title`, `sections`.
- Valid group: `people|places|things|facts|style`.
- Unique, slug-safe `id` if validating against an existing merge stage.
- Section headings and bodies are non-empty.
- Provenance refs resolve to source pages and anchors.
- Provenance quotes are present unless `--allow-empty-quotes` is passed.
- Related IDs either exist in the current merge stage or are listed as planned IDs via `--planned-ids`.
- Frontmatter-relevant fields have serializable values.

#### Output

```json
{
  "passed": false,
  "diagnostics": [
    {
      "severity": "error",
      "code": "missing-provenance-quote",
      "path": "provenance[1].quote",
      "message": "Provenance quote is empty; use quote-ref --as-ref to populate it."
    }
  ]
}
```

#### Motivation

This catches common merge packet defects earlier than full emit/lint and gives agents an explicit path to repair.

---

### 4. `write-artifact`

Add or replace a single artifact in the merge stage without requiring the model to rewrite the entire `merged-candidates.json` file.

#### Usage

```bash
npm run world-import-helper -- write-artifact \
  --output world-output/frankenstein-deepseek \
  --mode upsert \
  < /tmp/victor-artifact.json
```

#### Options

- `--mode add|replace|upsert`:
  - `add`: fail if artifact ID already exists.
  - `replace`: fail if artifact ID does not exist.
  - `upsert`: add or replace.
- `--validate`: default true; runs `validate-artifact` first.
- `--merge-file <path>`: override default `stages/merge/merged-candidates.json`.
- `--pretty`: default true; write stable formatted JSON.

#### Behavior

- Create a minimal merge-stage envelope if none exists:

```json
{
  "version": 1,
  "kind": "merge",
  "artifacts": [],
  "candidateDispositions": [],
  "diagnostics": []
}
```

- Preserve existing candidate dispositions and diagnostics.
- Sort artifacts deterministically by group then title or preserve insertion order; choose one and document it.
- Return a short summary with artifact count and validation status.

#### Motivation

This replaces giant Python heredocs for merge-stage generation. It makes long imports more incremental and recoverable.

---

### 5. `patch-merge`

Apply constrained JSON patches to the merge stage for non-semantic structural repairs.

#### Usage

```bash
npm run world-import-helper -- patch-merge \
  --output world-output/frankenstein-deepseek \
  --patch /tmp/patch.json
```

Patch format should be explicit and limited, not arbitrary code execution. Prefer JSON Patch-like operations:

```json
[
  { "op": "replace", "path": "/artifacts/robert-walton/provenance/0", "value": { "sourceId": "..." } },
  { "op": "remove", "path": "/artifacts/robert-walton/provenance/1" }
]
```

Because artifact array indexes are brittle, support artifact-id addressing:

```json
[
  {
    "op": "replace-provenance",
    "artifactId": "robert-walton",
    "index": 0,
    "value": { "sourceId": "...", "unitId": "...", "startAnchor": "b0001", "endAnchor": "b0002", "quote": "..." }
  }
]
```

#### Checks

- Validate patched merge stage after application.
- Refuse patches that mutate semantic prose unless an explicit `--allow-section-body-edits` flag is used.
- Always write a backup copy under `stages/merge/backups/` before applying.

#### Motivation

The Frankenstein run needed a source-id repair. This helper makes such repairs inspectable and safer than handwritten scripts.

---

### 6. `coverage-plan`

Produce a deterministic planning view of source units, extraction stages, artifact coverage, candidate accounting, and missing structural areas.

#### Usage

```bash
npm run world-import-helper -- coverage-plan --output world-output/frankenstein-deepseek
```

#### Output

```json
{
  "sourceUnits": 30,
  "extractionStages": 31,
  "artifacts": 36,
  "groups": {
    "people": 16,
    "places": 7,
    "things": 3,
    "facts": 9,
    "style": 1
  },
  "unitCoverage": [
    {
      "unitId": "...",
      "order": 6,
      "title": "Letter 4",
      "role": "body",
      "hasExtraction": true,
      "representedByArtifacts": ["robert-walton", "arctic"],
      "sourcePageEmitted": true,
      "diagnostics": []
    }
  ],
  "candidateAccounting": {
    "totalCandidates": 124,
    "represented": 90,
    "merged": 20,
    "dropped": 14,
    "unaccounted": []
  },
  "recommendations": [
    {
      "severity": "warning",
      "code": "no-style-artifact",
      "message": "No style artifact exists. Literary imports should usually include one if source material has distinctive voice or form."
    }
  ]
}
```

#### Deterministic scope

The command may report structural facts and heuristic reminders. It must not declare that a semantic omission is wrong. Examples:

- Allowed: `unit has extraction candidates but no represented artifacts or disposition`.
- Allowed: `no artifacts in group places`.
- Allowed: `body unit has no coverage link`.
- Not allowed: `Geneva must be a place artifact`.

#### Motivation

This gives models a pre-finalization checklist and reduces dropped-candidate risk.

---

### 7. `repair-summary`

Convert lint, validation, and coverage diagnostics into a compact model-facing repair checklist.

#### Usage

```bash
npm run world-import-helper -- repair-summary --output world-output/frankenstein-deepseek
```

#### Output

Markdown or JSON, selectable by `--format json|markdown`:

```markdown
# World import repair summary

## Errors to fix before declaring success

1. `unresolved-provenance-target` in `people/robert-walton.md`
   - Ref: sourceId `...9c8622be`, unitId `...9c8622be-u001`
   - Suggested tool: `resolve-ref --order 2 --start b0001 --end b0002`

## Warnings to inspect

1. No style artifact exists.
2. 4 body units have extraction stages but no represented candidates.
```

#### Motivation

Models do better with compact diagnostic summaries than raw linter output when performing repair passes.

---

### 8. `emit-lint-repair-loop`

Run deterministic emit and lint checks repeatedly until clean or until diagnostics remain. This command should not alter semantic content by itself. It should optionally execute only safe structural fixes in future phases, but v1 is diagnostic-only.

#### Usage

```bash
npm run world-import-helper -- emit-lint-repair-loop \
  --output world-output/frankenstein-deepseek \
  --max-iterations 2
```

#### Behavior, v1

For each iteration:

1. Run `emit`.
2. Run `lint`.
3. Run `coverage-plan`.
4. Run `repair-summary`.
5. Stop if lint is clean and required structural checks pass.
6. Otherwise return diagnostics and exit non-zero.

#### Output

```json
{
  "passed": false,
  "iterations": 1,
  "worldMarkdownFiles": 74,
  "lint": { "passed": false, "diagnostics": [...] },
  "coverage": { "sourceUnits": 30, "artifacts": 35, "candidateAccounting": {...} },
  "repairSummaryPath": "stages/repair-summary.md"
}
```

#### Motivation

This makes the model's current manual emit/lint/retry loop explicit and repeatable.

---

## Existing Command Updates

### `lint`

Extend diagnostics to distinguish:

- missing source page;
- missing source anchor;
- empty or placeholder provenance quote;
- unresolved `related` ID;
- unresolved wikilink;
- duplicate artifact ID;
- group index missing;
- body source unit without coverage;
- extraction candidate without representation/disposition.

Add a placeholder-quote warning for patterns such as:

- `[Source span ...]`
- `source span b0001-b0002`
- `TODO quote`
- empty string

This should default to warning at first to avoid breaking existing fixtures, then become an error after skill guidance and tests are updated.

### `eval`

Include `coverage-plan` and `repair-summary` outputs in `stages/review.json` so reviewer models can distinguish deterministic gaps from semantic quality issues.

### `write-merge`

Keep existing full-file behavior, but add:

- pre-write validation summary;
- `--validate-only` mode;
- clearer diagnostics pointing to `write-artifact`, `resolve-ref`, and `quote-ref`.

---

## Skill Enhancements

Update `skills/world-import/SKILL.md` and references so future agents know to use the new helpers.

### `SKILL.md` workflow additions

Add a section near workflow instructions:

```markdown
## Required helper posture

Do not write ad hoc Python or shell scripts to invent source ids, unit ids, or provenance refs. Use:

- `resolve-ref` to build canonical `SourceSpanRef` values.
- `quote-ref --as-ref` to populate exact quote text.
- `write-artifact` to add or replace one artifact at a time.
- `validate-artifact` before adding complex artifacts.
- `coverage-plan` before final merge review.
- `emit-lint-repair-loop` before declaring success.
- `repair-summary` to plan model-authored repairs.

Ad hoc scripts are acceptable only for one-off inspection or summarization that has no corresponding helper. If you find yourself writing code to map source ids, repair refs, validate anchors, or rewrite merge JSON, stop and use the helper.
```

### `references/workflow.md`

Add an explicit recommended full run sequence:

1. `normalize`
2. `list-units`
3. extraction pass per body unit
4. `coverage-plan` after extraction
5. draft artifacts incrementally with `write-artifact`
6. use `resolve-ref` and `quote-ref --as-ref` while drafting provenance
7. `validate-artifact` for each artifact or `write-artifact --validate`
8. add candidate dispositions
9. `coverage-plan` before final emit
10. `emit-lint-repair-loop`
11. repair using `repair-summary`
12. final `lint`
13. optional `eval`

Add examples for fresh imports and maintained-world updates.

### `references/contracts.md`

Clarify `SourceSpanRef.quote` expectations:

- Quotes should be exact or lightly trimmed source excerpts.
- Placeholder quote strings are not acceptable final output.
- Use `quote-ref --as-ref` when possible.
- If quote is intentionally omitted, model must explain why in artifact metadata or diagnostics; lint may warn.

Add artifact authoring guidance:

- Prefer `write-artifact` for incremental merge construction.
- Use `metadata.representedCandidateIds` or `candidateDispositions` consistently.
- Use `coverage-plan` to verify all source units and candidates are accounted for.

### `references/artifact-format.md`

Add examples showing:

- artifact with multiple exact quote provenance refs generated via `quote-ref`;
- related IDs that validate against existing/planned artifact IDs;
- style artifact with provenance and related links;
- candidate-accounting metadata.

### New reference: `references/helper-tools.md`

Create a compact cheat sheet for model agents:

- command names;
- when to use each;
- minimal examples;
- common diagnostics and the helper to fix them;
- anti-patterns: handwritten `sid()` maps, giant Python heredocs, placeholder quotes, source hash guessing.

### `docs/world-import-run-guide.md`

Add a short section after full model-backed import:

```markdown
## During model-backed imports

The world-import skill should use helper tools for deterministic provenance and merge operations. If a run shows the model writing source-id mapping scripts or giant JSON-generation scripts, that is a sign the skill/helper surface needs improvement. Prefer the helper commands documented in `skills/world-import/references/helper-tools.md`.
```

---

## Implementation Phases

### Phase 1 — Ref and quote helpers

Implement:

- `resolve-ref`
- `quote-ref`
- shared selector resolution library
- tests for unit selectors, ambiguous selectors, missing anchors, anchor order, and quote extraction

Acceptance criteria:

- Given Frankenstein normalized output, `resolve-ref --order 2 --start b0001 --end b0002` returns the canonical fileHash-based IDs.
- `quote-ref --as-ref` returns a valid `SourceSpanRef` with non-empty quote text.
- Invalid selectors produce actionable diagnostics without throwing raw stack traces.

### Phase 2 — Artifact validation and incremental writing

Implement:

- `validate-artifact`
- `write-artifact`
- merge-stage creation if missing
- duplicate ID and related-ID validation
- provenance quote warning/error plumbing

Acceptance criteria:

- A single artifact JSON can be added to a new merge stage and emitted.
- Invalid provenance refs are caught before emit.
- Placeholder quotes produce diagnostics.
- Existing `write-merge` still works.

### Phase 3 — Coverage and repair diagnostics

Implement:

- `coverage-plan`
- `repair-summary`
- `lint` diagnostic expansion
- eval embedding of coverage/repair summaries

Acceptance criteria:

- Coverage plan reports all normalized units, extraction stage presence, artifact mappings, group counts, and candidate accounting.
- Missing candidate dispositions are reported structurally.
- Repair summary names the helper command likely needed for each diagnostic category.

### Phase 4 — Emit/lint repair loop

Implement:

- `emit-lint-repair-loop`
- stable output paths for repair summaries
- clear final success/failure status

Acceptance criteria:

- Clean DeepSeek Frankenstein output passes in one iteration.
- A deliberately broken provenance ref fails with a repair summary recommending `resolve-ref` / `quote-ref`.
- The loop does not mutate semantic prose.

### Phase 5 — Skill and docs updates

Update:

- `skills/world-import/SKILL.md`
- `skills/world-import/references/workflow.md`
- `skills/world-import/references/contracts.md`
- `skills/world-import/references/artifact-format.md`
- new `skills/world-import/references/helper-tools.md`
- `docs/world-import-run-guide.md`
- `docs/world-import.md` helper command list
- `docs/smoke-tests.md` validation commands if needed

Acceptance criteria:

- A model reading the skill sees explicit instructions not to hand-code source refs or merge JSON.
- Helper command examples are copy-pasteable.
- The run guide points agents to helper-tool docs.

---

## Test and Fixture Plan

### Unit tests

Add tests around command-router behavior and helper libraries:

- selector resolution by `unit`, `source`, `order`, `entry-path`, and `title`;
- ambiguous selector handling;
- missing output/manifest handling;
- anchor validation;
- multi-block quote extraction;
- artifact validation for missing fields, invalid groups, unresolved provenance, missing quote, duplicate IDs;
- write-artifact add/replace/upsert behavior;
- coverage-plan accounting for represented/merged/dropped/unaccounted candidates.

### Integration fixtures

Create small deterministic fixtures under existing test/eval patterns:

1. **Mini EPUB/HTML fixture** with 3 body units:
   - one character;
   - one place;
   - one object;
   - one event;
   - paragraph anchors.

2. **Broken provenance fixture**:
   - merge ref points to non-existent source hash;
   - expected repair summary recommends `resolve-ref`.

3. **Placeholder quote fixture**:
   - provenance quote is `[Source span b0001-b0002]`;
   - lint warns/errors according to configured strictness;
   - expected repair summary recommends `quote-ref --as-ref`.

4. **Candidate accounting fixture**:
   - extraction candidate omitted from artifacts and dispositions;
   - coverage-plan reports unaccounted candidate.

### Manual regression

Use Frankenstein or Alice sample runs:

```bash
npm run world-import-run -- \
  --input samples/Frankenstein.epub \
  --output /tmp/frankenstein-helper-regression \
  --model openrouter/deepseek/deepseek-v4-pro \
  --debug \
  --show-tool-updates

npm run world-import-helper -- coverage-plan --output /tmp/frankenstein-helper-regression
npm run world-import-helper -- emit-lint-repair-loop --output /tmp/frankenstein-helper-regression
npm run world-import-helper -- eval --output /tmp/frankenstein-helper-regression --reviewer-model openrouter/deepseek/deepseek-v4-pro
```

Success signal: the model uses helper commands instead of writing Python to construct refs or merge JSON.

---

## Risks and Mitigations

### Risk: Helpers become semantic policy

Mitigation: Keep diagnostics structural. Avoid corpus-specific rules except in reviewer prompts or optional heuristic warnings. Phrase diagnostics as evidence for model review.

### Risk: Tool count overwhelms agents

Mitigation: Add `helper-tools.md` cheat sheet and a clear workflow sequence. `write-artifact --validate` should cover common cases; agents should not need every tool every run.

### Risk: Incremental merge writing creates inconsistent artifact order

Mitigation: Choose and document deterministic ordering or preserve insertion order with stable formatting. Add tests.

### Risk: Quote extraction over-truncates evidence

Mitigation: Default to exact full block-span text. Truncation requires explicit `--max-chars` and records `truncated: true`.

### Risk: Existing outputs fail stricter quote lint

Mitigation: Introduce placeholder quote checks as warnings first. Flip to errors after docs/fixtures are updated and migration is understood.

### Risk: Agents still write ad hoc Python

Mitigation: Skill instructions should explicitly call this out as an anti-pattern. Reviewer/eval can note if tool transcripts show source-ref or merge-generation scripts that should have used helpers.

---

## Acceptance Criteria

The work is complete when:

- `resolve-ref` and `quote-ref` can produce canonical, quote-populated `SourceSpanRef` objects from normalized outputs.
- `validate-artifact` catches invalid provenance, missing quotes, malformed sections, duplicate IDs, and unresolved related IDs.
- `write-artifact` lets agents build merge stages incrementally without hand-writing giant JSON packets.
- `coverage-plan` reports source-unit, extraction, artifact, group, source-page, and candidate-accounting coverage.
- `repair-summary` gives concise model-actionable fixes mapped to helper commands.
- `emit-lint-repair-loop` runs deterministic emit/lint/coverage checks and writes/prints a repair summary.
- The `world-import` skill references these tools directly and discourages ad hoc Python for deterministic helper work.
- `docs/world-import-run-guide.md` and `docs/world-import.md` list the new helper flow.
- Tests cover selector resolution, quote extraction, artifact validation, incremental writing, coverage accounting, and repair summaries.
- A fresh Frankenstein or Alice run with a strong model shows reduced or eliminated ad hoc source-ref/merge-generation scripting in the tool transcript.

---

## Future Extensions

- Add a structured `plan-artifacts` helper that lets the model draft intended artifact IDs/groups before writing full content.
- Add `planned-related-ids.json` to support forward references during incremental artifact writing.
- Add `quote-search` to find source spans by text snippet and return candidate refs.
- Add `candidate-browser` to summarize extraction candidates by entity/event hint without deciding merge identity.
- Add optional transcript analysis that flags anti-patterns such as handwritten source-id maps, placeholder quote use, and repeated failed emit/lint cycles.
- Add maintained-world-specific helpers for comparing existing artifacts against new source coverage without deciding retcons automatically.
