# World import run guide

Quick reference for running `memchat-world-import` from the shell.

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

## Normalize only (deterministic, no model)

```bash
npm run world-import-helper -- normalize --input ~/Downloads/pg11-images-3.epub --output /tmp/world-normalize
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

```bash
rm -rf /tmp/world-out 2>/dev/null
npm run world-import -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-out \
  --model openrouter/google/gemma-4-31b-it:free \
  --thinking off
```

## Dry-run (validate setup without model extraction)

```bash
npm run world-import -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-dry \
  --model openrouter/google/gemma-4-31b-it:free \
  --thinking off \
  --dry-run
```

## Debug mode

Shows startup paths, auth resolution, model selection, the full skill prompt, tool calls/ends, and a final output summary:

```bash
npm run world-import -- \
  --input ~/Downloads/pg11-images-3.epub \
  --output /tmp/world-debug \
  --model openrouter/google/gemma-4-31b-it:free \
  --thinking off \
  --debug --show-tool-updates
```

## Inspecting output

After a run, check whether world artifacts were produced:

```bash
echo "--- manifest units ---"; node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/world-out/sources/manifest.json','utf8')).units.length)"

echo "--- extraction stages ---"; find /tmp/world-out/stages/extraction -name '*.json' 2>/dev/null | wc -l
echo "--- merge stage ---"; ls /tmp/world-out/stages/merge/merged-candidates.json 2>/dev/null && echo "yes" || echo "no"
echo "--- world markdown files ---"; find /tmp/world-out/world -name '*.md' 2>/dev/null | wc -l
```

A run that exits code 0 with `world markdown files: 0` means the model did not complete the import workflow.

## Evaluating output

```bash
npm run world-import-helper -- eval --output /tmp/world-out --reviewer-model openrouter/google/gemma-4-31b-it:free
```

Omit `--reviewer-model` to run deterministic checks only (no model scoring).

## Helper cheat sheet

```bash
npm run world-import-helper -- normalize --input <path> --output <dir>
npm run world-import-helper -- list-units --output <dir>
npm run world-import-helper -- read-unit --output <dir> --unit <unit-id>
npm run world-import-helper -- read-slice --output <dir> --unit <unit-id> --start <anchor> --end <anchor>
npm run world-import-helper -- write-extraction --output <dir> --unit <unit-id> < stage.json
npm run world-import-helper -- write-merge --output <dir> < merged-stage.json
npm run world-import-helper -- emit --output <dir>
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
    people/                     # artifact markdown
    places/
    things/
    facts/
```

## Related docs

- [`docs/world-import.md`](./world-import.md) — architecture, CLI flags, contract boundary
- [`skills/world-import/SKILL.md`](../skills/world-import/SKILL.md) — the skill the CLI loads
- [`skills/world-import/references/contracts.md`](../skills/world-import/references/contracts.md) — stage envelope contracts
