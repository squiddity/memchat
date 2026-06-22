# memchat

A TypeScript chat-agent experiment built on [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) for evaluating memory-intensive, multi-session conversations.

## Goal

`memchat` explores how to keep long-running chats internally consistent across sessions. The motivating use case is ongoing fiction/chat roleplay: the model may invent details when needed, but once a detail exists, later sessions should retrieve and respect it instead of contradicting it.

We want a small, hackable agent first, then a repeatable testbench for comparing models, prompts, and memory systems.

## Why build on pi?

Pi already provides a TypeScript SDK, model/provider plumbing, sessions, streaming events, tools, extensions, skills, and package discovery. We can use those pieces while specializing the interaction model for discussion and fiction rather than coding.

Important design direction:

- Use pi SDK primitives for model/session management where possible.
- Keep the initial chat loop simple and observable.
- Treat memory as an interchangeable subsystem.
- Preserve compatibility with pi extensions/plugins where practical, including memory plugins such as `pi-mem`.
- Leave room for custom event/state models tuned to narrative facts, character state, user preferences, chronology, and contradictions.

## Memory problem statement

For this project, good memory means:

1. **Internal consistency first**: later answers should not contradict established facts unless the story/chat intentionally retcons them.
2. **Efficient recall**: use relevant prior context without blindly replaying every old message.
3. **Cross-session continuity**: remembered state must survive process restarts and resumed conversations.
4. **Traceability**: the agent should be able to explain why it believes a fact when possible.
5. **Graceful uncertainty**: when memory is incomplete or conflicting, the agent should acknowledge uncertainty or ask.

Example: if the agent invents that a hallway closet contains a brass telescope, old coats, and a locked cedar box, those details become state that should be recalled when the closet appears again.

## Planned architecture

Early versions will likely contain:

- A CLI chat runner using `createAgentSession()` from `@earendil-works/pi-coding-agent`.
- A memory interface with pluggable implementations.
- A baseline memory implementation using append-only transcripts plus extracted facts.
- Session/event logging for later evaluation.
- A small fiction consistency benchmark.

Future memory implementations may include:

- pi plugin-backed memory adapters.
- Summary hierarchies.
- Entity/event graphs.
- Vector search over utterances and extracted facts.
- Temporal state snapshots.
- Contradiction detection and reconciliation.

## Evaluation ideas

Initial tests should measure whether the agent can:

- Recall invented facts after many intervening turns.
- Maintain character attributes, relationships, locations, inventory, and unresolved plot hooks.
- Distinguish stable facts from speculation.
- Notice conflicting memories.
- Continue accurately after restarting from a previous session.

## Hello-world CLI

Run the current minimal chat loop with:

```bash
npm run dev
```

It uses `@earendil-works/pi-coding-agent`'s SDK with a `DefaultResourceLoader`, disables built-in coding tools, and loads memchat's vendored extensions.

### Model selection

Select a startup model with CLI flags or environment variables:

```bash
npm run dev -- --model anthropic/claude-sonnet-4-5 --thinking off
MEMCHAT_MODEL=openai/gpt-4o npm run dev
```

Useful commands inside the CLI:

- `/new` starts a fresh chat/memory session without restarting the process.
- `/model` shows the active model.
- `/model list [text]` lists configured models; `*` means pi auth is available.
- `/model <provider/model>` switches models.
- `/model <model>:<thinking>` switches model and thinking level.
- `/model next` and `/model prev` cycle available models.

`--list-models [text]` prints configured models and exits.

### Local Lemonade models

Memchat vendors `extensions/lemonade-provider.ts` and loads it at startup so local Lemonade models appear under the `lemonade/` provider:

```bash
npm run dev -- --list-models lemonade
npm run dev -- --model lemonade/Qwen3-0.6B-GGUF
```

Configure Lemonade in a local `.env` file (ignored by git) or exported environment variables:

```bash
MEMCHAT_LEMONADE_BASE_URL=...
MEMCHAT_LEMONADE_API_KEY=...
```

If either value is missing, the vendored Lemonade provider is skipped.

### Memory backends

