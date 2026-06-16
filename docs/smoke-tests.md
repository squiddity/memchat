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
printf '/memory\n/memory backends\n/memory index\n/exit\n' | npm run dev -- --memory qmd-hardwired
```

Expected:

- Banner shows `Memory: qmd-hardwired`.
- `/memory` reports qmd status and `.memchat` paths.
- `/memory backends` lists hardwired and skill memory modes.
- `/memory index` completes without an external server.

## 4. QMD skill retrieval mode smoke test

```bash
printf '/memory\n/exit\n' | npm run dev -- --memory qmd-skill-retrieval
```

Expected:

- Banner shows `Memory: qmd-skill-retrieval`.
- Banner notes that built-in pi tools are enabled so declared qmd skill Bash usage can run.
- `/memory` reports qmd status and `.memchat` paths.

Note: this smoke test requires `npm install` to have completed successfully so local `@tobilu/qmd`, its package-provided skill, and the local `qmd` executable are present. End-to-end qmd skill evaluation additionally requires using a configured model.

## 5. Model listing / selection smoke test

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

## 6. Actual model interaction

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
