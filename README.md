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
- provide `mem-import`, the host-agent-led, acceptance-gated pipeline for provenance-rich compendia, including same-run recovery from durable failed checkpoints and a root-level Markdown projection
- expose requested generated Markdown trees and raw JSON artifact trees through separate temporary, Tailscale-only browser reviewers

## Design principle

Memchat favors small deterministic helpers plus model-owned semantic workflows. Prefer existing skills, documented tools, and bounded subagents over ad hoc scripts; add helper tools when a workflow becomes repetitive. For memory and compendium imports, TypeScript should make state, provenance, links, candidate accounting, source coverage, and validation inspectable; skills, prompts, and evals should own interpretation, style/tone analysis, synopsis quality, identity matching, continuity, conflicts, and narrative judgment.

## Quick start

```bash
npm install
npm run dev
```

Embedded pi sessions use a project-local `.memchat/pi/` runtime and do not inherit account-level pi instructions or resources. Put custom models and optional credentials there, or explicitly provide an external credential file with `MEMCHAT_PI_AUTH_FILE=/path/to/auth.json` (credentials only).

For a book or series compendium, ask the host agent normally or invoke `/skill:mem-import`. The parent chooses an available subagent facility, reuses a matching local recipe or runs one brief disposable capability probe, then launches the corpus coordinator. It never performs a miniature import as acceptance. Semantic work is host-agent-led; there is no separate mem-import CLI.

Useful variants:

```bash
npm run dev -- --list-models
npm run dev -- --memory qmd-hybrid --memory-debug
npm run dev -- --memory qmd-hybrid --memory-dir /tmp/memchat-demo
```

For project commands that may run for a while or emit useful streaming output, use the active agent harness's supervised execution mechanism when available. Keep inline execution for quick one-shot inspection commands, and prefer visible, interruptible runs for imports, builds/tests, playtests, lint/eval, provenance audits, helper loops, repair loops, and repeated source-search workflows.

## Docs

- [`docs/cli.md`](docs/cli.md) — running memchat, CLI flags, commands, models, memory modes, local package loading
- [`docs/playtesting.md`](docs/playtesting.md) — interactive-shell playtesting workflow and agent defaults
- [`docs/architecture.md`](docs/architecture.md) — goals, design direction, memory quality bar, roadmap
- [`docs/memory-backends.md`](docs/memory-backends.md) — backend strategy and comparison
- [`skills/mem-import/SKILL.md`](skills/mem-import/SKILL.md) — extension-agnostic parent preflight plus assignment-bound corpus coordination
- [`docs/smoke-tests.md`](docs/smoke-tests.md) — validation commands and expected results

## Status

Memchat is still an experiment: the current emphasis is a small, inspectable CLI plus swappable memory behavior, not a polished end-user product.

The full-corpus mem-import milestone was reached on 2026-08-03: a 13-unit *Alice's Adventures in Wonderland* run recovered in place from a partial failed merge, reused its completed extraction/proposal/reconciliation work, and finalized with 28/28 proposals consumed, 183/183 candidates accounted, and no conflicts. This is retained as historical project evidence; the shipped workflow and validation contract are documented in `skills/mem-import/SKILL.md` and `docs/smoke-tests.md`.
