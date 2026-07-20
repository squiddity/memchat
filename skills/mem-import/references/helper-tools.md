# Deterministic tool behavior

Model-call arguments and required fields are defined by the active tool schemas. This reference describes boundaries and durable effects rather than duplicating those schemas.

## Run authority

Coordinator tools create and normalize a standalone or compendium run, inspect status, issue/revoke assignments, record host dispatches, run checks, and finalize. Keep coordinator and worker grants in live task context only.

Assignment results are complete child bootstraps. Their `tools` array is the exact model-visible host allowlist for that role. `mem_import_assignment_brief` remains a bootstrap re-rendering aid for recovery, not a required second call after a successful assignment.

## Source and extraction

Extractor reads are assignment-scoped and cursor-paginated. Pass a returned continuation cursor unchanged. Anchors identify normalized source blocks; they are not character offsets.

Extraction submission validates assignment identity, unit/source identity, candidate IDs, and local anchors. The service derives exact Unicode quote text from each anchor range and ignores model transcription. A successful submit writes one immutable authorized packet for that unit attempt.

## Proposals

The proposer submit tool accepts typed semantic artifacts, one disposition for every assigned candidate, and a rationale. It derives packet version/kind/ID, current extraction packet hashes, candidate scope, and exact quotes. Missing or duplicate candidate accounting fails before persistence.

Proposal inventory/read tools expose immutable proposal hashes and bounded artifact pages to reconcilers, mergers, and repairers. Downstream workers read proposals directly rather than reconstructing them from extraction packets.

## Canonical reads and commits

Canonical inventory and artifact reads return `artifactContentHash`. Copy that value into a commit read-set entry; use `null` only for an observed absent target.

The merger's normal mutation is `mem_merge_commit`:

- `accept` copies an immutable proposal artifact by proposal hash and artifact ID;
- `upsert` is an intentional synthesized artifact supported by declared proposals;
- `delete` removes an observed canonical artifact.

One call is limited to twelve changes. The service carries proposal candidate dispositions, acquires the fenced writer lease, validates the bounded read set, commits against current canonical state, records content-addressed history, and releases the lease. Unrelated changes do not invalidate unchanged artifact observations; changed dependencies fail stale.

Complete-snapshot worker mutation is not a production tool. Internal reconstruction/snapshot APIs remain implementation details for history and tests.

## Identity, review, and repair

Identity packets preserve model-owned match/create/ambiguous judgments and explicit blocking conflicts. Review packets bind findings and artifact observations to a canonical revision. Repair assignments bind mutations to selected checkpoint/action IDs.

These tools validate scope, references, immutability, and concurrency. They do not decide identity, canon, omission importance, retcons, or semantic quality.

## Completion

`mem_check_run` emits deterministic coverage, provenance, conflict, dispatch, and readiness diagnostics. `mem_import_finalize` emits Markdown, reruns checks, and writes schema-v2 `stages/import-run.json`; error diagnostics prevent successful finalization.
