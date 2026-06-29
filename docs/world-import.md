# World import

World import is a package-first pipeline for turning HTML/XHTML source collections, ZIPs, and EPUB-like archives into a provenance-rich, OKF-compatible markdown world wiki bundle.

The architecture deliberately keeps semantics in skills and model prompts. TypeScript helper code handles deterministic operations only:

- normalize source files and archives;
- create stable source/unit ids and block anchors;
- list units and read bounded source slices;
- persist generic stage envelopes;
- emit model-authored artifact packets as markdown concept pages, indexes, logs, coverage views, and retained source-unit citation targets.

It does **not** decide entity identity, aliases, relationships, conflicts, fact semantics, or synopsis/update quality.

## CLI

The repo has a gitignored `world-output/` directory for persistent extractions. Use a distinct subdirectory per run:

```bash
npm run world-import -- --input ./sources --output world-output/my-corpus --model anthropic/claude-sonnet-4-5
```

For quick disposable test runs, use `/tmp/`:

```bash
npm run world-import -- --input ./sources --output /tmp/world-test --model anthropic/claude-sonnet-4-5
```

### Equivalent installed binary

```bash
memchat-world-import --input ./sources --output world-output/my-corpus --model anthropic/claude-sonnet-4-5
```

Equivalent installed binary:

```bash
memchat-world-import --input ./sources --output /tmp/world-import --model anthropic/claude-sonnet-4-5
```

Options:

- `--input` — HTML/XHTML directory, `.zip`, or `.epub`-style archive.
- `--output` — output root.
- `--model` / `MEMCHAT_WORLD_IMPORT_MODEL` — model used by the skill.
- `--reviewer-model` / `MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL` — optional stronger reviewer model.
- `--thinking` — pi thinking level (default: low; pass `off` to disable).
- `--dry-run` — validate setup and normalization without doing semantic extraction.
- `--debug` / `MEMCHAT_WORLD_IMPORT_DEBUG=1` — print startup, paths, model selection, prompt, and tool call diagnostics to stderr (default: on; set env to `0` to silence).
- `--show-thinking` / `MEMCHAT_WORLD_IMPORT_SHOW_THINKING=1` — print model thinking deltas when the provider exposes them (default: on; set env to `0` to silence).
- `--show-tool-updates` / `MEMCHAT_WORLD_IMPORT_SHOW_TOOL_UPDATES=1` — print verbose tool update payloads, not only start/end lines (default: off).

## Helper commands

Skills and other harnesses can use deterministic helpers directly:

```bash
npm run world-import-helper -- normalize --input ./sources --output /tmp/world-import
npm run world-import-helper -- list-units --output /tmp/world-import
npm run world-import-helper -- read-unit --output /tmp/world-import --unit <unit-id>
npm run world-import-helper -- read-slice --output /tmp/world-import --unit <unit-id> --start b0001 --end b0003
npm run world-import-helper -- write-extraction --output /tmp/world-import --unit <unit-id> < extraction.json
npm run world-import-helper -- write-merge --output /tmp/world-import < merge.json
npm run world-import-helper -- emit --output /tmp/world-import
npm run world-import-helper -- eval --output /tmp/world-import --reviewer-model anthropic/claude-opus-4-5
```

## Output layout

```text
<output-root>/
  sources/
    manifest.json
    normalized/<unit-id>.json
  stages/
    extraction/<unit-id>.json
    merge/merged-candidates.json
  world/
    index.md
    log.md
    coverage.md
    people/
      index.md
    places/
      index.md
    things/
      index.md
    facts/
      index.md
    sources/
      index.md
      units/
```

## Stage contract boundary

Extraction candidates are model-authored and opaque to helper code except for optional routing/provenance envelope fields. Emission now produces both concept pages and bundle-local source-unit pages so provenance links can resolve within the emitted wiki bundle. Merged artifacts use a generic packet. Helpers may validate structure, emit browseable files, and report integrity, but synopsis text, continuity decisions, conflict handling, and existing-world update judgment remain model-owned:

```json
{
  "id": "artifact-id",
  "group": "people",
  "type": "Character",
  "title": "Artifact Title",
  "description": "One-line capsule used for indexes and previews.",
  "tags": ["character"],
  "timestamp": "2026-06-29T00:00:00Z",
  "sections": [{ "heading": "Summary", "body": "Markdown body" }],
  "provenance": [{ "sourceId": "...", "unitId": "...", "startAnchor": "b0001", "endAnchor": "b0001", "quote": "..." }],
  "related": [],
  "metadata": {}
}
```

## Provenance and citations

`SourceSpanRef` remains the canonical evidence model. In the emitted wiki bundle, provenance links should resolve to retained normalized source-unit markdown pages under `world/sources/units/` when those targets are available. This makes the emitted bundle self-contained for provenance inspection even when the original EPUB/HTML source is not present.

Those emitted source-unit pages are a v1 citation target. They preserve original path metadata where available, but they are still normalized representations rather than perfect original-format selectors such as EPUB CFIs, DOM selectors, page numbers, or byte offsets.

For a concise shell-oriented quick-start covering build, API key setup, run flags, helper commands, and output inspection, see [`docs/world-import-run-guide.md`](./world-import-run-guide.md).

See `skills/world-import/references/contracts.md` for model-facing details.

## New world vs maintained world

A substantive import may produce a model-authored `World Overview` / `Corpus Synopsis` artifact as part of the normal artifact packet flow. That overview is not generated by the emitter; it is written and later revised by the model like any other artifact.

When importing additional source material into an existing output root, treat the emitted wiki as maintained world state rather than disposable output. Helper code should expose deterministic structure, provenance, and coverage for inspection, while the model decides whether new evidence enriches existing artifacts, introduces conflicts/retcons, or justifies new artifacts.

## Debugging model runs

Use debug mode when checking whether a model is following the skill workflow. For exploratory runs or retries after a no-output run, prefer a stronger model and include verbose tool updates by default:

```bash
npm run world-import -- --input ~/Downloads/pg11-images-3.epub --output /tmp/pg11-world --model openrouter/deepseek/deepseek-v4-pro --debug --show-tool-updates
```

The CLI prints status lines for argument resolution, pi auth/model paths, skill loading, active model, the `/skill:world-import` prompt, tool calls, and a final output summary. A successful model turn with `worldMarkdownFiles: 0` means the model did not complete the import even if the process exited cleanly. In that case, rerun with a stronger model and keep `--show-tool-updates` enabled so tool-level failures are visible.
