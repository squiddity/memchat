# World import

World import is a package-first pipeline for turning HTML/XHTML source collections, ZIPs, and EPUB-like archives into a provenance-rich, OKF-compatible markdown world wiki bundle.

The architecture deliberately keeps semantics in skills and model prompts. TypeScript helper code handles deterministic operations only:

- normalize source files and archives;
- create portable source/unit ids and paragraph/poem/pre block anchors;
- list units and read bounded source slices;
- persist generic stage envelopes and structural candidate dispositions;
- emit model-authored artifact packets as markdown concept pages, indexes, logs, coverage views, style guides, and retained source-unit citation targets;
- lint emitted bundles for structural link, provenance, coverage, and candidate-accounting diagnostics.

It does **not** decide entity identity, aliases, relationships, conflicts, fact semantics, or synopsis/update quality.

## CLI

The repo has a gitignored `world-output/` directory for persistent extractions. Use a distinct subdirectory per run:

```bash
npm run world-import-run -- --input ./sources --output world-output/my-corpus --model anthropic/claude-sonnet-4-5
```

For a concise shell-oriented quick-start covering build, prerequisites, run flags, the TTY-safe wrapper, helper commands, dry-run, output inspection, lint/eval, and file layout, see [`docs/world-import-run-guide.md`](./world-import-run-guide.md).

For TTY-safe terminal or herdr-pane runs with ANSI-styled thinking output preserved, prefer the wrapper. In herdr, run imports in a dedicated pane **below** the current pane, not beside it:

```bash
npm run world-import-run -- --input ./sources --output world-output/my-corpus --model anthropic/claude-sonnet-4-5
```

To opt into staged orchestration across separate extract, merge, and review sessions:

```bash
npm run world-import-run -- --session-strategy staged --input ./sources --output world-output/my-corpus --model anthropic/claude-sonnet-4-5
```

For quick disposable test runs, use `/tmp/`:

```bash
npm run world-import-run -- --input ./sources --output /tmp/world-test --model anthropic/claude-sonnet-4-5
```

Use the wrapper for observed dry runs too, not just full imports:

```bash
npm run world-import-run -- --input ./sources --output /tmp/world-test --dry-run
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
- `--reviewer-model` / `MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL` — optional stronger reviewer model. If omitted, the main CLI defaults reviewer scoring to the active import model. Pass `--reviewer-model off` or `--no-reviewer` to disable review explicitly.
- `--session-strategy single|staged` — single full-session runner or staged extract/merge/review orchestration (default: `single` for now).
- `--thinking` — pi thinking level (default: low; pass `off` to disable).
- `--dry-run` — validate setup and normalization without doing semantic extraction. In staged mode, dry-run stops after the extract-stage setup/normalization path rather than continuing to merge or review.
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
npm run world-import-helper -- resolve-ref --output /tmp/world-import --unit <unit-id> --start b0001 --end b0003
npm run world-import-helper -- quote-ref --output /tmp/world-import --unit <unit-id> --start b0001 --end b0003 --as-ref
npm run world-import-helper -- validate-artifact --output /tmp/world-import --file artifact.json
npm run world-import-helper -- write-artifact --output /tmp/world-import --mode upsert --file artifact.json
npm run world-import-helper -- patch-merge --output /tmp/world-import --file patch.json
npm run world-import-helper -- coverage-plan --output /tmp/world-import
npm run world-import-helper -- repair-summary --output /tmp/world-import
npm run world-import-helper -- emit-lint-repair-loop --output /tmp/world-import
npm run world-import-helper -- write-extraction --output /tmp/world-import --unit <unit-id> < extraction.json
npm run world-import-helper -- write-merge --output /tmp/world-import < merge.json
npm run world-import-helper -- emit --output /tmp/world-import
npm run world-import-helper -- lint --output /tmp/world-import
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
    style/
      index.md
    sources/
      index.md
      units/
```

## Stage contract boundary

