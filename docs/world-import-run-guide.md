# World import run guide

Quick reference for running `memchat-world-import` from the shell.

When running imports, evals, or other longer-lived shell jobs from herdr, use a dedicated pane **below** the current pane and monitor it there. Avoid side panes for routine job supervision.

Preferred wrapper for live terminal/herdr runs, including dry runs:

```bash
npm run world-import-run -- --input <path> --output <dir> --model <provider/model>
```

## Build

```bash
npm install
npm run build
```

The world-import CLI runs fine under `tsx` without a build step; the build is only needed for the installed binary.

## Prerequisites

The world-import CLI uses pi's SDK auth/credential resolution:

- Auth: `~/.pi/agent/auth.json` — contains API keys per provider
- Models: `~/.pi/agent/models.json` — custom model registrations
- Environment: `.env` in the repo root is loaded automatically (same as the main memchat CLI)

If you don't have a pi auth file, set the relevant env var directly:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

Or add it to `.env` in the repo root:

```bash
echo 'OPENROUTER_API_KEY="sk-or-..."' >> .env
```

## Output directory convention

The repo has a gitignored `world-output/` directory at the project root for persistent extraction results.
Use a distinct subdirectory per run to avoid collisions:

```bash
# Name by source material and date
npm run world-import-run -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output world-output/alice-2026-06-26 \
  --model openrouter/deepseek/deepseek-v4-pro
```

For quick test runs, use `/tmp/` instead:

```bash
npm run world-import-run -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-test \
  --model openrouter/deepseek/deepseek-v4-pro
```

## Maintained-world note

World-import is moving toward maintained world updates, where later source material enriches an existing world bundle instead of replacing it conceptually. The current helper/emitter surface is already useful for inspecting and revising an existing bundle, but `emit` still rewrites `world/`, so repeated imports into the same output root should be treated as a deliberate maintenance workflow rather than a casual rerun.

When doing that kind of update work, inspect the existing bundle first:

- `world/index.md`
- relevant group indexes and artifact pages
- `world/coverage.md`
- `world/log.md`
- the prior `World Overview` / `Corpus Synopsis` artifact if present

Then merge new source evidence into maintained artifacts and preserve older provenance/conflicts visibly when they still matter.

## Normalize only (deterministic, no model)

```bash
npm run world-import-helper -- normalize --input ~/Downloads/pg11-images-3.epub --output world-output/alice-normalize
```

Inspect the manifest:

```bash
npm run world-import-helper -- list-units --output /tmp/world-normalize
```

Read a specific unit:

```bash
npm run world-import-helper -- read-unit --output /tmp/world-normalize --unit <unit-id>
```

Read a slice between anchors:

```bash
npm run world-import-helper -- read-slice --output /tmp/world-normalize --unit <unit-id> --start b0001 --end b0003
```

## Full model-backed import

For normal or recovery runs, prefer a stronger model and keep debug output enabled. If you want TTY-safe thinking output, prefer the wrapper:

```bash
rm -rf /tmp/world-out 2>/dev/null
npm run world-import-run -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-out \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

The wrapper runs `npm run world-import -- ...` directly, avoids the common non-TTY logging pitfall, and supports `--transcript <path>` when you want a saved terminal capture without losing ANSI-styled thinking output.

## TTY-safe live output in a terminal or herdr pane

Thinking deltas are ANSI-styled by the CLI only when stderr is attached to a TTY. If you want italic/cyan thinking blocks in a terminal or herdr pane, prefer the wrapper or otherwise run the importer directly.

Use this pattern:

```bash
npm run world-import-run -- \
  --input samples/pg120-images-3.epub \
  --output world-output/pg120-images-3-$(date +%Y%m%d-%H%M%S) \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

Avoid this when you care about styled live output:

```bash
npm run world-import -- ... 2>&1 | tee world-output/run.log
```

`tee`, `2>&1`, process substitution, and similar pipelines make stderr non-TTY, so the CLI falls back to plain text thinking output.

