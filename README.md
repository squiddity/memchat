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
```

## Docs

- [`docs/cli.md`](docs/cli.md) — running memchat, CLI flags, commands, models, memory modes, local package loading
- [`docs/playtesting.md`](docs/playtesting.md) — interactive-shell playtesting workflow and agent defaults
- [`docs/architecture.md`](docs/architecture.md) — goals, design direction, memory quality bar, roadmap
- [`docs/memory-backends.md`](docs/memory-backends.md) — backend strategy and comparison
- [`docs/smoke-tests.md`](docs/smoke-tests.md) — validation commands and expected results

## Status

Memchat is still an experiment: the current emphasis is a small, inspectable CLI plus swappable memory behavior, not a polished end-user product.
