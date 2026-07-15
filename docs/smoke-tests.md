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

## 9. World-import targeted regression checks

Run these after changes to world-import emit/eval/provenance behavior:

```bash
node --import tsx --test src/world-import-emit.test.ts
node --import tsx --test src/world-import-eval.test.ts
node --import tsx --test src/world-import.test.ts
node --import tsx --test src/world-import-provenance-tools.test.ts
```

Expected:

- Emit tests confirm narrative-surface promotion appears in `world/index.md` only when declared artifacts exist and model-authored inline artifact markers resolve to portable cross-group Markdown links without rewriting code or existing links.
- Eval tests confirm reviewer prompt dimensions include plot synopsis / timeline / source-structure / object coverage / omission visibility, post-merge review packets can request Romeo-like object repairs, parser status is explicit, prose-only score mentions are non-authoritative, and deterministic narrative risk signals remain non-failing warnings.
- Inline-link review covers at least one entity page as well as synopsis/timeline pages; `Related` links do not substitute for traversable references in authored prose.
- Orchestration tests confirm staged post-merge checkpoints, skipped-review reasons, repair-stage invocation fields, bounded repair attempts, and portable/redacted `stages/import-run.json` invocation records remain wired.
- Emit tests confirm `world/log.md` projects the completed audit without duplicating prompt or credential data.
- Provenance-tool tests confirm provenance-audit warnings still surface heading-only and sparse-citation risks.

## 10. Markdown review command smoke test

The automated review-command test uses a temporary fixture and loopback-only test binding; it does not prove tailnet authorization:

```bash
node --import tsx --test src/markdown-review-cli.test.ts
npm run markdown-review -- --help
```

For the required remote smoke, first ensure an emitted Markdown tree exists under `world-output/`. From an authorized Tailscale browser, have the agent find or create the current workspace's dedicated `mdts` Herdr tab and its `review` pane. Inspect it with `herdr pane read <review-pane-id> --source recent-unwrapped --lines 120`: an active viewer has a current `Markdown review URL` and no returned shell prompt. If it is absent or inactive, launch or relaunch `npm run markdown-review` in that pane with `herdr pane run <review-pane-id> "npm run markdown-review"`, then open the newly emitted URL. Verify the tree is visible, then close that exact pane and confirm the URL is unreachable. This validates tailnet access and shutdown only; do not test or configure public reachability.

To review an explicitly requested alternate root, use a separate `mdts` tab and a repository-contained directory such as:

```bash
npm run markdown-review storyboards
```

Expected: the command never falls back to a wildcard/public listener; it reports an actual-port Tailscale DNS URL only after mdts starts; closing the review pane terminates the viewer and discards its temporary configuration home.

## Notes

- `.env` is local-only and ignored by git. It may contain values such as `MEMCHAT_LEMONADE_BASE_URL` and `MEMCHAT_LEMONADE_API_KEY`.
- Do not commit local provider endpoints, API keys, or generated output directories.
