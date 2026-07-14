# World import

Skill-first pipeline for turning HTML/XHTML directories, ZIPs, and EPUB-like archives into a provenance-rich, OKF-compatible markdown world wiki bundle.

## Getting started

### Execution supervision

Model-backed world-import runs are usually long-running. Use the active agent harness's supervised execution path for long, watched, or interactive runs; keep inline shell commands for quick one-shot inspection only.

### Build & prerequisites

```bash
npm install
npm run build
```

The CLI runs under `tsx`; build is only needed for the installed binary. Every embedded pi session is hermetic: it loads models and optional local credentials only from `<working-directory>/.memchat/pi/`, and never loads account-level pi skills, extensions, prompts, settings, models, or `AGENTS.md`.

Place project-specific custom model definitions in `.memchat/pi/models.json`. Credentials default to `.memchat/pi/auth.json`. To deliberately reuse another credentials file (such as an account-level pi auth file), opt in explicitly with `--auth-file` or `MEMCHAT_PI_AUTH_FILE`; this imports credentials only, not any other pi configuration. Provider environment variables also work directly:

```bash
MEMCHAT_PI_AUTH_FILE="$HOME/.pi/agent/auth.json" \
  npm run world-import-run -- --input ./sources --output /tmp/world
# or
export OPENROUTER_API_KEY="sk-or-..."
```

### Quick start

Use a fresh output directory per run; use `/tmp/` for disposable tests:

```bash
npm run world-import-run -- \
  --input samples/pg11-images-3.epub \
  --output /tmp/world-test \
  --model openrouter/deepseek/deepseek-v4-pro
```

### TTY-safe transcripts

For live runs, prefer the wrapper and `--transcript <path>`. It preserves ANSI thinking output and keeps a durable log:

```bash
npm run world-import-run -- \
  --transcript world-output/run.typescript \
  --input samples/pg11-images-3.epub \
  --output world-output/with-tty \
  --model openrouter/deepseek/deepseek-v4-pro
```

### Dry-run

Validate setup and normalization without semantic extraction:

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

For real imports, expect a long-running model-backed job; prefer a strong model, transcript, and debug output:

```bash
rm -rf /tmp/world-out 2>/dev/null
npm run world-import-run -- \
  --transcript /tmp/world-out.typescript \
  --input samples/pg11-images-3.epub \
  --output /tmp/world-out \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

If a run exits cleanly with `worldMarkdownFiles: 0`, it still failed to complete the import; rerun with a stronger model.

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
      post-merge-01.verify.json # optional action-scoped verification results
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

### Browser review over Tailscale

For a requested browser review of generated Markdown, start the pinned viewer in a supervised pane in its own `mdts` Herdr tab. It binds only to this server's active Tailscale IPv4 address, defaults to `world-output/`, and prints the private URL to share with the reviewer.

```bash
review_pane=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label mdts --no-focus \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).result.root_pane.pane_id))')
herdr pane rename "$review_pane" "review"
herdr pane run "$review_pane" "npm run markdown-review"
```

Keep the primary tab available for chat. Report the emitted `Markdown review URL` (the Tailscale DNS URL with its actual selected port), not the bind address or other process details. For an explicitly requested, repository-contained alternate tree, start a separate `mdts` tab rather than widening the default viewer:

```bash
herdr pane run "$review_pane" "npm run markdown-review storyboards"
```

Close the exact pane after review or before the agent session ends; its empty tab closes with it:

```bash
herdr pane close "$review_pane"
```

This is an on-demand, read-only browser review surface, not a public documentation host. If Tailscale address or DNS discovery fails, diagnose that local prerequisite; do **not** bind publicly, add a tunnel/reverse proxy, add viewer authentication, or leave a persistent service running. Browser preferences are isolated to a temporary runtime home and are discarded when the viewer stops.

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

Staged is the default for both CLI and direct runner use; pass `--session-strategy single` only for comparison or debugging. In staged runs with a reviewer model, the runner first writes a focused post-merge checkpoint under `stages/checkpoints/`. The initial checkpoint is `post-merge-01`: it runs after merge/emission and before final eval. `post-merge-01.review.json` records structured findings, requested actions, status (`no-action`, `repair-requested`, `repair-attempted`, `verified-repaired`, `residual`, or `skipped`), and reviewer parse state. If actionable findings are present, the runner invokes one bounded `stage: "repair"` model pass, writes `post-merge-01.repair.json`, then writes `post-merge-01.verify.json` with action-scoped structural checks. Semantic actions without a deterministic predicate remain explicitly residual rather than being claimed repaired. Single-session mode records a skipped checkpoint because it has no orchestrator-visible merge boundary.

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
| `--auth-file` / `MEMCHAT_PI_AUTH_FILE` | | optional path to an `auth.json` credential file; does not import other pi configuration |
| `--reviewer-model` / `MEMCHAT_WORLD_IMPORT_REVIEWER_MODEL` | | optional stronger reviewer model; omit to use active model; `off` or `--no-reviewer` to disable |
| `--session-strategy single\|staged` | | staged extract/merge/post-merge-review/repair/review or single session (default: `staged`) |
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
