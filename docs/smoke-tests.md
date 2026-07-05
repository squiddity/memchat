# Smoke tests

Run these after changes that affect CLI startup, model selection, providers/extensions, chat behavior, or world-import helpers.

For longer-running smoke jobs in herdr, prefer a dedicated pane **below** the current pane and monitor that pane instead of opening a side pane. For world-import runs you are watching live, prefer `npm run world-import-run -- ...` over `npm run world-import -- ...`, including dry runs.

## 1. Build

```bash
npm run build
```

Expected: TypeScript completes without errors.

## 2. Hello-world CLI without model interaction

This verifies startup, local `.env` loading, command parsing, and clean shutdown without sending a model prompt.

```bash
printf '/help\n/model\n/exit\n' | npm run dev
```

Expected:

- Banner prints.
- `/help` lists commands, including `/memory`.
- `/model` prints either `none selected` or the selected/default model.
- Process exits with `bye`.

## 3. Memory backend command smoke test

```bash
rm -rf /tmp/memchat-smoke-memory
printf '/memory\n/memory backends\n/memory index\n/exit\n' | npm run dev -- --memory qmd-hardwired --memory-dir /tmp/memchat-smoke-memory
```

Expected:

- Banner shows `Memory: qmd-hardwired`.
- `/memory` reports qmd status and `/tmp/memchat-smoke-memory` paths.
- `/memory backends` lists hardwired and skill memory modes.
- `/memory index` completes without an external server.

## 4. New session command smoke test

```bash
rm -rf /tmp/memchat-new-smoke
printf '/memory status\n/new\n/memory status\n/exit\n' | npm run dev -- --memory transcript --memory-dir /tmp/memchat-new-smoke
```

Expected:

- Both `/memory status` outputs show the same root.
- `/new` prints `Starting new session; flushing and compacting memory before the next prompt...` before `Started new session`.
- The session id/path after `/new` differs from the initial session id/path, and the next `you>` prompt appears only after `Started new session`.
- `/exit` prints `Shutting down; flushing memory before exit...` and exits with `bye`.

## 5. Memory debug output smoke test

```bash
rm -rf /tmp/memchat-debug-smoke
printf '/memory index\n/memory recall apple\n/exit\n' | npm run dev -- --memory qmd-hardwired --memory-dir /tmp/memchat-debug-smoke --memory-debug
```

Expected:

- Banner shows `Memory debug: on`.
- Italic/underscore memory debug lines print for qmd-compatible indexing and two-stage lexical recall. With no relevant markdown hits, debug output may show transcript fallback.
- In an interactive terminal or pi interactive shell, async memory debug blocks appear as separate scrollback lines; they should not overwrite or visually merge with the active `you>` prompt or partially typed input.
- Process exits with `bye`.

For markdown synthesis, use a configured model and optionally a cheaper summarizer model:

```bash
rm -rf /tmp/memchat-synthesis-smoke
printf 'Remember: the closet contains a brass telescope, old coats, and a locked cedar box.\n/exit\n' | npm run dev -- --memory qmd-hardwired --memory-dir /tmp/memchat-synthesis-smoke --model lemonade/Qwen3.6-35B-A3B-MTP-GGUF --summarizer-model lemonade/Qwen3.6-35B-A3B-MTP-GGUF --memory-debug
```

Expected: JSONL transcript is written immediately, markdown files under `/tmp/memchat-synthesis-smoke/memory/` contain synthesized bullets/facts/state rather than raw user/assistant transcript copies, and exit flushes pending markdown synthesis before compaction when synthesis succeeded.

For the improved interactive memory UX, use a pi interactive shell or a local terminal with a clean directory:

```bash
rm -rf /tmp/memchat-ux-smoke
npm run dev -- --memory qmd-hybrid --memory-dir /tmp/memchat-ux-smoke --memory-debug --model lemonade/Qwen3.6-35B-A3B-MTP-GGUF --summarizer-model lemonade/Qwen3.6-35B-A3B-MTP-GGUF
```

Manual scenario:

1. Tell memchat a durable story detail, for example `The observatory inventory contains a brass telescope.`
2. Type an accidental line such as `asdf banana mistake`, then run `/memory ignore last`.
3. Ask about the observatory inventory and/or run `/memory recall banana`; ignored accidental content should not appear in injected memory or recall, while the JSONL transcript still contains an ignore audit record.
4. Run `/new`; expect `Starting new session; flushing and compacting memory before the next prompt...` followed by `Started new session` before the next `you>` prompt.
5. Ask for the durable story detail again; qmd-hybrid should be able to recall useful persisted state while excluding the ignored turn.

For async/session-aware memory behavior, the automated test suite covers the deterministic cases that are hard to smoke manually:

```bash
npm test
```

Expected:

- A delayed markdown synthesizer does not block `afterTurn()` or immediate current-session recall.
- Failed markdown synthesis falls back to an unsynthesized summary without crashing queued work.
- Rapid turns preserve write order through the background queue.
- Current-session retcons render beside older persisted markdown as possible conflicts.
- Ignored recent turns are excluded from current-session hits, source-cited markdown recall, and future compaction inputs while retaining audit records.
- Low-value current-session chatter does not displace stronger story/state memory when prompt hits are capped.
- `/memory status` reports queue state without flushing, while `/memory index` remains flush-aware.

## 6. QMD skill retrieval mode smoke test

```bash
printf '/memory\n/exit\n' | npm run dev -- --memory qmd-skill-retrieval
```

