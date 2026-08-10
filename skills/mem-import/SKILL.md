---
name: mem-import
description: Import a book or series into a provenance-rich compendium with bounded semantic subagents. Use for fresh imports, maintained compendia, resumable extraction, canonical merge, review, and repair.
---

# Mem Import

Treat durable artifacts as a **ledger**: normalized source, extraction packets, proposals, identity packets, canonical transactions, reviews, checks, and the final run record are authoritative. Worker and coordinator prose is only a receipt. This contract has completed a full 13-unit Alice import, including same-run recovery from a partial failed merge through reviewed terminal finalization; that run is historical project evidence, while this skill and `../../docs/smoke-tests.md` are the included operational contract.

## 1. Choose your role

- **Parent agent:** read [parent preflight and phase launch](references/parent-preflight.md). After preflight, call exactly one begin tool, retain its run identity and coordinator authority only in live context, and launch the seven fresh phase coordinators in order: extraction, proposal/reconciliation, merge, review, repair, verification, and finalization.
- **Phase coordinator:** the bootstrap must name exactly one phase: `extraction`, `proposal-reconciliation`, `merge`, `review`, `repair`, `verification`, or `finalization`. The historical `review-finalization` phase is a read-only compatibility alias for v1 runs only. Do not run acceptance, call a begin tool, launch another coordinator, or perform another phase. Continue at section 2.

If neither role and phase are explicit, stop and clarify rather than mixing parent, coordinator, and worker duties.

## 2. Honor the phase handoff

The parent supplies only a small launch envelope (`phase`, `outputRoot`, `runId`, requested scope, and extraction input only when needed) plus coordinator authority transiently. The parent must include `coordinatorGrant` in that first coordinator task before launching; never launch a coordinator with a missing grant and try to add it later. Never persist authority or copy it into an assignment, recipe, audit, packet, or completion prose.

At phase startup, reconstruct inputs by calling the typed status, manifest, controls, inventory, and effect tools named in [coordinator decisions](references/workflow.md). Never use a prior coordinator transcript, summary, or claimed hash as an input. At phase exit, re-read the typed durable outputs for that phase. If interrupted, resume or restart only the current phase; never resume a completed earlier phase or skip a phase whose exit ledger is incomplete.

## 3. Enforce worker assignments

Assignment results contain the complete worker bootstrap and exact semantic `tools` array. Pass both verbatim to the selected facility with the chosen model/thinking setting. Require the exact semantic profile, apart from documented lifecycle controls, and record the strongest lifecycle/tool evidence the facility exposes. Never derive observed evidence from the assignment or worker prose. If the facility cannot enforce `assignment.tools`, call `mem_import_fail` and stop.

For independent work, form a bounded wave and launch only those assigned semantic workers, one launch per tool-result turn. After the final launch in the wave, **end the turn and remain idle** for push-delivered completion. Never do unrelated work between launches, poll merely to detect completion, schedule an ordinary wake-up, or launch a child to wait, sleep, monitor, say “done,” or keep the coordinator alive. Only a genuine external deadline without native completion may justify a timer. Wait/helper children invalidate the run.

Read the selected facility's adapter reference only for invocation details. A recipe never replaces live assignment, dispatch, lifecycle, and durable-effect checks.

## 4. Execute only the assigned phase

Read [coordinator decisions](references/workflow.md), then perform one phase:

1. **Extraction:** assess run/manifest status, normalize if needed, dispatch [extractors](references/extractor-role.md), and exit only after the extraction ledger is complete.
2. **Proposal/reconciliation:** assess the complete flattened candidate inventory, persist one model-authored identity-aware cluster plan, dispatch artifact-scoped [proposers](references/proposal-role.md) and required [reconcilers](references/reconciler-role.md) in bounded independent waves, and exit only when plan status is ready for merge with complete, non-duplicated proposal disposition coverage.
3. **Merge:** independently require ready cluster-plan status, dispatch one plan-scoped [merger](references/merger-role.md), and exit only after proposal consumption and canonical candidate accounting are complete with no blocking conflict.
4. **Review:** assess current canonical controls, dispatch read-only reviewers for one checkpoint, reconcile the immutable packet, and exit.
5. **Repair:** after the parent persists typed policy, dispatch exactly one frozen campaign to repairers and exit.
6. **Verification:** dispatch read-only verification reviewers for the exact approved action IDs and persist one packet.
7. **Finalization:** run deterministic checks and finalize from typed readiness; launch no semantic workers.

