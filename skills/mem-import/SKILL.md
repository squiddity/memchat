---
name: mem-import
description: Import a book or series into a provenance-rich world library with bounded semantic subagents. Use for fresh imports, maintained compendia, resumable extraction, canonical merge, review, and repair.
---

# Mem Import

Treat durable artifacts as a **ledger**: normalized source, extraction packets, proposals, identity packets, canonical transactions, reviews, checks, and the final run record are authoritative. Worker and coordinator prose is only a receipt.

## 1. Choose your role

- **Parent agent:** read [parent preflight and phase launch](references/parent-preflight.md). After preflight, call exactly one begin tool, retain its run identity and coordinator authority only in live context, and launch the four fresh phase coordinators in order.
- **Phase coordinator:** the bootstrap must name exactly one phase: `extraction`, `proposal-reconciliation`, `merge`, or `review-finalization`. Do not run acceptance, call a begin tool, launch another coordinator, or perform another phase. Continue at section 2.

If neither role and phase are explicit, stop and clarify rather than mixing parent, coordinator, and worker duties.

## 2. Honor the phase handoff

The parent supplies only a small launch envelope (`phase`, `outputRoot`, `runId`, requested scope, and extraction input only when needed) plus coordinator authority transiently. Never persist authority or copy it into an assignment, recipe, audit, packet, or completion prose.

At phase startup, reconstruct inputs by calling the typed status, manifest, controls, inventory, and effect tools named in [coordinator decisions](references/workflow.md). Never use a prior coordinator transcript, summary, or claimed hash as an input. At phase exit, re-read the typed durable outputs for that phase. If interrupted, resume or restart only the current phase; never resume a completed earlier phase or skip a phase whose exit ledger is incomplete.

## 3. Enforce worker assignments

Assignment results contain the complete worker bootstrap and exact semantic `tools` array. Pass both verbatim to the selected facility with the chosen model/thinking setting. Require the exact semantic profile, apart from documented lifecycle controls, and record the strongest lifecycle/tool evidence the facility exposes. Never derive observed evidence from the assignment or worker prose. If the facility cannot enforce `assignment.tools`, call `mem_import_fail` and stop.

After launching a worker, **end the turn and remain idle** for push-delivered completion. Never poll merely to detect completion, schedule an ordinary wake-up, or launch a child to wait, sleep, monitor, say “done,” or keep the coordinator alive. Only a genuine external deadline without native completion may justify a timer. Wait/helper children invalidate the run.

Read the selected facility's adapter reference only for invocation details. A recipe never replaces live assignment, dispatch, lifecycle, and durable-effect checks.

## 4. Execute only the assigned phase

Read [coordinator decisions](references/workflow.md), then perform one phase:

1. **Extraction:** assess run/manifest status, normalize if needed, dispatch [extractors](references/extractor-role.md), and exit only after the extraction ledger is complete.
2. **Proposal/reconciliation:** assess the complete flattened candidate inventory, persist one model-authored identity-aware cluster plan, dispatch artifact-scoped [proposers](references/proposal-role.md) and required [reconcilers](references/reconciler-role.md), and exit only when plan status is ready for merge with complete, non-duplicated proposal disposition coverage.
3. **Merge:** independently require ready cluster-plan status, dispatch one plan-scoped [merger](references/merger-role.md), and exit only after proposal consumption and canonical candidate accounting are complete with no blocking conflict.
4. **Review/finalization:** assess current canonical controls, dispatch a [reviewer](references/reviewer-role.md), select any scoped [repair](references/repairer-role.md), require a current post-repair review, run checks, and finalize.

After each child terminates, record its exact completed dispatch receipt and inspect its durable effect before scheduling dependent work. Retry with a fresh assignment after revocation, not by editing an immutable packet.

## 5. Complete the ledger

Success requires all of the following:

- all four fresh coordinator phases completed sequentially against the same run;
- every intended unit has an accepted extraction packet;
- every used semantic effect has a completed assignment-bound receipt matching the worker's exact requested tool profile and the strongest lifecycle/tool evidence the facility exposes;
- no unassigned or unrestricted helper child participated in the run;
- one immutable cluster plan exactly partitions the complete extraction snapshot; every cluster has one effective proposal and every required reconciliation set has one identity packet;
- every extraction candidate has exactly one proposal-stage disposition and a canonical disposition;
- planned merge assignment and writes independently passed ledger-derived plan readiness and hash-scope checks;
- the canonical revision/hash and transaction history reconstruct successfully;
- no blocking identity conflict remains;
- a current review covers the final canonical revision;
- `mem_check_run` reports no errors;
- `mem_import_finalize` writes a successful schema-v2 `stages/import-run.json`, and fresh work status reports `terminalStatus: "finalized"`.

A failure is complete only after `mem_import_fail` persists the terminal reason. Never report success from worker or coordinator prose alone.

## Reference map

- [Parent preflight and phase launch](references/parent-preflight.md) — parent-only acceptance, single begin, and four coordinator launches.
- [Coordinator decisions](references/workflow.md) — typed phase inputs/outputs, retries, waves, and phase gates.
- [Tool behavior](references/helper-tools.md) — deterministic boundaries and durable outputs; model-call arguments live in tool schemas.
- [Role packets](references/extractor-role.md), [proposer](references/proposal-role.md), [reconciler](references/reconciler-role.md), [merger](references/merger-role.md), [reviewer](references/reviewer-role.md), [repairer](references/repairer-role.md).
