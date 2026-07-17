# Typed tool contracts

These are typed deterministic tools supplied by `extensions/mem-import-tools.ts`. They call the existing TypeScript normalization/staging services directly; do not replace them with shell/helper CLI commands.

## Coordinator-only tools

The parent model holds the coordinator grant returned by `mem_import_begin`.

- `mem_import_begin({ outputRoot, audit? })` creates a new run under that canonical output root and returns `{ runId, outputRoot, coordinatorGrant }`. `audit.parent` may contain only sanitized parent `model`/`thinking` identity; never include grants, credentials, prompts, or reasoning.
- `mem_import_normalize({ outputRoot, runId, coordinatorGrant, input })` deterministically normalizes source. It does not choose units, candidates, or semantic meaning.
- `mem_import_status(...)` returns normalization and extraction counts.
- `mem_import_inspect_manifest(...)` returns the complete normalized unit manifest.
- `mem_import_assign_extractor({ ..., taskId, unitIds, expiresAt?, retriesTaskId?, supersedesTaskIds?, audit? })` creates one durable extractor assignment and returns a worker bootstrap `{ runId, taskId, outputRoot, grant, unitIds, units, expiresAt, capabilities }`. Every retry has a fresh `taskId`; use `retriesTaskId` to retain its prior-task relationship. Units may belong to only one live extractor assignment: revoke the earlier task first, or name every live overlap in `supersedesTaskIds`. Supersession is durable and immediately disables the old worker. `audit` is limited to sanitized parent/worker model/thinking plus adapter/profile identity. `units` contains compact assigned-unit context (`unitId`, `sourceId`, `order`, optional title/role, and `blockCount`) for the coordinator and worker task; it does not replace source reads.
- `mem_import_revoke_assignment({ ..., taskId })` immediately disables that assignment for later extractor calls. Revocation/supersession, lifecycle outcome, task/run correlation, and packet-effect hashes are retained under `stages/orchestration/`; raw grants are never written there.

Use a fresh task ID for a retry or a superseding extractor. Never persist raw coordinator/worker grants in source, stage, world, review, or audit artifacts.

## Extractor-only tools

Every extractor tool requires the exact assignment bootstrap. The tools independently validate the assignment record and reject a wrong run/root/task/grant/role/capability/unit, an expired or revoked assignment, and missing normalization.

- `mem_source_read_unit({ ..., unitId, startAnchor?, endAnchor?, continuationCursor?, maxChars? })` returns only an assigned normalized unit or bounded local anchor slice. Its response reports `totalChars`, `returnedChars`, and, when truncated, `continuationCursor`. Pass that cursor unchanged on the next call (without anchors) to receive the next monotonic character page—even when a single block exceeds `maxChars`. `nextAnchor`, when supplied, is merely a block-boundary convenience; anchors remain provenance identifiers, not arbitrary character cursors. Invalid, wrong-unit, changed-source, or exhausted cursors fail locally.
- `mem_extraction_status(...)` reports assigned, submitted, and missing unit IDs.
- `mem_extraction_read({ ..., unitId })` reads a persisted packet only for an assigned unit.
- `mem_extraction_validate({ ..., unitId, stage })` performs no write; it checks stage shape, assigned source/unit identity, and local anchors.
- `mem_extraction_submit({ ..., unitId, stage })` atomically persists a validated extraction packet at the assigned unit's existing stage path.

## Extraction packet rules

The submitted `stage` must be a version-1 extraction envelope:

```json
{
  "version": 1,
  "kind": "extraction",
  "unitId": "assigned-unit-id",
  "sourceId": "assigned-source-id",
  "candidates": [
    {
      "id": "model-chosen-local-id",
      "group": "people",
      "title": "Candidate title",
      "provenance": [
        {
          "sourceId": "assigned-source-id",
          "unitId": "assigned-unit-id",
          "startAnchor": "b0001",
          "endAnchor": "b0001"
        }
      ],
      "payload": { "modelOwned": "rich semantic detail" }
    }
  ],
  "diagnostics": []
}
```

