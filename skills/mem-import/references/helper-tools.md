# Deterministic tool behavior

Model-call arguments and required fields are defined by the active tool schemas. This reference describes boundaries and durable effects rather than duplicating those schemas.

## Run authority

Coordinator tools create and normalize a standalone or compendium run, inspect status, issue/revoke assignments, record host dispatches, run checks, and finalize. Keep coordinator and worker grants in live task context only.

Assignment results are complete child bootstraps. Their `tools` array is the exact model-visible host allowlist for that role. `mem_import_assignment_brief` remains a bootstrap re-rendering aid for recovery, not a required second call after a successful assignment.

`mem_import_effect_inventory` pages compact assignment, retry-lineage, dispatch, and immutable effect-hash summaries. Use it instead of worker prose or filesystem helpers to discover proposal, identity, merge, review, and extraction effects. It never returns grants or artifact paths. For merge and repair, the fully reconstructed immutable canonical transaction is authoritative; if interruption left its per-run effect projection or canonical identity/conflict projection absent, typed status/inventory replays the complete receipt chain without trusting checkpoints, rebuilds identity/conflict state, and deterministically materializes an idempotent effect only after validating the current head, owning standalone/compendium run, actor assignment authority/lifecycle/scope, receipt hash, and one-to-one transaction/effect mapping. Recovery rejects unknown/non-worker actors, orphan effects, and malformed history, and never manufactures or excuses the separately required exact completed dispatch receipt. Pre-upgrade transactions without a control digest/assignment binding remain readable when their original exact-path effect exists, but a missing legacy effect is classified as manual-repair-required rather than inferred.

`mem_import_work_status` is the compact cross-phase ledger handoff. In addition to revision, proposal consumption, canonical candidate accounting, and conflicts, it reports unique candidates covered by proposal dispositions, unproposed candidates, duplicate proposal dispositions, identity packet count, explicit `active`/`failed`/`finalized` terminal status, and content-free evidence-read totals by role/tool. Evidence-read telemetry counts successful model-facing pages and returned item/character volume; it never stores call arguments, source text, prompts, or grants. `mem_import_merge_state` adds canonical artifact/disposition counts and review validity without artifact bodies. Fresh phase coordinators rebuild these values from durable files; no status depends on an earlier service instance or coordinator conversation.

`mem_import_record_dispatch` persists each worker's exact sanitized running-child ID and complete session filename stem and optional live schema-v1 usage hint with its assignment receipt. `mem_import_record_session` does the same for a phase coordinator and may run after terminal finalization. For the local Pi/Herdr adapter, both recording tools eagerly resolve and return the authoritative content-free activity sidecar; later finalization and post-terminal refresh repeat resolution, retain the latest cumulative activity sequence across resumes, deduplicate repeated child identities, and snapshot portable per-session records. A malformed or truncated Pi/Herdr session stem is rejected before persistence. The final schema-v2 `stages/import-run.json` aggregates sessions, turns, responses, token/cache/reasoning fields, and provider-reported costs by role and phase; provider/model buckets aggregate host-attributed response, token, and cost fields while leaving unavailable per-model session/turn attribution null. A null provider metric stays null, partial coverage cannot become an inexact grand total, and absent, invalid, stale, or unmatched sidecars remain explicitly unavailable. Neither per-session records nor aggregates contain prompts, responses, grants, credentials, hidden reasoning, or account identifiers.

An explicit `mem_import_fail` closes the run to semantic mutation until an authorized `mem_import_recover`; successful finalization is permanently mutation-terminal. Recovery keeps the same run ID and verified immutable stage/transaction history, rotates coordinator authority, increments the worker authorization epoch so every prior grant is stale, clears a lease owned by the failed run, and records failure/recovery lineage. Fresh assignments are issued only for ledger-derived incomplete work; completed extraction, plan, proposal, reconciliation, and canonical effects are not replayed. Read-only coordinator status remains available while failed. Semantic no-op merge transactions create no revision or effect.

## Source and extraction

Extractor reads are assignment-scoped and cursor-paginated. Pass a returned continuation cursor unchanged. Anchors identify normalized source blocks; they are not character offsets.

Extraction submission validates assignment identity, unit/source identity, candidate IDs, and local anchors. The service derives exact Unicode quote text from each anchor range and ignores model transcription. A successful submit writes one immutable authorized packet for that unit attempt.

