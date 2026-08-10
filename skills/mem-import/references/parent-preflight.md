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

If typed status reports `failed`, do not begin another run or repeat completed stages. The parent may call `mem_import_recover` with current coordinator authority, retain the returned rotated grant, and launch a fresh coordinator for the first ledger-derived incomplete phase. Recovery keeps the same run ID, invalidates all prior worker grants through a new authorization epoch, and preserves verified normalization, extraction, plan, proposal, identity, and canonical transaction artifacts. A `finalized` run cannot be recovered.

Build each coordinator launch envelope only after the begin result is available, and include the authority in the coordinator's first task from the start—never launch a coordinator first and send `coordinatorGrant` in a later message. The live envelope contains exactly the dynamic handoff fields:

```text
phase: extraction | proposal-reconciliation | merge | review | repair | verification | finalization
outputRoot: <begin result>
runId: <begin result>
coordinatorGrant: <begin result, transient>
requested scope: <current parent request>
input: <only when extraction normalization still needs it>
```

Use the exact named coordinator profile for the phase (`mem-import-coordinator-extraction`, `mem-import-coordinator-proposal`, `mem-import-coordinator-merge`, `mem-import-coordinator-review`, `mem-import-coordinator-repair`, `mem-import-coordinator-verify`, or `mem-import-coordinator-finalize`). The old review-finalization coordinator is not used for new runs. The launch call's `agent` field selects that profile; `name` is display-only. Do not omit `agent`, substitute a role shorthand, or retry with a bare child.

## 3. Launch seven fresh phase coordinators

Use the selected facility sequentially for exactly these fresh contexts (with optional bounded repair and verification phases):

1. `extraction`
2. `proposal-reconciliation`
3. `merge`
4. `review`
5. `repair` only after parent policy approves a campaign
6. `verification` for the exact campaign actions
7. `finalization`

Each launch contains a small structured envelope naming `phase`, `outputRoot`, `runId`, requested work scope, and the source input only for extraction when normalization remains necessary. Supply coordinator authority only in the live task bootstrap. Do not pass earlier coordinator prose, transcripts, copied status results, worker summaries, or hand-written hashes.

Every phase launch also includes:

- an explicit instruction to start at section 2 of `SKILL.md` and execute only the named phase;
- the mem-import skill, coordinator mem-import tools, selected subagent facility, and lifecycle controls;
- explicit model, thinking, repository cwd, and a fresh context;
- the same selected facility for phase coordinator → worker launches.

Task-completion instructions belong to the selected facility, not mem-import profiles or launch envelopes.

Wait for authoritative terminal lifecycle before launching the next phase. A phase's coordinator must assess typed durable inputs at startup and typed durable outputs at exit; the next fresh coordinator independently reassesses the ledger. On interruption, resume the current phase only when the adapter preserves its exact profile, or launch a fresh context for that same phase. Never resume a completed prior phase, skip an incomplete phase, or replay its prose into a later one.

After every terminal phase result, call `mem_import_record_session` with the exact host-issued running-child ID, sanitized session filename stem, selected `hostAdapter`, phase, lifecycle outcome, and observed runtime fields. Copy schema-v1 terminal `usage` / `usageByModel` when present, but never estimate or reconstruct metrics. For the Pi/Herdr adapter, recording eagerly resolves deterministic activity-sidecar evidence by the exact complete session stem; later refresh remains authoritative and replaces live hints with the latest validated cumulative snapshot before cleanup. Record the review/finalization coordinator after it exits; this audit-only call is valid after terminal finalization. Also record split review, repair, verification, and finalization coordinators as they exit and rerun retrieval to refresh the schema-v2 final audit. Optional `caller_report` remains non-authoritative telemetry; it is not policy, assignment scope, mutation authority, or persisted content.

The parent retains run authority between phases and does not perform semantic work. It owns the policy checkpoint between review and repair, and may defer non-blocking findings without opening a campaign. Acceptance is finished parent work; live worker assignments, durable effects, and typed status govern the import.
