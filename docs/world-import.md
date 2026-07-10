# World import

Skill-first pipeline for turning HTML/XHTML directories, ZIPs, and EPUB-like archives into a provenance-rich, OKF-compatible markdown world wiki bundle.

## Getting started

### Execution supervision

Before running world-import commands, check whether you are operating from herdr/pi and whether the `herdr` CLI is available. If it is, use herdr instead of defaulting to inline shell execution.

When operating from herdr/pi, run world-import-related project commands in a dedicated pane **below** the current pane whenever they are meant to be watched, may take more than a moment, or emit useful streaming output. Preferred command sequence:

```bash
herdr pane current
herdr pane split --current --direction down --cwd /home/squiddity/projects/memchat
herdr pane run <new-pane-id> 'npm run world-import-run -- --input ... --output ... --model ... --show-tool-updates'
herdr pane read <new-pane-id>
```

Use `herdr wait output <pane-id> --match '<text>'` when you need to block until a known milestone appears, and `herdr pane send-text` plus `herdr pane send-keys <pane-id> Enter` only when reusing an existing interactive shell. This covers `npm run world-import-run`, model-backed import test runs, `npm run world-import-helper -- lint|eval|provenance-audit`, helper/repair loops, and repeated source-search/provenance workflows. Avoid side panes for routine supervision, and do not hide these runs behind `nohup`, background `bash`, or detached transcripts unless no pane tool is available. Use existing skill/helper/tool entrypoints before ad hoc scripts. If herdr is unavailable, say so and then fall back to inline execution.

### Build & prerequisites

```bash
npm install
npm run build
```

The CLI runs under `tsx` without a build; the build is only needed for the installed binary.

Prerequisites use pi's SDK auth/credential resolution:

- Auth: `~/.pi/agent/auth.json` — API keys per provider
- Models: `~/.pi/agent/models.json` — custom model registrations
- Environment: `.env` in the repo root is loaded automatically

If you don't have a pi auth file, set the env var directly:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

### Quick start

Use a distinct output subdirectory per run:

```bash
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output world-output/alice-2026-06-26 \
  --model openrouter/deepseek/deepseek-v4-pro
```

For quick test runs, use `/tmp/`:

```bash
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output /tmp/world-test \
  --model openrouter/deepseek/deepseek-v4-pro
```

### TTY-safe thinking output

Thinking deltas are ANSI-styled only when stderr is attached to a TTY. Pipelines like `tee`, `2>&1`, or process substitution make stderr non-TTY, so the CLI falls back to plain text.

**For live terminal/herdr runs, prefer the wrapper.** It avoids the non-TTY pitfall and supports `--transcript <path>` for saved captures with ANSI output intact:

```bash
npm run world-import-run -- \
  --transcript world-output/run.typescript \
  --input samples/pg11-images-3.epub \
  --output world-output/with-tty \
  --model openrouter/deepseek/deepseek-v4-pro
```

Alternatively, use `script` for a pseudo-terminal:

```bash
script -qef world-output/run.typescript -c 'npm run world-import -- --input samples/pg11-images-3.epub --output world-output/with-tty --model openrouter/deepseek/deepseek-v4-pro'
```

### Dry-run

Validates setup and normalization without semantic extraction:

```bash
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output /tmp/world-dry \
  --model openrouter/google/gemma-4-31b-it:free \
  --dry-run
```

In staged mode, dry-run stops after the extract-stage setup path rather than continuing to merge or review.

### Normalize only (deterministic, no model)

```bash
npm run world-import-helper -- normalize --input samples/pg11-images-3.epub --output world-output/alice-normalize
npm run world-import-helper -- list-units --output world-output/alice-normalize
npm run world-import-helper -- read-unit --output world-output/alice-normalize --unit <unit-id>
```

### Full model-backed import

Prefer a stronger model with debug output:

```bash
rm -rf /tmp/world-out 2>/dev/null
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output /tmp/world-out \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

A successful run with `worldMarkdownFiles: 0` means the model did not complete the import even if the process exited cleanly. Rerun with a stronger model.

### Silence debug/thinking output

```bash
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output /tmp/world-out \
  --model openrouter/google/gemma-4-31b-it:free \
  --thinking off
```

## Output

### Layout

```
<output-root>/
  sources/
    manifest.json               # unit listing + diagnostics
    normalized/<unit-id>.json   # one per source unit
  stages/
    extraction/<unit-id>.json   # model-authored candidates
    merge/merged-candidates.json
    checkpoints/
      post-merge-01.review.json # optional staged intermediate review packet
      post-merge-01.repair.json # optional bounded repair summary
    review.json                 # final evaluation result
  world/
    index.md                    # root wiki index
    log.md                      # deterministic update log
    coverage.md                 # source-to-artifact coverage view
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
      units/                    # retained normalized source-unit pages for provenance
