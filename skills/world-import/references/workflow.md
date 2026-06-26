# World import workflow

The workflow is model-owned for semantic steps and helper-owned for deterministic operations.

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

Produce one extraction stage envelope per unit following `contracts.md`. Extract reusable world-canon candidates with source spans. Do not summarize chapters. Do not merge across units in this phase.

Persist each envelope:

```bash
npm run world-import-helper -- write-extraction --output <output> --unit <unit-id> < /tmp/extraction-stage.json
```

## 3. Merge from staged candidates

Read staged candidate files under `<output>/stages/extraction/`. Merge semantically in the model:

- cluster likely-same entities or durable facts;
- preserve all useful provenance refs;
- preserve uncertainty/disputes instead of flattening them;
- keep output as artifact packets, not hard-coded TypeScript types.

If more evidence is needed, reread only the smallest anchor range:

```bash
npm run world-import-helper -- read-slice --output <output> --unit <unit-id> --start b0002 --end b0004
```

Persist merged artifact packets:

```bash
npm run world-import-helper -- write-merge --output <output> < /tmp/merge-stage.json
```

## 4. Emit markdown

```bash
npm run world-import-helper -- emit --output <output>
```

The emitter renders model-authored packet sections and provenance into `world/people`, `world/places`, `world/things`, and `world/facts`.

## 5. Review/evaluate

For fixtures or serious imports, run deterministic checks and, when available, a stronger reviewer model:

```bash
npm run world-import-helper -- eval --output <output> --reviewer-model <provider/model>
```

The reviewer should judge recall, duplicate/alias handling, provenance correctness, conflict visibility, and artifact usefulness. If no reviewer model is configured, record a skipped/degraded reviewer result instead of implying deterministic checks cover semantic quality.