Expected:

- Banner shows `Memory: qmd-skill-retrieval`.
- Banner notes that built-in pi tools are enabled so declared qmd skill Bash usage can run.
- `/memory` reports qmd status and `.memchat` paths.

Note: this smoke test requires `npm install` to have completed successfully so local `@tobilu/qmd`, its package-provided skill, and the local `qmd` executable are present. End-to-end qmd skill evaluation additionally requires using a configured model.

## 7. Model listing / selection smoke test

If local Lemonade env is configured in `.env`, verify provider discovery:

```bash
npm run dev -- --list-models lemonade
```

Expected: `lemonade/...` models are listed with `*` when auth/config is available.

Then verify interactive selection without prompting the model. Prefer a known chat-capable local model; currently `lemonade/Qwen3.6-35B-A3B-MTP-GGUF` is the primary smoke-test model in Alan's local setup.

```bash
printf '/model list lemonade\n/model lemonade/Qwen3.6-35B-A3B-MTP-GGUF\n/model\n/exit\n' | npm run dev
```

Expected:

- `/model list lemonade` lists local models.
- `/model lemonade/Qwen3.6-35B-A3B-MTP-GGUF` switches successfully.
- `/model` shows the selected Lemonade model.

If Lemonade is unavailable, use another configured provider/model from:

```bash
npm run dev -- --list-models
```

## 8. Actual model interaction

Use a configured chat-capable model and send a trivial prompt:

```bash
printf 'Say hello in one short sentence.\n/exit\n' | npm run dev -- --model lemonade/Qwen3.6-35B-A3B-MTP-GGUF
```

Expected:

- The assistant streams a short hello response.
- The process remains interactive until `/exit`.

If using a different configured model, replace `lemonade/Qwen3.6-35B-A3B-MTP-GGUF` with that provider/model. If the command prints `Command aborted` without an assistant response, retry once after checking the local model server; this can indicate a transient Lemonade/server-side failure rather than a memchat CLI failure.

## 9. World import helper smoke test

For deterministic world-import helper changes:

```bash
rm -rf /tmp/memchat-world-smoke /tmp/memchat-world-src
mkdir -p /tmp/memchat-world-src
cat > /tmp/memchat-world-src/chapter1.html <<'HTML'
<html><head><title>Chapter One</title></head><body><p>Ada guards the glass tower.</p><p>The tower overlooks Moon Bay.</p></body></html>
HTML
npm --silent run world-import-helper -- normalize --input /tmp/memchat-world-src --output /tmp/memchat-world-smoke
npm --silent run world-import-helper -- list-units --output /tmp/memchat-world-smoke
UNIT_JSON=$(npm --silent run world-import-helper -- list-units --output /tmp/memchat-world-smoke)
SOURCE_ID=$(node -e 'const units = JSON.parse(process.argv[1]); console.log(units[0].sourceId)' "$UNIT_JSON")
UNIT_ID=$(node -e 'const units = JSON.parse(process.argv[1]); console.log(units[0].unitId)' "$UNIT_JSON")
cat > /tmp/memchat-world-merge.json <<JSON
{
  "version": 1,
  "kind": "merge",
  "artifacts": [
    {
      "id": "ada",
      "group": "people",
      "type": "Character",
      "title": "Ada",
      "description": "Tower guardian overlooking Moon Bay.",
      "sections": [{ "heading": "Summary", "body": "Ada guards the glass tower." }],
      "provenance": [{ "sourceId": "$SOURCE_ID", "unitId": "$UNIT_ID", "startAnchor": "b0001", "endAnchor": "b0001", "quote": "Ada guards the glass tower." }]
    }
  ]
}
JSON
npm --silent run world-import-helper -- write-merge --output /tmp/memchat-world-smoke < /tmp/memchat-world-merge.json
npm --silent run world-import-helper -- emit --output /tmp/memchat-world-smoke
npm --silent run world-import-helper -- lint --output /tmp/memchat-world-smoke
npm --silent run world-import-helper -- eval --output /tmp/memchat-world-smoke
```

Expected: `manifest.json` is written, at least one normalized unit appears, anchors such as `b0001`/`b0002` are present at paragraph granularity, `world/index.md` exists, lint passes with no unresolved concept links, candidate-accounting, coverage, or source-anchor diagnostics, and every emitted provenance link resolves to a retained source-unit page under `world/sources/units/` for the cited unit(s).

For model-backed world import, use a configured model and a scratch output dir. If you are monitoring the run live, do it in the lower herdr job pane and prefer the wrapper even for dry-run:

```bash
npm run world-import-run -- --input /tmp/memchat-world-src --output /tmp/memchat-world-smoke --model lemonade/Qwen3.6-35B-A3B-MTP-GGUF --dry-run
```

Expected: the skill loads and reports normalization/listing results without doing semantic extraction in dry-run mode. In staged mode, dry-run still stops after the extract-stage setup path. For full model-backed world-import regressions, use a fresh output directory, a stronger model when behavior is uncertain, `--debug`, and `--show-tool-updates`; for Alice-style runs, additionally inspect unresolved links, candidate dispositions, body-unit coverage, retained poem/pre formatting, and style-guide output.

## Notes

- `.env` is local-only and ignored by git. It may contain values such as `MEMCHAT_LEMONADE_BASE_URL` and `MEMCHAT_LEMONADE_API_KEY`.
- Do not commit local provider endpoints, API keys, or generated output directories.