The tool validates operational facts only: envelope shape, assigned source/unit identity, candidate uniqueness, provenance presence, local anchor validity, and quote integrity. **Normally omit `provenance.quote`.** The service derives the durable quote from the cited normalized blocks, joined with exactly `\n\n`; this preserves exact Unicode typography (including curly quotes) without asking the model to transcribe it. A non-empty quote supplied by a model remains allowed only when it is a literal contiguous excerpt of that same range—no rendered `[bNNNN]` labels, ellipses, or typography normalization. The tool does **not** decide identity, canon, importance, candidate quality, excerpt selection, or whether a candidate should be merged.

## Parent decision after submission

A successful tool return means only that a structurally valid packet was atomically persisted in the authorized scope. The coordinator must inspect the packet and status, then decide whether to dispatch another unit, re-extract, escalate a weak unit, merge, review, repair, or stop.

## U2 merge, review, and finalization tools

`mem_import_assign_worker` issues a bounded `proposer`, `merger`, `reviewer`, or `repairer` bootstrap. A proposer requires explicit `unitIds` and may be further restricted to qualified `unitId:candidateId` values; a repairer requires explicit checkpoint and action IDs. Every worker tool independently validates the hashed grant, active run/root, role, capability, expiry/revocation state, and relevant unit/checkpoint/action scope. Sanitized allow/deny decisions are persisted as immutable authorization events; raw grants and rejected source payloads are never recorded.

- `mem_proposal_submit({ ..., packet })` validates and atomically persists one immutable bounded shard proposal under `stages/runs/<run-id>/proposals/`. It requires a proposer grant, verifies every declared extraction packet hash against its current persisted packet, enforces assignment unit/candidate scope, and derives literal artifact quotes. It cannot mutate canonical merge state.
- `mem_extraction_inventory_worker({ ..., group?, continuationCursor?, maxItems? })` returns only compact packet summaries (unit/source ID, packet hash, candidate totals, and group counts), capped at 100 entries. Use its monotonic cursor to select work; it never returns candidate payloads.
- `mem_extraction_read_worker({ ..., unitId, candidateIds?, continuationCursor?, maxCandidates? })` returns candidates from exactly one packet, capped at 100 per page. It rejects stale cursors when the packet or selected candidate filter changed. Never request a whole corpus extraction read.
- `mem_merge_read` / `mem_import_merge_state` currently read the canonical merge snapshot and its revision/hash controls. This legacy complete-snapshot surface is not suitable for a substantive corpus; U2b replaces it with bounded canonical inventory and transaction reads.
- `mem_merge_acquire_lease`, heartbeat, and release are worker operations; `mem_import_*_merge_lease` variants are for explicit parent-authored work. The lease has a fence generation, 60-second heartbeat, five-minute expiry, and conservative post-expiry recovery.
- `mem_merge_apply_batch({ ..., batch })` is the normal merger mutation surface: it accepts one to twelve proposal-backed upsert/delete operations, a current fence, and exact expected revision/hash. The service materializes latest state, persists a delta receipt under `stages/merge/transactions/`, and leaves earlier accepted batches intact when later work fails.
- `mem_merge_write` / `mem_import_write_merge` are retained only for small-corpus legacy comparison. They require the active fence plus exact expected revision/hash and persist complete-snapshot receipts under `stages/merge/revisions/`. A stale lease or CAS fails without overwriting newer work.
- `mem_review_submit` writes one immutable reviewer packet, bound to an existing merge revision/hash. It is the only reviewer write and cannot mutate world state.
- `mem_check_run` reads deterministic lint, coverage, provenance, and readiness evidence.
- `mem_import_finalize` requires a coordinator lease. It emits Markdown, reruns checks, and writes `stages/import-run.json` schema v2. Error-level diagnostics yield a failed finalization record rather than finalized success.
- `mem_import_fail` records a concise coordinator-only terminal failure when the mandatory delegated-worker capability/allowlist gate cannot be met. It never stores grants, prompts, or hidden reasoning.

Merge-stage `revision`, `contentHash`, and optional parent hash are service-derived control fields. Workers submit semantic stage content; tools do not decide semantic quality. Each merge receipt records the input extraction hash, parent linkage, actor/task, fence, compact rationale, and checkpoint/action scope where applicable.
