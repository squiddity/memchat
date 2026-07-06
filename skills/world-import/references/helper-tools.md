# World import helper tools

Use these deterministic helpers instead of ad hoc scripts for source references, quotes, merge-stage edits, coverage checks, and lint repair.

## Core rule

Do not hand-code `sid()`, `uid()`, `ref()`, source-hash maps, anchor validators, or giant JSON-generation scripts when a helper exists. Keep semantic choices model-owned; let helpers handle deterministic structure.

## Source references

### `resolve-ref`

Build a canonical `SourceSpanRef` shell from the manifest and normalized unit anchors.

```bash
npm run world-import-helper -- resolve-ref \
  --output <output> \
  --unit <unit-id> \
  --start b0001 \
  --end b0003
```

Selector alternatives:

```bash
--order <number>
--entry-path <substring>
--title <substring>
--source <source-id> [--unit-index <n>]
```

Use this when you know the source span but need correct `sourceId` / `unitId` values.

### `quote-ref`

Return exact normalized source text for a span. Prefer `--as-ref` when building artifact provenance.

```bash
npm run world-import-helper -- quote-ref \
  --output <output> \
  --unit <unit-id> \
  --start b0001 \
  --end b0003 \
  --as-ref
```

Options:

- `--max-chars <n>` trims long quotes.
- `--plain` strips block markers if present.

Use this to avoid placeholder quotes like `[Source span b0001-b0003]`.

## Artifact authoring

### `validate-artifact`

Validate one artifact packet before writing it.

```bash
npm run world-import-helper -- validate-artifact --output <output> --file artifact.json
```

It checks required fields, group validity, section bodies, provenance refs/anchors, placeholder quotes, duplicate IDs, and related IDs.

### `write-artifact`

Add or replace one artifact in `stages/merge/merged-candidates.json`.

```bash
npm run world-import-helper -- write-artifact \
  --output <output> \
  --mode upsert \
  --file artifact.json
```

Modes:

- `add` — fail if ID exists.
- `replace` — fail if ID does not exist.
- `upsert` — add or replace.

This is preferred over writing a giant merge JSON document by hand. It validates by default; pass `--allow-empty-quotes` only for temporary drafts.

### `patch-merge`

Apply constrained structural patches, currently useful for provenance replacement/removal and candidate disposition additions.

```bash
npm run world-import-helper -- patch-merge --output <output> --file patch.json
```

Example:

```json
[
  {
    "op": "replace-provenance",
    "artifactId": "robert-walton",
    "index": 0,
    "value": {
      "sourceId": "...",
      "unitId": "...",
      "startAnchor": "b0001",
      "endAnchor": "b0002",
      "quote": "Exact source excerpt..."
    }
  }
]
```

The helper writes a backup before patching and validates the result.

## Coverage and repair

### `coverage-plan`

Inspect source-unit coverage, extraction stage presence, artifact counts by group, source-page emission, and candidate accounting.

```bash
npm run world-import-helper -- coverage-plan --output <output>
```

Use before final merge/emission. Diagnostics are structural evidence, not semantic orders.

### `repair-summary`

Convert lint and coverage diagnostics into a concise repair checklist.

```bash
npm run world-import-helper -- repair-summary --output <output>
npm run world-import-helper -- repair-summary --output <output> --format json
npm run world-import-helper -- repair-summary --output <output> --write
```

Use this after lint failures or when planning a repair pass.

### `emit-lint-repair-loop`

Run deterministic emission, lint, coverage planning, and repair-summary generation.

```bash
npm run world-import-helper -- emit-lint-repair-loop --output <output>
```

This does not make semantic repairs. It tells you what needs model-authored repair.

## Common diagnostics

| Diagnostic | Usual fix |
|---|---|
| `missing-provenance-quote` | Use `quote-ref --as-ref` and patch/write the artifact. |
| `provenance-source-mismatch` | Use `resolve-ref` to get canonical IDs. |
| `unresolved-provenance-anchor` | Re-read the unit, choose valid anchors, then patch provenance. |
| `unresolved-related` / `unresolved-wikilink` | Create the target artifact or fix/remove the link. |
| `unaccounted-candidate` | Add `metadata.representedCandidateIds` or a candidate disposition with reason. |
| `body-unit-no-emitted-coverage` | Add artifact provenance for that unit or account for omitted candidates. |

## Anti-patterns

Avoid these unless no helper can support the task:

- Python dictionaries mapping chapter numbers to source hashes.
- Handwritten `sid(n)`, `uid(n)`, or `ref(n, ...)` functions.
- Placeholder quote strings in final artifacts.
- Rewriting the whole merge stage to fix one provenance ref.
- Declaring success without `coverage-plan` and `emit-lint-repair-loop` or `lint`.