If you need both live styled output and a saved transcript, prefer one of these:

- run directly in the herdr pane and use pane scrollback/history for review;
- or use the wrapper with `--transcript`:

```bash
npm run world-import-run -- \
  --transcript world-output/pg120-run.typescript \
  --input samples/pg120-images-3.epub \
  --output world-output/pg120-images-3-tty \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

- or use `script` yourself, which keeps a pseudo-terminal attached:

```bash
script -qef world-output/pg120-run.typescript -c 'npm run world-import -- --input samples/pg120-images-3.epub --output world-output/pg120-images-3-tty --model openrouter/deepseek/deepseek-v4-pro --show-tool-updates'
```

To silence debug/thinking output:

```bash
npm run world-import-run -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-out \
  --model openrouter/google/gemma-4-31b-it:free \
  --thinking off
```

## Dry-run (validate setup without model extraction)

Use the wrapper for observed dry runs too so ANSI output and job supervision stay consistent with full imports:

```bash
npm run world-import-run -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-dry \
  --model openrouter/google/gemma-4-31b-it:free \
  --dry-run
```

Dry-run stops after setup/normalization and helper-surface validation. If you also pass `--session-strategy staged`, dry-run still stops after the extract-stage setup path rather than continuing to merge or review.

## Verbose tool update output

Debug and thinking are on by default. When a run is exploratory, recovering from a failed/no-output attempt, or using a less-trusted model, treat `--show-tool-updates` as the default so you can inspect tool-level failures and partial workflow progress. To preserve ANSI-styled thinking blocks, keep this as a direct TTY-attached run rather than piping through `tee`:

```bash
npm run world-import-run -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-debug \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

## During model-backed imports

The `world-import` skill should use deterministic helper tools for provenance and merge operations instead of ad hoc scripts. If a run shows the model writing source-id mapping code, `sid()` / `uid()` / `ref()` helpers, giant JSON-generation scripts, or placeholder quote strings, prefer the helper commands documented in `skills/world-import/references/helper-tools.md`.

Common helper checks during or after a run:

```bash
npm run world-import-helper -- coverage-plan --output /tmp/world-out
npm run world-import-helper -- repair-summary --output /tmp/world-out
npm run world-import-helper -- emit-lint-repair-loop --output /tmp/world-out
```

## Inspecting output

After a run, check whether the wiki bundle was produced:

```bash
echo "--- manifest units ---"; node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/world-out/sources/manifest.json','utf8')).units.length)"

echo "--- extraction stages ---"; find /tmp/world-out/stages/extraction -name '*.json' 2>/dev/null | wc -l
echo "--- merge stage ---"; ls /tmp/world-out/stages/merge/merged-candidates.json 2>/dev/null && echo "yes" || echo "no"
echo "--- world markdown files ---"; find /tmp/world-out/world -name '*.md' 2>/dev/null | wc -l
echo "--- root index ---"; test -f /tmp/world-out/world/index.md && echo yes || echo no
echo "--- source-unit pages ---"; find /tmp/world-out/world/sources/units -name '*.md' 2>/dev/null | wc -l
```

A run that exits code 0 with `world markdown files: 0` means the model did not complete the import workflow.

A healthy wiki bundle should normally include:

- concept pages under `world/people`, `world/places`, `world/things`, and `world/facts`
- `world/index.md` plus group/source indexes
- `world/log.md` and `world/coverage.md`
- retained source-unit pages under `world/sources/units/` for provenance inspection
- optional model-authored style guides under `world/style/`
- for substantive corpora, a model-authored `World Overview` / `Corpus Synopsis` artifact that links to the detailed pages it summarizes

## Linting and evaluating output

Run deterministic lint immediately after emission:

```bash
npm run world-import-helper -- lint --output /tmp/world-out
```

Lint reports unresolved concept links and `[[wikilinks]]`, missing provenance targets/anchors, missing frontmatter/indexes, body-unit coverage gaps, and extraction-candidate accounting gaps. Repair the merge packet or explicitly account for intentional omissions before declaring the import healthy.

