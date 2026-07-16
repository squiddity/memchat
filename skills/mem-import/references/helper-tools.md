# U1 typed tool contracts

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
          "endAnchor": "b0001",
          "quote": "Exact source excerpt."
        }
      ],
      "payload": { "modelOwned": "rich semantic detail" }
    }
  ],
  "diagnostics": []
}
```

The tool validates operational facts only: envelope shape, assigned source/unit identity, candidate uniqueness, provenance presence, local anchor validity, and quote integrity. Each non-empty quote must be a literal contiguous excerpt of the cited normalized blocks, whose canonical multi-block representation is block text joined with exactly `\n\n` (no rendered `[bNNNN]` labels, ellipses, or typography normalization). It does **not** decide identity, canon, importance, candidate quality, excerpt selection, or whether a candidate should be merged.

## Parent decision after submission

A successful tool return means only that a structurally valid packet was atomically persisted in the authorized scope. The coordinator must inspect the packet and status, then decide whether to dispatch another unit, re-extract, escalate a weak unit, or stop. U1 does not authorize merge/review/finalization work.
