# memchat

`memchat` is a TypeScript chat-agent experiment built on [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) for testing long-term memory in ongoing conversations.

## Goal

Make multi-session chat feel consistent over time: if the agent invents or learns a detail, later sessions should be able to recall it, use it, and avoid contradicting it.

## What it is for

- fiction and roleplay conversations that accumulate world state
- experiments comparing memory backends and retrieval strategies
- observable, restart-safe chat sessions with inspectable memory artifacts

## What it can do today

- run a local CLI chat loop on top of the pi SDK
- switch models at startup or in-session
- persist memory in selectable modes, including transcript and qmd-based flows
- support session restarts, recall commands, ignore/tombstone commands, and memory inspection
- support agent-driven interactive-shell playtesting
- provide a skill-first world-import pipeline for provenance-rich, OKF-compatible markdown world wiki bundles from HTML-like sources

## Design principle

Memchat favors small deterministic helpers plus model-owned semantic workflows. For memory and world-import features, TypeScript should make state, provenance, links, candidate accounting, source coverage, and validation inspectable; skills, prompts, and evals should own interpretation, style/tone analysis, synopsis quality, identity matching, continuity, conflicts, and narrative judgment.

## Quick start

```bash
npm install
npm run dev
```

Useful variants:

```bash
npm run dev -- --list-models
npm run dev -- --memory qmd-hybrid --memory-debug
npm run dev -- --memory qmd-hybrid --memory-dir /tmp/memchat-demo
npm run world-import-run -- --input ./sources --output /tmp/memchat-world --dry-run
npm run world-import-run -- --input samples/pg120-images-3.epub --output /tmp/memchat-world --model openrouter/deepseek/deepseek-v4-pro
```

For imports, tests, evals, and other longer-running shell jobs, prefer a dedicated herdr pane **below** the current one so you can keep monitoring output without crowding the main conversation pane. Avoid side panes for routine job supervision.

## Docs

- [`docs/cli.md`](docs/cli.md) — running memchat, CLI flags, commands, models, memory modes, local package loading
- [`docs/playtesting.md`](docs/playtesting.md) — interactive-shell playtesting workflow and agent defaults
- [`docs/architecture.md`](docs/architecture.md) — goals, design direction, memory quality bar, roadmap
- [`docs/memory-backends.md`](docs/memory-backends.md) — backend strategy and comparison
- [`docs/world-import.md`](docs/world-import.md) — skill-first world import package, helper commands, emitted wiki bundle shape, and artifact format
- [`docs/world-import-run-guide.md`](docs/world-import-run-guide.md) — shell-oriented quick-start for running imports and helpers, including the TTY-safe wrapper
- [`docs/smoke-tests.md`](docs/smoke-tests.md) — validation commands and expected results

## Status

Memchat is still an experiment: the current emphasis is a small, inspectable CLI plus swappable memory behavior, not a polished end-user product.
