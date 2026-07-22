# Parent preflight, begin, and phase launch

This reference is for the parent agent only. A phase coordinator does not run facility acceptance, call a begin tool, or launch another coordinator.

## 1. Select and briefly validate a facility

1. Inspect the available subagent tools and [facility recipes](facility-recipes.md).
2. Choose one facility able to launch fresh phase coordinators and their assignment-bound workers.
3. Reuse a local recipe when its facility/runtime, mem-import revision, model, and needed capabilities still match; otherwise run [brief acceptance](acceptance.md).
4. Cache only the sanitized invocation. Do not run role-by-role conformance, a miniature import, or Alice.

If no available facility passes the brief probe, stop and explain the missing capability. Do not install, implement, or switch to a custom adapter during the import request.

## 2. Begin once

After preflight, the parent calls exactly one run-creation tool:

- standalone book: `mem_import_begin`;
- maintained book or series: `mem_import_begin_compendium`.

Do not let a coordinator call begin and do not call begin again between phases or after interruption. Keep `outputRoot`, `runId`, and `coordinatorGrant` only in the parent's live context. The grant is transient authority for phase launches; never write it into a facility recipe, prompt template, transcript summary, audit field, or import artifact.

## 3. Launch four fresh phase coordinators

Use the selected facility sequentially for exactly these fresh contexts:

1. `extraction`
2. `proposal-reconciliation`
3. `merge`
4. `review-finalization`

Each launch contains a small structured envelope naming `phase`, `outputRoot`, `runId`, requested work scope, and the source input only for extraction when normalization remains necessary. Supply coordinator authority only in the live task bootstrap. Do not pass earlier coordinator prose, transcripts, copied status results, worker summaries, or hand-written hashes.

Every phase launch also includes:

- an explicit instruction to start at section 2 of `SKILL.md` and execute only the named phase;
- the mem-import skill, coordinator mem-import tools, selected subagent facility, and lifecycle controls;
- explicit model, thinking, repository cwd, and a fresh context;
- the same selected facility for phase coordinator → worker launches.

Wait for authoritative terminal lifecycle before launching the next phase. A phase's coordinator must assess typed durable inputs at startup and typed durable outputs at exit; the next fresh coordinator independently reassesses the ledger. On interruption, resume the current phase only when the adapter preserves its exact profile, or launch a fresh context for that same phase. Never resume a completed prior phase, skip an incomplete phase, or replay its prose into a later one.

The parent retains run authority between phases and does not perform semantic work. Acceptance is finished parent work; live worker assignments, durable effects, and typed status govern the import.