After each child terminates, record its exact completed dispatch receipt and inspect its durable effect before scheduling dependent work. Retry with a fresh assignment after revocation, not by editing an immutable packet. When the host provides `caller_report`, it is documented non-authoritative lifecycle telemetry at this communication boundary only: it may report progress or attention against durable IDs, never authorize policy, mutation, scope, identity, or budget changes, is never included in semantic `assignment.tools`, and its report text is never persisted.

## 5. Preserve traversable authored prose

Apply this compact authoring contract to every authored section body across people, places, things, facts, style, synopsis, timeline, and guide artifacts:

- Mark each clear, durable mention of another artifact with the exact `[[artifact-id|reader-facing label]]` form. Labels should use natural aliases and possessives where that is how a reader would recognize the artifact.
- Do not link pronouns, ambiguous common nouns, the current artifact, existing Markdown links, URLs, inline or fenced code, or provenance quotes.
- Keep `related` as structured, deduplicated navigation; it complements and never replaces traversable inline prose. When both artifacts exist, make meaningful relationships and event participation useful to traverse in both directions without forced reciprocal noise.
- Reviewers assess material retrieval/traversal problems semantically. Projection and lint validate declared links, but do not pretend deterministic code can infer every missed plain-text mention.

The proposer, reviewer, and repairer role packets carry the role-specific form of this contract; do not expand the workflow with a second authoring template.

## 6. Choose and migrate the output root

- A standalone import uses a dedicated output root for one run. A maintained compendium uses the existing compendium root so the root-level projection remains the reader-facing surface; stages, normalized JSON, and run records stay in their owned subdirectories.
- The projection owns only the root-level generated Markdown recorded in `.mem-import-generated.json`. It never follows or deletes unknown files, directories, or symlinks.
- Refusal is intentional when the selected root contains a nested retired `world/` directory, including a symlink. Review its contents and manually move, archive, or remove that directory before retrying; the import does not perform that migration automatically.
- Keep one explicit output-root choice for a run. Do not treat an old nested layout as an active compatibility path; use the migration steps above and then rerun against the standalone or compendium root.

## 7. Complete the ledger

Success requires all of the following:

- all seven fresh coordinator phases completed sequentially against the same run (with the historical `review-finalization` phase retained only for v1 compatibility);
- every intended unit has an accepted extraction packet;
- every used semantic effect has a completed assignment-bound receipt matching the worker's exact requested tool profile and the strongest lifecycle/tool evidence the facility exposes;
- no unassigned or unrestricted helper child participated in the run;
- one immutable cluster plan exactly partitions the complete extraction snapshot; every cluster has one effective proposal and every required reconciliation set has one identity packet;
- every extraction candidate has exactly one proposal-stage disposition and a canonical disposition;
- planned merge assignment and writes independently passed ledger-derived plan readiness and hash-scope checks;
- the canonical revision/hash and transaction history reconstruct successfully;
- no blocking identity conflict remains;
- a current scoped review covers the final canonical revision, and if any review requested repair, that final review contains no `repair` or `critical` findings/actions;
- `mem_check_run` reports no errors, including no unresolved reviewer-action diagnostic;
- `mem_import_finalize` writes a successful schema-v2 `stages/import-run.json`, and fresh work status reports `terminalStatus: "finalized"` or `"finalized-with-deferred-findings"` when policy explicitly deferred non-blocking debt;

A failure is complete only after `mem_import_fail` persists the terminal reason. Never report success from worker or coordinator prose alone. Failed runs remain recoverable checkpoints: `mem_import_recover` reactivates the same run with rotated coordinator authority and a fresh worker-authorization epoch, preserving verified completed stages while requiring fresh assignments only for incomplete work. Finalized runs remain permanently terminal.

## Reference map

- [Parent preflight and phase launch](references/parent-preflight.md) — parent-only acceptance, single begin, and seven coordinator launches.
- [Coordinator decisions](references/workflow.md) — typed phase inputs/outputs, retries, waves, and phase gates.
- [Tool behavior](references/helper-tools.md) — deterministic boundaries and durable outputs; model-call arguments live in tool schemas.
- [Role packets](references/extractor-role.md), [proposer](references/proposal-role.md), [reconciler](references/reconciler-role.md), [merger](references/merger-role.md), [reviewer](references/reviewer-role.md), [repairer](references/repairer-role.md).
