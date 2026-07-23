# Deterministic tool behavior

Model-call arguments and required fields are defined by the active tool schemas. This reference describes boundaries and durable effects rather than duplicating those schemas.

## Run authority

Coordinator tools create and normalize a standalone or compendium run, inspect status, issue/revoke assignments, record host dispatches, run checks, and finalize. Keep coordinator and worker grants in live task context only.

Assignment results are complete child bootstraps. Their `tools` array is the exact model-visible host allowlist for that role. `mem_import_assignment_brief` remains a bootstrap re-rendering aid for recovery, not a required second call after a successful assignment.

`mem_import_effect_inventory` pages compact assignment, retry-lineage, dispatch, and immutable effect-hash summaries. Use it instead of worker prose or filesystem helpers to discover proposal, identity, merge, review, and extraction effects. It never returns grants or artifact paths.

`mem_import_work_status` is the compact cross-phase ledger handoff. In addition to revision, proposal consumption, canonical candidate accounting, and conflicts, it reports unique candidates covered by proposal dispositions, unproposed candidates, duplicate proposal dispositions, identity packet count, and explicit `active`/`failed`/`finalized` terminal status. `mem_import_merge_state` adds canonical artifact/disposition counts and review validity without artifact bodies. Fresh phase coordinators rebuild these values from durable files; no status depends on an earlier service instance or coordinator conversation.

An explicit `mem_import_fail` and a successful finalization make the run mutation-terminal. Read-only coordinator status remains available, but new assignments, launches, submissions, leases, reviews, and canonical mutations reject. Semantic no-op merge transactions create no revision or effect.

## Source and extraction

Extractor reads are assignment-scoped and cursor-paginated. Pass a returned continuation cursor unchanged. Anchors identify normalized source blocks; they are not character offsets.

Extraction submission validates assignment identity, unit/source identity, candidate IDs, and local anchors. The service derives exact Unicode quote text from each anchor range and ignores model transcription. A successful submit writes one immutable authorized packet for that unit attempt.

After extraction completes, `mem_import_candidate_inventory` flattens every packet into manifest-order `(unitId, candidateId, group, title)` pages under one extraction snapshot hash and canonical baseline. Its cursor fails stale if any packet changes. The proposal/reconciliation coordinator must inspect the complete flattened inventory, then call `mem_import_cluster_plan_submit` once with a model-authored exact candidate partition and any reconciliation sets. Deterministic code validates references, complete accounting, bounds, hashes, and immutable idempotence only; it does not infer identity. `mem_import_cluster_plan_status` pages bounded ledger-derived pending/proposed clusters and required/completed reconciliation sets and computes `readyForMerge`.

## Proposals

A planned proposer assignment names one plan hash and cluster ID; unit/candidate scope is derived from the immutable artifact, concurrent overlap is rejected, and only a revoked/failed no-effect attempt can receive a fresh retry. The proposer submit tool accepts typed semantic artifacts, one disposition for every assigned candidate, and a rationale. It derives packet version/kind/ID, plan/cluster binding, current extraction packet hashes, candidate scope, and exact quotes. Missing or duplicate candidate accounting fails before persistence.

Proposal inventory/read tools expose immutable proposal hashes and bounded artifact pages to reconcilers, mergers, and repairers. Downstream workers read proposals directly rather than reconstructing them from extraction packets.

## Canonical reads and commits

Canonical inventory and artifact reads return `artifactContentHash`. Copy that value into a commit read-set entry; use `null` only for an observed absent target.

The merger's normal mutation is `mem_merge_commit`:

- `accept` copies an immutable proposal artifact by proposal hash and artifact ID;
- `upsert` is an intentional synthesized artifact supported by declared proposals;
- `delete` removes an observed canonical artifact.

One call uses weighted limits: up to 50 lightweight `accept` references, up to 12 combined synthesized `upsert`/`delete` changes, up to 50 supporting proposal hashes, and no more than 62 total changes. The service resolves accepts internally, carries proposal candidate dispositions, acquires the fenced writer lease, validates the bounded read set, commits against current canonical state, records content-addressed history, releases the lease, and returns a compact receipt rather than the complete canonical stage. Unrelated changes do not invalidate unchanged artifact observations; changed dependencies fail stale.

Complete-snapshot mutation is not a production model tool for either workers or coordinators. Internal reconstruction/snapshot APIs remain implementation details for history and tests; normal coordinators cannot replace canonical state or disposition failed-worker candidates inline.

## Identity, review, and repair

A planned reconciler assignment names one plan hash and reconciliation-set ID; completed proposal hashes are derived from cluster effects and persisted with the plan/set binding. Identity packets preserve model-owned match/create/ambiguous judgments and explicit blocking conflicts. When a plan declares bounded canonical artifact dependencies, an identity packet remains usable across unrelated canonical revisions while those exact dependency hashes are unchanged; sets without explicit dependencies intentionally retain strict baseline behavior. Planned merger assignment and write both require ledger-derived plan readiness and scope proposal/identity hashes to that assignment. Review packets bind findings and artifact observations to a canonical revision. Repair assignments bind mutations to selected checkpoint/action IDs.

These tools validate scope, references, immutability, and concurrency. They do not decide identity, canon, omission importance, retcons, or semantic quality.

## Completion

`mem_check_run` emits deterministic coverage, provenance, conflict, dispatch, and readiness diagnostics. `mem_import_finalize` emits Markdown, reruns checks, and writes schema-v2 `stages/import-run.json`; error diagnostics prevent successful finalization.