Then run eval; it embeds the same deterministic lint result in `stages/review.json` and can optionally call a reviewer model. Run that eval in the same lower herdr job pane pattern. The main `world-import` CLI now defaults the reviewer model to the active import model when `--reviewer-model` is omitted, but manual helper runs still let you override it explicitly:

```bash
npm run world-import-helper -- eval --output /tmp/world-out --reviewer-model openrouter/google/gemma-4-31b-it:free
```

Omit `--reviewer-model` to run deterministic checks only (no model scoring). Reviewer prompts include source reconstruction, dropped-candidate risk, and style/tone usefulness checks.

## Helper cheat sheet

```bash
npm run world-import-helper -- normalize --input <path> --output <dir>
npm run world-import-helper -- list-units --output <dir>
npm run world-import-helper -- read-unit --output <dir> --unit <unit-id>
npm run world-import-helper -- read-slice --output <dir> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- resolve-ref --output <dir> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- quote-ref --output <dir> --unit <unit-id> --start <anchor> --end <anchor> --as-ref
npm run world-import-helper -- validate-artifact --output <dir> --file artifact.json
npm run world-import-helper -- write-artifact --output <dir> --mode upsert --file artifact.json
npm run world-import-helper -- patch-merge --output <dir> --file patch.json
npm run world-import-helper -- coverage-plan --output <dir>
npm run world-import-helper -- repair-summary --output <dir>
npm run world-import-helper -- emit-lint-repair-loop --output <dir>
npm run world-import-helper -- write-extraction --output <dir> --unit <unit-id> < stage.json
npm run world-import-helper -- write-merge --output <dir> < merged-stage.json
npm run world-import-helper -- emit --output <dir>
npm run world-import-helper -- lint --output <dir>
npm run world-import-helper -- eval --output <dir> [--reviewer-model <model>]
npm run world-import-helper -- validate-stage --kind extraction --file stage.json
npm run world-import-helper -- validate-stage --kind merge --file stage.json
```

## File layout

```
<output-root>/
  sources/
    manifest.json               # unit listing + diagnostics
    normalized/<unit-id>.json   # one per source unit
  stages/
    extraction/<unit-id>.json   # model-authored candidates (skill-owned)
    merge/merged-candidates.json
    review.json                 # optional evaluation result
  world/
    index.md                    # root wiki index
    log.md                      # deterministic update log
    coverage.md                 # source-to-artifact coverage view
    people/                     # concept markdown + group index
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
      units/                    # retained normalized source-unit pages for provenance links
```

## Alice manual regression fixture

For Alice-style literary regressions, place a public-domain Gutenberg EPUB at `samples/pg11-images-3.epub` (or use `~/Downloads/pg11-images-3.epub`) and run with a fresh output directory, a stronger model when uncertain, `--debug`, and `--show-tool-updates`. Prefer a dedicated lower herdr pane for the import and keep monitoring that pane through lint/eval:

```bash
rm -rf /tmp/alice-world
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output /tmp/alice-world \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
npm run world-import-helper -- lint --output /tmp/alice-world
npm run world-import-helper -- eval --output /tmp/alice-world --reviewer-model openrouter/deepseek/deepseek-v4-pro
```

Inspect whether lint catches unresolved links such as omitted event pages, whether candidate dispositions explain dropped Chapter III/Chapter X material, whether source pages show paragraph/poem/pre granularity instead of chapter-sized anchors, and whether reviewer output can reconstruct the Caucus-Race, White Rabbit's house, Caterpillar conversation, Mad Tea-Party, croquet game, Mock Turtle story, Lobster Quadrille, trial, dream frame, and style/tone guidance.

## Related docs

- [`docs/world-import.md`](./world-import.md) — architecture, CLI flags, contract boundary
- [`skills/world-import/SKILL.md`](../skills/world-import/SKILL.md) — the skill the CLI loads
- [`skills/world-import/references/contracts.md`](../skills/world-import/references/contracts.md) — stage envelope contracts
