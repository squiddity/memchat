---
name: mem-import
description: Import a book or series into a provenance-rich world library with bounded semantic subagents. Use for fresh imports, maintained compendia, resumable extraction, canonical merge, review, and repair.
---

# Mem Import

Treat durable artifacts as a **ledger**: normalized source, extraction packets, proposals, canonical transactions, reviews, checks, and the final run record are authoritative. Worker prose is only a receipt.

## 1. Mandatory preflight gate

Do not call `mem_import_begin`, any normalize tool, or dispatch semantic workers until this gate passes.

1. Determine the effective worker facility, model, thinking setting, adapter, tool allowlist, and repository/package revision.
2. Inspect the deterministic acceptance state for that exact profile fingerprint.
3. If the receipt is missing, stale, failed, partial, unreadable, or mismatched, run the independent [installation acceptance probes](references/acceptance-ladder.md) in fresh disposable roots.
4. The launcher materializes each required role probe from tracked fixtures, then launches the semantic child directly from its live assignment. Do not start an acceptance coordinator and never disclose the requested corpus input or output root.
5. Each semantic child calls its named production tool exactly once with the supplied fixture-backed body. The launcher validates host lifecycle, exact observed tools, and the durable effect hash.
6. Stop at the first failed required probe; do not start the requested corpus import.
7. Persist only the sanitized fingerprinted receipt, then start a fresh corpus coordinator invocation.
8. Continue only with current `accepted` evidence, while still performing per-run assignments, dispatch receipts, and lifecycle gates.

The coordinator should state the preflight result before beginning the corpus run. A prior successful import, a model/launcher assertion, or an existing output directory is not acceptance evidence.

## 2. Choose the run mode

- **Standalone book:** `mem_import_begin`, then `mem_import_normalize`.
- **Maintained book or series:** read [compendium runs](references/compendium-runs.md), then use its begin and normalize tools.

Inspect the complete manifest. This step is complete when every intended source unit appears in the normalized ledger.

## 3. Prove the worker profile

Use an ordinary subagent facility that enforces a per-child tool allowlist and reports terminal child identity. Assignment results contain the complete child bootstrap and exact `tools` array; pass both verbatim to the child. Request an explicit model and thinking setting from the host.

Before normalizing the requested corpus, tell the user whether exact-profile acceptance is current or whether the acceptance ladder will run first.

For a new or changed installation, or when no deterministic exact-fingerprint acceptance receipt is available, run the independent [installation acceptance probes](references/acceptance-ladder.md). A current accepted receipt skips that detailed reference, but never the per-run assignment and dispatch gates.

When the host cannot enforce that profile, call `mem_import_fail` and stop. Read a detected host's adapter reference only when invocation details are needed.

This step is complete when the exact profile has current acceptance evidence and the current run can enforce `assignment.tools`.

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
- every used semantic effect has a completed exact-profile ordinary-subagent receipt;
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