After extraction completes, `mem_import_candidate_inventory` flattens every packet into manifest-order `(unitId, candidateId, group, title)` pages under one extraction snapshot hash and canonical baseline. Its cursor fails stale if any packet changes. The proposal/reconciliation coordinator must inspect the complete flattened inventory, then call `mem_import_cluster_plan_submit` once with a model-authored exact candidate partition and any reconciliation sets. Deterministic code validates references, complete accounting, bounds, hashes, and immutable idempotence only; it does not infer identity. `mem_import_cluster_plan_status` pages bounded ledger-derived pending/proposed clusters and required/completed reconciliation sets and computes `readyForMerge`.

## Proposals

A planned proposer assignment names one plan hash and cluster ID; unit/candidate scope is derived from the immutable artifact, concurrent overlap is rejected, and only a revoked/failed no-effect attempt can receive a fresh retry. The proposer submit tool accepts typed semantic artifacts, one disposition for every assigned candidate, and a rationale. It derives packet version/kind/ID, plan/cluster binding, current extraction packet hashes, candidate scope, and exact quotes. Missing or duplicate candidate accounting fails before persistence.

Proposal inventory/read tools expose immutable proposal hashes and bounded artifact pages to reconcilers, mergers, and repairers. Downstream workers read proposals directly rather than reconstructing them from extraction packets.

## Canonical reads and commits

Canonical inventory and artifact reads return `artifactContentHash`. Copy that value into a commit read-set entry; use `null` only for an observed absent target.

Before mutation, call `mem_merge_requirements` with the exact proposal subset intended for one transaction. It returns subset-derived pending proposal/identity hashes, identity creates that require same-batch upserts, match read-set controls, blocking conflict requirements, and weighted limits. It reports deterministic prerequisites without choosing identity or artifact semantics. `mem_merge_validate` checks one fully shaped commit against current scope, read sets, identity requirements, and canonical application without acquiring the writer lease or mutating state. Commit rechecks everything atomically because validation can become stale.

The merger's normal mutation is `mem_merge_commit`:

- grouped `proposalAccepts` copy several unchanged artifact IDs while repeating each immutable proposal hash only once; every artifact ID in every declared proposal must be covered by an accept or synthesized operation, so a transaction cannot partially consume a proposal;
- explicit `accept` remains available for a single proposal artifact reference;
- `upsert` is an intentional synthesized artifact supported by declared proposals and never carries `proposalHash`;
- `delete` removes an observed canonical artifact.

One call uses weighted limits: up to 50 expanded lightweight accepts, up to 12 combined synthesized `upsert`/`delete` changes, up to 50 supporting proposal hashes, and no more than 62 expanded changes. The service resolves accepts internally, carries proposal candidate dispositions, acquires the fenced writer lease, validates the bounded read set, commits against current canonical state, records content-addressed history, releases the lease, and returns a compact receipt rather than the complete canonical stage. Unrelated changes do not invalidate unchanged artifact observations; changed dependencies fail stale.

Complete-snapshot mutation is not a production model tool for either workers or coordinators. Internal reconstruction/snapshot APIs remain implementation details for history and tests; normal coordinators cannot replace canonical state or disposition failed-worker candidates inline.

## Identity, review, and repair

A planned reconciler assignment names one plan hash and reconciliation-set ID; completed proposal hashes are derived from cluster effects and persisted with the plan/set binding. Identity packets preserve model-owned match/create/ambiguous judgments and explicit blocking conflicts. When a plan declares bounded canonical artifact dependencies, an identity packet remains usable across unrelated canonical revisions while those exact dependency hashes are unchanged; sets without explicit dependencies intentionally retain strict baseline behavior. Planned merger assignment and write both require ledger-derived plan readiness and scope proposal/identity hashes to that assignment. Review packets bind findings and artifact observations to a canonical revision. Repair assignments bind mutations to selected checkpoint/action IDs.

These tools validate scope, references, immutability, and concurrency. They do not decide identity, canon, omission importance, retcons, or semantic quality.

## Completion

`mem_check_run` first emits the current deterministic Markdown projection, then returns coverage, provenance, conflict, dispatch, reviewer-action, and readiness diagnostics. A current `repair`/`critical` review finding or action is an error; once any review requests repair, a clean scoped post-repair review of the final canonical revision is required. `mem_import_finalize` emits Markdown, reruns the same checks, and writes schema-v2 `stages/import-run.json`; error diagnostics prevent successful finalization.
