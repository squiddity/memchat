---
name: mem-import
description: Import a book or series into a provenance-rich world library with bounded semantic subagents. Use for fresh imports, maintained compendia, resumable extraction, canonical merge, review, and repair.
---

# Mem Import

Treat durable artifacts as a **ledger**: normalized source, extraction packets, proposals, canonical transactions, reviews, checks, and the final run record are authoritative. Worker prose is only a receipt.

## 1. Choose your role

- **Parent agent:** do not call corpus import tools. Read [parent preflight and coordinator launch](references/parent-preflight.md), complete it, launch exactly one corpus coordinator, and stop this workflow.
- **Corpus coordinator:** the bootstrap must name this role. Do not run acceptance, inspect acceptance fixtures, or launch another coordinator. Continue at section 2 and enforce host evidence on every real worker dispatch.

If neither role is explicit, stop and clarify rather than mixing parent acceptance with corpus work.

## 2. Choose the run mode

- **Standalone book:** `mem_import_begin`, then `mem_import_normalize`.
- **Maintained book or series:** read [compendium runs](references/compendium-runs.md), then use its begin and normalize tools.

Inspect the complete manifest. This step is complete when every intended source unit appears in the normalized ledger.

## 3. Enforce worker assignments

Assignment results contain the complete worker bootstrap and exact semantic `tools` array. Pass both verbatim to the selected facility with the chosen model/thinking setting. Require the exact semantic profile, apart from documented lifecycle controls, and record the strongest lifecycle/tool evidence the facility exposes. Never derive observed evidence from the assignment or worker prose. If the facility cannot enforce `assignment.tools`, call `mem_import_fail` and stop.

After launching a worker, **end the turn and remain idle** for push-delivered completion. Never poll merely to detect completion, schedule an ordinary wake-up, or launch a child to wait, sleep, monitor, say “done,” or keep the coordinator alive. Only a genuine external deadline without native completion may justify a timer. Wait/helper children invalidate the run.

Read the selected facility's adapter reference only for invocation details. A recipe never replaces live assignment, dispatch, lifecycle, and durable-effect checks.

## 4. Run the golden path

Read [coordinator decisions](references/workflow.md), then repeat these bounded phases:

1. **Extract:** assign disjoint units, dispatch [extractors](references/extractor-role.md), and inspect persisted packets. Start with one to three workers; widen only after clean evidence.
2. **Propose:** assign accepted extraction shards and dispatch [proposers](references/proposal-role.md). Each proposal accounts for every assigned candidate.
3. **Reconcile when needed:** dispatch [reconcilers](references/reconciler-role.md) for cross-shard or existing-canon identity questions. A fresh shard with no identity question needs no reconciliation wave.
4. **Merge:** dispatch one [merger](references/merger-role.md). It reads immutable proposals and commits bounded batches; the commit tool owns lease and CAS lifecycle.
5. **Review and repair:** dispatch a [reviewer](references/reviewer-role.md). The coordinator selects any actions worth a scoped [repair](references/repairer-role.md).

After each child terminates, record its exact completed dispatch receipt and inspect its durable effect before scheduling dependent work. Retry with a fresh assignment after revocation, not by editing an immutable packet.

## 5. Complete the ledger

Success requires all of the following:

- every intended unit has an accepted extraction packet;
- the coordinator was launched through the selected facility with the intended model, tools, and usable lifecycle identity;
- every used semantic effect has a completed assignment-bound receipt matching the worker's exact requested tool profile and the strongest lifecycle/tool evidence the facility exposes;
- no unassigned or unrestricted helper child participated in the run;
- every extraction candidate has a canonical disposition;
- the canonical revision/hash and transaction history reconstruct successfully;
- no blocking identity conflict remains;
- `mem_check_run` reports no errors;
- `mem_import_finalize` writes a successful schema-v2 `stages/import-run.json`.

A failure is complete only after `mem_import_fail` persists the terminal reason. Never report success from worker prose alone.

## Reference map

- [Parent preflight](references/parent-preflight.md) — parent-only acceptance and coordinator launch.
- [Coordinator decisions](references/workflow.md) — retries, waves, escalation, and phase gates.
- [Tool behavior](references/helper-tools.md) — deterministic boundaries and durable outputs; model-call arguments live in tool schemas.
- [Role packets](references/extractor-role.md), [proposer](references/proposal-role.md), [reconciler](references/reconciler-role.md), [merger](references/merger-role.md), [reviewer](references/reviewer-role.md), [repairer](references/repairer-role.md).