Extraction candidates are model-authored and opaque to helper code except for routing/provenance envelope fields and candidate ids. Merge output should account for every extraction candidate by listing represented candidate ids on artifacts or stage-level dispositions (`represented`, `merged`, `deferred`, `dropped`); dropped/deferred candidates require a model-authored reason. Helpers check accounting completeness only, not whether the semantic decision was good.

Emission now produces concept pages, optional model-authored style-guide pages under `world/style/`, and bundle-local source-unit pages so provenance links can resolve within the emitted wiki bundle. Merged artifacts use a generic packet. Helpers may validate structure, emit browseable files, and report integrity, but synopsis text, continuity decisions, conflict handling, style/tone analysis, and existing-world update judgment remain model-owned:

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

`SourceSpanRef` remains the canonical evidence model. Normalization preserves paragraph-level prose blocks and line-preserving poem/preformatted blocks where possible, with block metadata such as role, source entry path, block kind, and hashes in the manifest. EPUB inputs use OPF spine/nav/package metadata when available; run-local absolute paths are diagnostics, while archive-entry source identities are based on archive content plus archive-relative entry paths.

In the emitted wiki bundle, provenance links should resolve to retained normalized source-unit markdown pages under `world/sources/units/` when those targets are available. This makes the emitted bundle self-contained for provenance inspection even when the original EPUB/HTML source is not present.

Those emitted source-unit pages are a v1 citation target. They preserve original path metadata where available, but they are still normalized representations rather than perfect original-format selectors such as EPUB CFIs, DOM selectors, page numbers, or byte offsets.

## Deterministic lint and eval

Run `npm run world-import-helper -- lint --output <output>` after `emit` to get machine-readable diagnostics for unresolved `related` ids, unresolved `[[wikilinks]]`, missing markdown/source anchors, required frontmatter, duplicate artifact ids, body source coverage gaps, and candidate-disposition accounting. `eval` embeds the same lint result in `stages/review.json` before any reviewer-model scoring. Treat lint as structural evidence for a repair pass: create the missing artifact, fix/remove the link, add candidate disposition metadata, or explicitly preserve an acceptable omission with model-authored reasoning.

For a concise shell-oriented quick-start covering build, API key setup, run flags, the TTY-safe wrapper, helper commands, and output inspection, see [`docs/world-import-run-guide.md`](./world-import-run-guide.md).

See `skills/world-import/references/contracts.md` for model-facing details.

## New world vs maintained world

A substantive import may produce a model-authored `World Overview` / `Corpus Synopsis` artifact as part of the normal artifact packet flow. That overview is not generated by the emitter; it is written and later revised by the model like any other artifact.

When importing additional source material into an existing output root, treat the emitted wiki as maintained world state rather than disposable output. Helper code should expose deterministic structure, provenance, and coverage for inspection, while the model decides whether new evidence enriches existing artifacts, introduces conflicts/retcons, or justifies new artifacts.

## Debugging model runs

Use debug mode when checking whether a model is following the skill workflow. For exploratory runs or retries after a no-output run, prefer a stronger model and include verbose tool updates by default:

```bash
npm run world-import-run -- --input ~/Downloads/pg11-images-3.epub --output /tmp/pg11-world --model openrouter/deepseek/deepseek-v4-pro --debug --show-tool-updates
```

The CLI prints status lines for argument resolution, pi auth/model paths, skill loading, active model, the `/skill:world-import` prompt, tool calls, model thinking deltas, session-strategy/stage summaries, and a final output summary. In staged mode it also reports extract/merge/review session boundaries explicitly. Thinking deltas are ANSI-styled only when stderr is attached to a TTY, so if you want italic/cyan live thinking blocks in a terminal or herdr pane, run the command directly instead of piping it through `tee`, `2>&1`, or similar shell pipelines. If you need a saved transcript without losing TTY behavior, prefer a pseudo-terminal capture tool such as `script` or rely on terminal/herdr scrollback.

A successful model turn with `worldMarkdownFiles: 0` means the model did not complete the import even if the process exited cleanly. In that case, rerun with a stronger model and keep `--show-tool-updates` enabled so tool-level failures are visible.
