# Architecture and goals

## Primary goal

`memchat` explores how to keep long-running chats internally consistent across sessions. The motivating use case is ongoing fiction/chat roleplay: the model may invent details when needed, but once a detail exists, later sessions should retrieve and respect it instead of contradicting it.

The near-term goal is a small, hackable agent. The longer-term goal is a repeatable testbench for comparing models, prompts, and memory systems.

## Why build on pi?

Pi already provides the SDK, model/provider plumbing, sessions, streaming events, tools, extensions, skills, and package discovery. Memchat reuses those pieces while specializing the interaction model for discussion and fiction rather than coding.

Design direction:

- use pi SDK primitives where practical
- keep the initial chat loop simple and observable
- treat memory as an interchangeable subsystem
- integrate with pi extensions/plugins through the host agent when practical
- leave room for custom state models tuned to narrative facts, preferences, chronology, and contradictions

## Memory quality bar

For this project, good memory means:

1. later answers should not contradict established facts unless the story intentionally retcons them
2. relevant context should be recalled without replaying every old turn
3. remembered state should survive process restarts and resumed sessions
4. claims should be inspectable and traceable when possible
5. uncertainty and conflicts should be surfaced rather than silently flattened

Example: if the agent invents that a hallway closet contains a brass telescope, old coats, and a locked cedar box, those details should remain available when the closet appears again later.

## High-level architecture

Early and current components center on:

- a CLI chat runner using `createAgentSession()` from `@earendil-works/pi-coding-agent`
- a pluggable memory interface
- append-only transcript logging for durability and auditability
- optional synthesized markdown memory for higher-level recall
- session and memory inspection commands for evaluation

Likely future additions include:

- model-assisted fact extraction
- stronger entity/state representations
- richer search and ranking backends
- contradiction tracking and reconciliation
- repeatable eval fixtures for long-context consistency

## Current state

Implemented today:

- TypeScript project scaffold
- pi SDK-based streaming chat CLI
- startup and in-session model selection
- vendored Lemonade provider discovery
- pluggable `none`, `transcript`, and `qmd`-family memory modes
- session-aware recall and interactive memory inspection commands
- an assignment-bound, provenance-rich `mem-import` pipeline with typed durable phase ledgers, identity-aware planning, canonical transactions, review/repair, terminal finalization, and a root-level compendium Markdown projection
- same-run recovery of failed imports by rotating coordinator authority and worker authorization epoch while preserving verified completed stages
- host-agent-only compendium orchestration through `/skill:mem-import`; no separate import CLI or nested projection path

The full-corpus execution milestone was validated on 2026-08-03 with a 13-unit Alice import: 28/28 proposals and 183/183 candidates reached canonical accounting, a partial failed merge resumed without repeating earlier semantic work, and review/repair finalized revision 10 with no conflicts or errors. The legacy-surface cleanup is complete: the root-level projection, path safety, link lint, source retention, and migration refusal contracts are active, and the retired importer/runtime surfaces are deleted. This milestone and cleanup handoff are historical project records; the included current contract is in `skills/mem-import/SKILL.md`, with validation commands in `docs/smoke-tests.md`.

## Near-term quality follow-ups

1. improve durable fact/state extraction
2. add stronger consistency eval fixtures
3. compare hardwired, skill-based, and hybrid retrieval fairly
4. integrate richer qmd-backed retrieval/indexing where useful
5. harden tool access for qmd skill usage
6. improve mem-import narrative-surface classification, style citation density, provenance specificity, and complete usage retention now that full-corpus execution/recovery and cleanup are complete

## Cleanup verification

The cleanup baseline passed `rm -rf dist && npm run build`, focused path/stage/projection/lint tests, `npm run test:cleanup`, `npm run test:mem-import`, `npm test`, `npm pack --dry-run`, and `git diff --check`. These checks are recorded here as completed evidence; remaining work is quality refinement only.