```

### Inspecting a run

```bash
echo "--- manifest units ---"; node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/world-out/sources/manifest.json','utf8')).units.length)"
echo "--- extraction stages ---"; find /tmp/world-out/stages/extraction -name '*.json' 2>/dev/null | wc -l
echo "--- merge stage ---"; ls /tmp/world-out/stages/merge/merged-candidates.json 2>/dev/null && echo "yes" || echo "no"
echo "--- staged checkpoints ---"; find /tmp/world-out/stages/checkpoints -name '*.json' 2>/dev/null | sort
echo "--- world markdown files ---"; find /tmp/world-out/world -name '*.md' 2>/dev/null | wc -l
echo "--- root index ---"; test -f /tmp/world-out/world/index.md && echo yes || echo no
echo "--- source-unit pages ---"; find /tmp/world-out/world/sources/units -name '*.md' 2>/dev/null | wc -l
```

A healthy bundle includes concept pages under `world/people`, `world/places`, `world/things`, `world/facts`, `world/index.md`, group/source indexes, `world/log.md`, `world/coverage.md`, retained source-unit pages, optional style guides, and — for substantive narrative corpora — first-class plot surfaces such as a `Plot Synopsis` / `Corpus Synopsis`, `Timeline`, and `Scene Guide` / `Chapter Guide` / `Episode Guide` as normal emitted artifacts.

## Linting & eval

Run deterministic lint after emission:

```bash
npm run world-import-helper -- lint --output /tmp/world-out
```

Lint reports unresolved concept links and `[[wikilinks]]`, missing provenance targets/anchors, missing frontmatter/indexes, body-unit coverage gaps, and extraction-candidate accounting gaps.

In staged CLI runs with a reviewer model, the runner first writes a focused post-merge checkpoint under `stages/checkpoints/`. The initial MVP checkpoint is `post-merge-01`: it runs after merge/emission and before final eval. `post-merge-01.review.json` records structured findings, requested actions, status (`no-action`, `repair-requested`, `repair-attempted`, `residual`, or `skipped`), and reviewer parse state. If actionable findings are present, the runner invokes one bounded `stage: "repair"` model pass and writes `post-merge-01.repair.json` with attempted action ids and residual findings. Single-session mode records a skipped checkpoint because it has no orchestrator-visible merge boundary.

Then run eval — it embeds the same lint result in `stages/review.json` with optional reviewer-model scoring:

```bash
npm run world-import-helper -- eval --output /tmp/world-out --reviewer-model openrouter/google/gemma-4-31b-it:free
```

Omit `--reviewer-model` for deterministic checks only. Reviewer prompts include artifact-only plot reconstruction, plot-surface quality gates, dropped-candidate risk, source-structure coverage, object/prop coverage, omission visibility, and style/tone usefulness checks. Intermediate checkpoint reviews are not replacements for this final eval; they are bounded repair aids whose artifacts remain inspectable under `stages/checkpoints/`.

`stages/review.json` now carries more than a single score. Inspect at least:

- `deterministic.riskSignals` for non-failing warnings such as `missing-plot-synopsis`, `missing-timeline`, `missing-scene-guide`, and `empty-things-group`.
- `deterministic.provenanceAudit` for provenance-quality warnings that should not be ignored just because lint passed.
- `reviewer.parseStatus`, `reviewer.authoritativeScore`, and `reviewer.parseErrors` to distinguish valid structured reviewer output from missing/partial/invalid parsing.
- Reviewer dimension scores for `plotSynopsisQuality`, `timelineCompleteness`, `sourceStructureCoverage`, `objectPropCoverage`, and `omissionVisibility`.

Clean lint and clean provenance structure are necessary but not sufficient: a structurally tidy bundle without useful plot surfaces should still look risky in eval.

For iterative repair, use the helper loop:

```bash
npm run world-import-helper -- repair-summary --output /tmp/world-out
npm run world-import-helper -- emit-lint-repair-loop --output /tmp/world-out
```

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

## Alice regression fixture

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

Inspect whether lint catches unresolved links, candidate dispositions explain dropped Chapter III/X material, source pages show paragraph/poem/pre granularity, the root index exposes plot-reading surfaces, and `stages/review.json` shows narrative-risk warnings / parse status clearly when synopsis-timeline-scene coverage is weak.

---

## Reference

### CLI flags

| Flag | Env | Description |
|---|---|---|
| `--input` | | HTML/XHTML directory, `.zip`, or `.epub` archive |
| `--output` | | output root |
| `--model` / `MEMCHAT_WORLD_IMPORT_MODEL` | | model used by the skill |
| `--reviewer-model` / `MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL` | | optional stronger reviewer model; omit to use active model; `off` or `--no-reviewer` to disable |
| `--session-strategy single\|staged` | | single session or staged extract/merge/post-merge-review/repair/review (default: `single`) |
| `--thinking` | | pi thinking level (default: `low`; `off` to disable) |
| `--dry-run` | | validate without semantic extraction |
| `--debug` / `MEMCHAT_WORLD_IMPORT_DEBUG=1` | | startup, paths, model selection, prompt, tool call diagnostics to stderr (default: on; `0` to silence) |
| `--show-thinking` / `MEMCHAT_WORLD_IMPORT_SHOW_THINKING=1` | | print model thinking deltas (default: on) |
| `--show-tool-updates` / `MEMCHAT_WORLD_IMPORT_SHOW_TOOL_UPDATES=1` | | print verbose tool update payloads (default: off) |

Equivalent installed binary:

```bash
memchat-world-import --input ./sources --output world-output/my-corpus --model anthropic/claude-sonnet-4-5
```

### Architecture

The architecture keeps semantics in skills and model prompts. TypeScript helper code handles deterministic operations only:

- normalize source files and archives;
- create portable source/unit ids and block anchors;
- list units and read bounded source slices;
- persist generic stage envelopes and structural candidate dispositions;
- emit model-authored artifact packets (concept pages, indexes, logs, coverage views, style guides, citation targets);
- lint emitted bundles for structural link, provenance, coverage, and candidate-accounting diagnostics.

It does **not** decide entity identity, aliases, relationships, conflicts, fact semantics, or synopsis/update quality.

### Stage contract

Extraction candidates are model-authored and opaque to helper code except for routing/provenance envelope fields and candidate ids. Merge output should account for every extraction candidate by listing represented candidate ids on artifacts or stage-level dispositions (`represented`, `merged`, `deferred`, `dropped`); dropped/deferred candidates require a model-authored reason. Helpers check accounting completeness only, not semantic quality.

Emission produces concept pages, optional style-guide pages under `world/style/`, and bundle-local source-unit pages so provenance links resolve within the wiki bundle. Synopsis text, continuity decisions, conflict handling, style/tone analysis, and existing-world update judgment remain model-owned.

### Provenance

`SourceSpanRef` is the canonical evidence model. Normalization preserves paragraph-level prose blocks and line-preserving poem/preformatted blocks with block metadata (role, source path, block kind, hashes). EPUB inputs use OPF spine/nav/package metadata when available.

In the emitted wiki, provenance links resolve to retained normalized source-unit pages under `world/sources/units/`. These are a v1 citation target — they preserve original path metadata but are normalized representations, not perfect original-format selectors like EPUB CFIs or page numbers.

### New vs maintained world

A substantive import should usually produce model-authored narrative-surface artifacts as part of the normal artifact flow: a `Plot Synopsis` / `Corpus Synopsis`, a `Timeline`, and a `Scene Guide` / `Chapter Guide` / `Episode Guide` when the source has that structure. These pages remain model-authored packets under the existing taxonomy (typically `world/facts/`); helper code may promote or inspect them, but does not write their prose or decide scene/object importance.

When importing additional source into an existing output root, treat the wiki as maintained world state. Helpers expose deterministic structure, provenance, and coverage for inspection; the model decides whether new evidence enriches existing artifacts, introduces conflicts/retcons, or justifies new artifacts.

### Debugging

Use `--debug --show-tool-updates` for exploratory runs or retries after a no-output run. The CLI prints status lines for argument resolution, pi auth/model paths, skill loading, active model, the `/skill:world-import` prompt, tool calls, thinking deltas, session-strategy/stage summaries, and a final output summary. In staged mode, it also reports extract/merge/post-merge-review/repair/review session boundaries explicitly.

### Related

- [`docs/architecture.md`](./architecture.md) — project architecture
- [`skills/world-import/SKILL.md`](../skills/world-import/SKILL.md) — the skill the CLI loads
- [`skills/world-import/references/contracts.md`](../skills/world-import/references/contracts.md) — stage envelope contracts
- [`skills/world-import/references/helper-tools.md`](../skills/world-import/references/helper-tools.md) — helper tool reference
