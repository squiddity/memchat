---
name: mem-import
description: Coordinate a model-led, artifact-driven world import with installed subagent facilities. Use to assess worker adapters, normalize sources, assign bounded extraction workers, inspect durable extraction artifacts, and choose the next semantic action without a hard-coded stage runner.
---

# Mem Import

`mem-import` is the new model-led coordinator path. It works alongside the legacy `world-import` runner; do not redirect, modify, or depend on the legacy runner as part of this skill.

## Current scope: U2 canonical merge, review, and finalization surface

The parent coordinator is the model following this skill, not a tool. It chooses models, workers, fanout, waits, retries, escalation, and whether to work inline.

Typed tools are deterministic capabilities. An **extractor** is a worker role: a narrow prompt/profile plus the smallest tool allowlist/configuration the selected host can provide. It is not itself a tool.

This slice supports:

- run-scoped deterministic normalization and manifest inspection;
- bounded monotonic source reads and literal-provenance extraction validation/submission for assigned units only;
- durable, exclusive extractor assignments with revocation/supersession and sanitized authorization evidence;
- compact cursor-paginated extraction inventories plus bounded candidate reads for merger/reviewer/repairer roles;
- grant-bound proposal-author, merger, reviewer, and repairer assignments with role-specific tool boundaries;
- immutable, bounded shard proposals scoped to declared extraction packet hashes;
- one fenced global merge writer, revision/hash CAS, immutable content-addressed merge history, and source/extraction input hashes. The complete-snapshot merge writer is retained only as small-corpus comparison evidence while bounded proposal/transaction work is introduced;
- immutable reviewer packets bound to a precise merge revision; and
- coordinator-only deterministic checks and finalization into `stages/import-run.json` schema v2.

It does **not** choose semantic identity, canon, merge meaning, review correctness, model tiering, worker topology, or a CLI host policy.

## Core posture

- Inspect the active tool catalog and available local documentation before selecting a worker/delegation facility. Do not assume its name is `subagent`.
- Known adapter profiles are evidence and invocation guidance, not an automatic trust verdict.
- Durable source, extraction, merge, review, and diagnostic artifacts are authoritative. Worker prose and chain values are receipts, never world truth.
- A strong coordinator judges adapters and worker quality from observable lifecycle behavior and—during import—persisted artifacts plus deterministic diagnostics. It may retry, escalate, change topology/facility, or stop.
- **Delegated-run gate:** extraction and merge are actual subagent roles, not inline coordinator work. Before dispatch, the coordinator must locate a facility that can launch workers and enforce each role's exact typed-tool allowlist. If it cannot, call `mem_import_fail` with a concise safe reason and stop; do not substitute inline extraction or merge.
- Do not claim that allowlists, isolation, recursive-spawn prevention, or cancellation are formally proven merely from a schema or worker report.
- Do not use `bash`, generic filesystem writes, or legacy helper CLI commands for this new path. Use the typed `mem_*` tools.

## Run and authorization boundary

Read [typed tool contracts](references/helper-tools.md) before starting extraction.

1. Call `mem_import_begin` with a fresh output root. Keep its `runId` and `coordinatorGrant` in the coordinator context; never copy the grant into world artifacts, task receipts, review packets, or audit prose.
2. Call `mem_import_normalize`, then `mem_import_inspect_manifest`. Inspect all units before deciding assignments.
3. Call `mem_import_assign_extractor` with a unique task ID and only the normalized unit IDs chosen for that worker. Its returned bootstrap is limited to that assigned worker/task.
4. Deliver the bootstrap only through the selected host's worker-task mechanism. The current Pi tool API does not provide a transcript-secret channel, so treat grant delivery as an application authorization boundary rather than a credential vault; do not repeat or persist raw grants unnecessarily.
5. Revoke an assignment with `mem_import_revoke_assignment` after interruption, replacement, or any decision not to let it continue.

Every privileged extractor tool independently reloads durable run/assignment state and checks run identity, canonical output root, task/role/capability, grant hash, expiry/revocation, and unit scope. Invalid or incomplete operations should fail locally; they do not make a semantic decision.

## Capability discovery and worker dispatch

Read [the coordinator workflow](references/workflow.md), [the capability guide](references/subagent-capabilities.md), and [the extractor role](references/extractor-role.md). Then:

1. Identify candidate worker/delegation tools in the active tool catalog and inspect their actual schema/docs. Load a matching known adapter reference only after detection.
2. Select a facility only if its controls make the proposed bounded extraction task reasonable. Request the extractor's exact typed tool set where supported; if the facility cannot enforce that request, record the limitation rather than pretending it is enforced.
3. Give the worker its extractor prompt/profile, assignment bootstrap, and assigned units. It must read source only through `mem_source_read_unit` and persist candidates only through `mem_extraction_submit`.
4. Start with a small wave of disjoint workers (normally one to three), wait using the adapter's native mechanism, then inspect `mem_extraction_status`, submitted packets, and source evidence yourself.
5. Increase fanout only gradually after early waves show clean durable packets, manageable parent lifecycle traffic, and no provider/adapter failures. Reduce or stop fanout immediately on schema failures, source-coverage gaps, provider errors, or parent backlog. The parent chooses re-extraction, escalation, more workers, or the next phase.

A delegated run permits one worker or parallel workers on disjoint units, but extraction and merge must be delegated through the selected facility. It does not prescribe a fixed worker count or stage sequence.

## Durable handoff rule

- Source truth: normalized units and manifest.
- Extraction truth: `stages/extraction/<unit>.json` packets submitted through typed tools.
- Extraction discovery truth: cursor-paginated packet inventories and bounded packet pages; do not request the whole corpus.
- Merge truth: the latest canonical merge snapshot plus its immutable content-addressed receipt under `stages/merge/revisions/`. Do not use its legacy complete-snapshot surface for a substantive corpus.
- Review truth: immutable task-keyed packets under `stages/reviews/`, hash-bound to the reviewed merge revision.
- Completion truth: deterministic check artifacts and `stages/import-run.json` schema v2.

Do not report success solely because a worker says it finished. Verify persisted artifacts, current revision/hash, and deterministic status.

## References

- [workflow](references/workflow.md) — model-owned adapter and outcome evaluation.
- [typed helper tools](references/helper-tools.md) — U1 run, assignment, source-read, and extraction contracts.
- [extractor role](references/extractor-role.md) — extraction worker prompt/profile boundary.
- [proposal role](references/proposal-role.md), [merger role](references/merger-role.md), [reviewer role](references/reviewer-role.md), and [repairer role](references/repairer-role.md) — privileged worker boundaries.
- [subagent capabilities](references/subagent-capabilities.md) — adapter decision aid.
- [pi-subagents](references/adapters/pi-subagents.md) and [pi-herdr-subagents](references/adapters/pi-herdr-subagents.md) — load only after detecting a matching facility.
- [scout role](references/scout-role.md) — retained for a non-mutating adapter trial.
