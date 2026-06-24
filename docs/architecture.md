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
- preserve compatibility with pi extensions/plugins when practical
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

## Near-term roadmap

1. improve durable fact/state extraction
2. add stronger consistency eval fixtures
3. compare hardwired, skill-based, and hybrid retrieval fairly
4. integrate richer qmd-backed retrieval/indexing where useful
5. harden tool access for qmd skill usage
