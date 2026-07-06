# CLI usage

## Start memchat

```bash
npm install
npm run dev
```

The CLI uses the pi SDK with memchat's vendored extensions and, unless a mode requires it, disables built-in coding tools.

## Common startup flags

```bash
npm run dev -- --model anthropic/claude-sonnet-4-5 --thinking off
MEMCHAT_MODEL=openai/gpt-4o npm run dev
npm run dev -- --list-models
```

Supported env/flag families:

- model: `--model`, `MEMCHAT_MODEL`
- provider hint: `--provider`, `MEMCHAT_PROVIDER`
- thinking: `--thinking`, `MEMCHAT_THINKING`
- memory mode: `--memory`, `MEMCHAT_MEMORY`
- memory root: `--memory-dir`, `MEMCHAT_MEMORY_DIR`
- summarizer model: `--summarizer-model`, `MEMCHAT_SUMMARIZER_MODEL`
- memory debug: `--memory-debug`, `MEMCHAT_MEMORY_DEBUG=1`

## Useful interactive commands

- `/help`
- `/new`
- `/model`
- `/model list [text]`
- `/model <provider/model>`
- `/model <model>:<thinking>`
- `/model next`
- `/model prev`
- `/memory`
- `/memory status`
- `/memory backends`
- `/memory recall <query>`
- `/memory ignore last`
- `/memory ignore recent <n>`
- `/memory index`
- `/plugins`
- `/exit`

## Memory modes

Examples:

```bash
npm run dev -- --memory none
npm run dev -- --memory transcript
npm run dev -- --memory qmd-hardwired
npm run dev -- --memory qmd-hybrid --memory-dir /tmp/memchat-run-001
npm run dev -- --memory qmd-hybrid --summarizer-model openai/gpt-4o-mini
```

Implemented modes:

- `none` — no durable memory
- `transcript` / `transcript-hardwired` — JSONL transcript persistence with hardwired lexical retrieval
- `qmd` / `qmd-hardwired` — JSONL transcript plus synthesized markdown memory with hardwired lexical retrieval
- `qmd-skill-retrieval` — qmd-compatible persistence with model-centric retrieval via the qmd skill
- `qmd-hybrid` — hardwired recall plus optional qmd skill retrieval

By default, memory lives under `.memchat/`. Use separate `--memory-dir` values to preserve one run while starting another cleanly.

For qmd-compatible modes, the active session model is also used as the default summarizer model unless `--summarizer-model` is supplied.

## Memory debug

For observable recall and synthesis behavior:

```bash
npm run dev -- --memory qmd-hybrid --memory-debug
```

This prints memory-oriented debug lines for actions such as recall, indexing, and transcript/markdown writes.

## Lemonade provider

Memchat vendors `extensions/lemonade-provider.ts` so local Lemonade models can appear under the `lemonade/` provider.

```bash
npm run dev -- --list-models lemonade
npm run dev -- --model lemonade/Qwen3-0.6B-GGUF
```

Configure in a local `.env` file or exported env vars:

```bash
MEMCHAT_LEMONADE_BASE_URL=...
MEMCHAT_LEMONADE_API_KEY=...
```

If either value is missing, the Lemonade provider is skipped.

## Local pi packages

Memchat can resolve npm-installed local pi packages from `package.json`:

```json
{
  "memchat": {
    "piPackages": ["pi-agent-memory"]
  }
}
```

Or for an ad hoc run:

```bash
MEMCHAT_PI_PACKAGES=pi-agent-memory npm run dev
```

Inside the CLI, use `/plugins` to see the resolved local package paths.

## More detail

- backend strategy and storage layout: [`docs/memory-backends.md`](./memory-backends.md)
- interactive shell testing flow: [`docs/playtesting.md`](./playtesting.md)
- world import: [`docs/world-import.md`](./world-import.md)
- validation commands: [`docs/smoke-tests.md`](./smoke-tests.md)