Select a memory backend with `--memory` or `MEMCHAT_MEMORY`. Select a storage root with `--memory-dir` or `MEMCHAT_MEMORY_DIR`. For qmd modes, markdown memory is synthesized by a background summarizer model; by default it mirrors the active session model, or set a cheaper/different model with `--summarizer-model` / `MEMCHAT_SUMMARIZER_MODEL`:

```bash
npm run dev -- --memory none
npm run dev -- --memory transcript
MEMCHAT_MEMORY=qmd npm run dev
npm run dev -- --memory qmd-hybrid --memory-dir .memchat-experiments/run-001
npm run dev -- --memory qmd-hybrid --summarizer-model openai/gpt-4o-mini
MEMCHAT_MEMORY_DIR=.memchat-clean npm run dev -- --memory qmd-hardwired
```

Implemented memory modes:

- `none`: no durable memory; active pi session context only.
- `transcript` / `transcript-hardwired`: hardwired JSONL transcript persistence and hardwired lexical retrieval.
- `qmd` / `qmd-hardwired`: hardwired JSONL transcript plus synthesized markdown notes under `.memchat/memory/`, with hardwired lexical retrieval.
- `qmd-skill-retrieval`: hardwired JSONL/synthesized markdown persistence, but retrieval is model-centric via the project-local `qmd` skill.
- `qmd-hybrid`: hardwired JSONL/synthesized markdown persistence and hardwired lexical recall, plus optional model-centric retrieval via the `qmd` skill.

`qmd-skill-retrieval` and `qmd-hybrid` require the local npm dependency `@tobilu/qmd`. Memchat loads the package-provided `node_modules/@tobilu/qmd/skills/qmd/SKILL.md` without copying or overriding it, and verifies that the local `qmd` executable is present. That skill declares `allowed-tools: Bash(qmd:*)`, and memchat currently enables pi's built-in tools for those modes so the skill can call the `qmd` CLI directly. A future hardening pass should restrict Bash to qmd-only execution rather than enabling the full built-in tool set.

Interactive memory commands:

- `/new` closes the current in-process chat/memory session and starts a fresh one using the same startup configuration.
- `/memory` or `/memory status` shows backend status.
- `/memory backends` lists available memory modes.
- `/memory recall <query>` searches the selected backend.
- `/memory index` initializes or refreshes backend-local indexes/files.

For observable memory debugging, start with `--memory-debug` or `MEMCHAT_MEMORY_DEBUG=1`:

```bash
npm run dev -- --memory qmd-hybrid --memory-debug
```

This prints italicized memory notes for hardwired memory operations such as before-prompt recall, lexical search, injected remembered context, indexing, and transcript/markdown writes. In qmd skill modes, memchat also adds setup guidance asking the model to pair model-centric qmd tool use with concise italicized memory notes, without modifying the third-party qmd skill itself.

By default, memory lives under `.memchat/`. Use separate memory directories to preserve long-running progress, start clean experiments, or compare backends against different corpora.

For qmd-compatible modes, JSONL transcripts remain append-only source/audit logs. Markdown memory is the synthesized retrieval layer: per-turn markdown synthesis appends compact summary bullets, facts, state updates, and conflict/retcon notes, and the end-of-session hook compacts/restates the current markdown memory. JSONL transcript append is the immediate durability boundary; markdown synthesis may run as background work and is flushed or reported by explicit memory inspection and lifecycle commands. If no summarizer model is available, memchat falls back to a minimal unsynthesized summary bullet rather than blocking transcript persistence.

The initial hardwired `qmd` modes intentionally keep markdown and JSONL as authoritative storage and use a TypeScript lexical search fallback. Hardwired retrieval is now session-aware and two-stage: compare current-session details with synthesized markdown memory first, then search JSONL transcript only when markdown hits are absent, weak, conflict/uncertainty-related, or need source verification. Possible current-session conflicts or retcons are rendered in context for now; a later conflict-resolution strategy may turn these comparisons into durable conflict events. Skill-based modes evaluate model-centric retrieval using the exact qmd skill shipped by `@tobilu/qmd`; memchat adds wrapper system guidance telling the model to use the same synthesized-first, transcript-as-audit strategy without modifying the third-party skill. A later change can add a hardwired `@tobilu/qmd` index/search backend without changing the storage layout.

