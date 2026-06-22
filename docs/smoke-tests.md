# Smoke tests

Run these after changes that affect CLI startup, model selection, providers/extensions, or chat behavior.

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
- The session id/path after `/new` differs from the initial session id/path.
- Process exits with `bye`.

## 5. Memory debug output smoke test

```bash
rm -rf /tmp/memchat-debug-smoke
printf '/memory index\n/memory recall apple\n/exit\n' | npm run dev -- --memory qmd-hardwired --memory-dir /tmp/memchat-debug-smoke --memory-debug
```

Expected:

- Banner shows `Memory debug: on`.
- Italic/underscore memory debug lines print for qmd-compatible indexing and two-stage lexical recall. With no relevant markdown hits, debug output may show transcript fallback.
- Process exits with `bye`.

For markdown synthesis, use a configured model and optionally a cheaper summarizer model:

```bash
rm -rf /tmp/memchat-synthesis-smoke
printf 'Remember: the closet contains a brass telescope, old coats, and a locked cedar box.\n/exit\n' | npm run dev -- --memory qmd-hardwired --memory-dir /tmp/memchat-synthesis-smoke --model lemonade/Qwen3.6-35B-A3B-MTP-GGUF --summarizer-model lemonade/Qwen3.6-35B-A3B-MTP-GGUF --memory-debug
```

Expected: JSONL transcript is written immediately, markdown files under `/tmp/memchat-synthesis-smoke/memory/` contain synthesized bullets/facts/state rather than raw user/assistant transcript copies, and exit flushes pending markdown synthesis before compaction when synthesis succeeded.

For async/session-aware memory behavior, the automated test suite covers the deterministic cases that are hard to smoke manually:

```bash
npm test
```

Expected:

- A delayed markdown synthesizer does not block `afterTurn()` or immediate current-session recall.
- Failed markdown synthesis falls back to an unsynthesized summary without crashing queued work.
- Rapid turns preserve write order through the background queue.
- Current-session retcons render beside older persisted markdown as possible conflicts.
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

## Notes

- `.env` is local-only and ignored by git. It may contain values such as `MEMCHAT_LEMONADE_BASE_URL` and `MEMCHAT_LEMONADE_API_KEY`.
- Do not commit local provider endpoints, API keys, or generated output directories.
