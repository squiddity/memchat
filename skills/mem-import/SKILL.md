---
name: mem-import
description: Import a book or series into a provenance-rich world library with bounded semantic subagents. Use for fresh imports, maintained compendia, resumable extraction, canonical merge, review, and repair.
---

# Mem Import

Treat durable artifacts as a **ledger**: normalized source, extraction packets, proposals, canonical transactions, reviews, checks, and the final run record are authoritative. Worker prose is only a receipt.

## 1. Launch through the installed subagent facility

Unless the task bootstrap explicitly says **you are the corpus coordinator**, act as the parent and do not call import tools yourself. Launch one coordinator child with a bootstrap that names that role and tells it to continue at section 2. A coordinator must not recursively launch another coordinator.

Before any import tool call:

1. Confirm that an installed and enabled subagent extension exposes the `subagent` facility.
2. Confirm that the facility can launch a bounded coordinator child with an explicit model, thinking setting, working directory, context, and tool allowlist.
3. Confirm that the coordinator child receives the mem-import skill, coordinator tools, `subagent`, and lifecycle controls—and can use that same facility to launch exact-allowlist workers.
4. Launch the corpus coordinator with `subagent`. Do not use an alternate or inline agent-hosting path.
5. Treat the parent-to-coordinator launch like any other subagent call: use native completion, interruption, and resume behavior, and rely on the durable ledger for handoff.

If the installed facility cannot support both levels—parent → coordinator and coordinator → worker—stop with concrete installation guidance. Do not begin the import or build an adapter during the run.

## 2. Mandatory acceptance gate

The launched coordinator checks the deterministic acceptance state for the exact subagent installation, coordinator profile, worker profile, model/thinking settings, tool allowlists, and repository/package revision. If it is missing, stale, failed, partial, unreadable, or mismatched, run the focused [installation acceptance probes](references/acceptance-ladder.md) in disposable roots.

Acceptance must prove both that the parent launched this coordinator with the accepted profile and that this coordinator can dispatch exact-assignment worker profiles through the same subagent facility. Stop at the first failed required probe. Persist only the sanitized fingerprinted receipt, then continue the requested corpus in this coordinator.

The coordinator states the preflight result before beginning the corpus run. A prior successful import, an extension-name assertion, or an existing output directory is not acceptance evidence.

## 3. Choose the run mode

- **Standalone book:** `mem_import_begin`, then `mem_import_normalize`.
- **Maintained book or series:** read [compendium runs](references/compendium-runs.md), then use its begin and normalize tools.

Inspect the complete manifest. This step is complete when every intended source unit appears in the normalized ledger.

## 4. Enforce worker assignments

Assignment results contain the complete worker bootstrap and exact `tools` array. The coordinator passes both verbatim to `subagent` and requests the accepted model and thinking setting. A current acceptance receipt never replaces per-run assignment, dispatch, lifecycle, and durable-effect checks.

When the facility cannot enforce `assignment.tools`, call `mem_import_fail` and stop. Read the detected subagent adapter reference only when invocation details are needed.

## 5. Run the golden path

Read [coordinator decisions](references/workflow.md), then repeat these bounded phases:

1. **Extract:** assign disjoint units, dispatch [extractors](references/extractor-role.md), and inspect persisted packets. Start with one to three workers; widen only after clean evidence.
2. **Propose:** assign accepted extraction shards and dispatch [proposers](references/proposal-role.md). Each proposal accounts for every assigned candidate.
3. **Reconcile when needed:** dispatch [reconcilers](references/reconciler-role.md) for cross-shard or existing-canon identity questions. A fresh shard with no identity question needs no reconciliation wave.
4. **Merge:** dispatch one [merger](references/merger-role.md). It reads immutable proposals and commits bounded batches; the commit tool owns lease and CAS lifecycle.
5. **Review and repair:** dispatch a [reviewer](references/reviewer-role.md). The coordinator selects any actions worth a scoped [repair](references/repairer-role.md).

After each child terminates, record its exact completed dispatch receipt and inspect its durable effect before scheduling dependent work. Retry with a fresh assignment after revocation, not by editing an immutable packet.

## 6. Complete the ledger

Success requires all of the following:

- every intended unit has an accepted extraction packet;
- the coordinator was launched through the accepted subagent facility;
- every used semantic effect has a completed exact-profile subagent receipt;
- every extraction candidate has a canonical disposition;
- the canonical revision/hash and transaction history reconstruct successfully;
- no blocking identity conflict remains;
- `mem_check_run` reports no errors;
- `mem_import_finalize` writes a successful schema-v2 `stages/import-run.json`.

A failure is complete only after `mem_import_fail` persists the terminal reason. Never report success from worker prose alone.

## Reference map

- [Coordinator decisions](references/workflow.md) — retries, waves, escalation, and phase gates.
- [Tool behavior](references/helper-tools.md) — deterministic boundaries and durable outputs; model-call arguments live in tool schemas.
- [Installation acceptance probes](references/acceptance-ladder.md) — load only for missing, partial, or stale exact-profile acceptance.
- [Subagent capabilities](references/subagent-capabilities.md) — facility assessment.
- [Role packets](references/extractor-role.md), [proposer](references/proposal-role.md), [reconciler](references/reconciler-role.md), [merger](references/merger-role.md), [reviewer](references/reviewer-role.md), [repairer](references/repairer-role.md).