### npm-managed local pi packages

For Option B-style plugin loading, install a pi package with npm and list it in `package.json`:

```bash
npm install pi-agent-memory
```

```json
{
  "memchat": {
    "piPackages": ["pi-agent-memory"]
  }
}
```

At startup, memchat resolves those names from local `node_modules` and passes their package roots to pi as local package sources. Global pi extension discovery is disabled to keep memchat startup deterministic; memchat explicitly loads its vendored extensions. You can also test without editing `package.json`:

```bash
MEMCHAT_PI_PACKAGES=pi-agent-memory npm run dev
```

Inside the CLI, use `/plugins` to show the resolved local package paths.

## Running memchat inside a pi interactive shell

For manual TUI experiments, use the pi package [`pi-interactive-shell`](https://github.com/nicobailon/pi-interactive-shell). Install it into the **pi agent environment**, not this `memchat` package:

```bash
pi install npm:pi-interactive-shell
```

After installation, pi coding agents get an `interactive_shell` tool. This lets an agent start `memchat` in an observable terminal overlay so the human user can drive the chat while the agent watches I/O, or the agent can drive the CLI and periodically inspect behavior.

Recommended agent-side tool calls from this repository root:

```typescript
// Human-driven manual test: opens an overlay and blocks the agent until closed.
interactive_shell({
  command: "npm run dev -- --memory qmd-hybrid",
  mode: "interactive",
  reason: "Manual memchat memory test"
})

// Shared supervision: user can type in the overlay; agent can poll output later.
interactive_shell({
  command: "npm run dev -- --memory qmd-hybrid",
  mode: "hands-free",
  reason: "Observe memchat TUI memory behavior",
  handsFree: { autoExitOnQuiet: false }
})

// Later, using the returned sessionId:
interactive_shell({ sessionId: "<session-id>", outputLines: 80 })
interactive_shell({ sessionId: "<session-id>", input: "/memory status", submit: true })
interactive_shell({ sessionId: "<session-id>", input: "/memory recall brass telescope", submit: true })
interactive_shell({ sessionId: "<session-id>", kill: true })
```

Use `interactive` when the user wants full manual control and the agent should wait. Use `hands-free` when the agent should keep working, check output occasionally, or send slash commands/test prompts into the running memchat session. Avoid `dispatch` for long manual chats unless you explicitly want fire-and-forget behavior.

Useful manual test pattern:

1. Start with a clean or named memory directory, for example `npm run dev -- --memory qmd-hybrid --memory-dir .memchat-experiments/closet-test`.
2. Establish several fictional facts in the TUI.
3. Ask about them after intervening turns.
4. Restart memchat against the same memory directory inside another `interactive_shell` session.
5. Use `/memory status`, `/memory recall <query>`, and direct questions to check whether memory survived and stayed consistent.

## Development status

Implemented:

1. TypeScript project scaffold.
2. `@earendil-works/pi-coding-agent` dependency.
3. Minimal streaming chat CLI.
4. npm-managed local pi package discovery.
5. CLI/env startup model selection and interactive `/model` management.
6. Vendored Lemonade provider extension for local `lemonade/` model discovery.
7. Pluggable `none`, `transcript`, and `qmd` memory backends with hardwired and qmd skill retrieval modes.

Next expected steps:

1. Add model-assisted fact extraction into `.memchat/memory/facts.md`.
2. Add basic consistency eval fixtures.
3. Add eval fixtures comparing hardwired, skill-based, and hybrid retrieval.
4. Integrate the real qmd package/indexer for richer hardwired markdown retrieval.
5. Harden skill tool access so qmd skills can use qmd without enabling general Bash/tools.

## Project conventions

- Prefer TypeScript for application code.
- Keep memory APIs small and model-agnostic.
- Add tests/evals alongside new memory behavior.
- Document assumptions about narrative state and contradiction handling.

## Maintainer notes

If `git push` over HTTPS fails in an agent shell with `could not read Username`, use the GitHub CLI credentials already configured for the environment:

```bash
gh auth status
gh auth setup-git
git push origin main
```
