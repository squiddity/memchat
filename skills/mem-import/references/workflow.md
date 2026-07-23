# Phase coordinator decisions

A fresh phase coordinator schedules bounded semantic work for exactly one phase. Tools persist and validate the ledger; no coordinator conversation is a handoff.

## Universal phase contract

At startup, call the named typed read tools against the supplied `outputRoot` and `runId`. Treat their current durable result—not prior prose or a status object copied into the prompt—as the phase input. Check `terminalStatus` before mutation: `failed` or `finalized` is terminal.

At exit, call the same typed reads again and verify the phase's output conditions. Do not claim a phase complete from worker prose. If a phase is interrupted, resume or restart only that phase and reconstruct again from typed reads. Earlier phase artifacts remain inputs; earlier coordinator sessions do not.

## Phase 1: extraction

**Startup inputs**

- Call `mem_import_work_status`; require `terminalStatus: "active"`.
- Call `mem_import_status`.
- If normalized, call `mem_import_inspect_manifest` and assess every intended unit. If not normalized, call the appropriate normalize tool once with the supplied source input, then inspect the manifest.
- Page `mem_import_effect_inventory` as needed to identify already completed exact-profile extractor effects before issuing fresh assignments.

Assign disjoint units, dispatch extractors, and inspect persisted packets. Start with one to three workers; widen only after clean evidence. For each shard require complete source reads, valid anchors, unclipped payloads, a persisted packet, and a completed dispatch receipt exactly matching `assignment.tools`.

**Exit outputs**

- Re-read `mem_import_work_status` and require `terminalStatus: "active"`.
- Re-read `mem_import_status`; require `normalized: true`, the intended manifest unit count, and `extractionStageCount === unitCount`.
- Re-read the complete manifest and bounded effect inventory; require a valid persisted extraction effect and completed exact-profile dispatch for every intended unit.

Revoke and retry weak, clipped, interrupted, or missing assignments with fresh task IDs. Do not advance while an intended unit is absent.

## Phase 2: proposal/reconciliation

**Startup inputs**

- Call `mem_import_status`; require complete extraction coverage.
- Call `mem_import_work_status`; require `terminalStatus: "active"` and assess `candidateCount`, `uniqueProposedCandidateCount`, `unproposedCandidateCount`, `duplicateProposalDispositionCount`, and `identityPacketCount`.
- Page the flattened manifest-order `mem_import_candidate_inventory` through one stable snapshot hash. Inspect all candidate ID/group/title rows across unit boundaries before choosing identity-aware shards.
- Call `mem_import_cluster_plan_status`. If no plan exists, submit exactly one complete model-authored partition with `mem_import_cluster_plan_submit`, using the inventory snapshot and canonical baseline controls. If a plan exists, resume it; never replace it.
- Page `mem_import_effect_inventory` only as needed to reconstruct immutable effects and failed/revoked no-effect retries.

Put recurring observations of a supported identity into a labeled `identity` cluster; use labeled `coherent` clusters for scene, chapter, fact, or style shards where shared identity is not asserted. Give every cluster a concise rationale. Keep uncertain identities separate and name their clusters in at most one reconciliation set. Deterministic validation checks only exact candidate partitioning, references, hashes, and bounds—it never chooses identity. Assign each proposer by exactly one `planHash` and `clusterId`; the service derives its unit/candidate scope. After those cluster proposals persist, assign each required reconciler by `planHash` and `reconciliationSetId`; the service derives the completed proposal hashes and baseline/dependency evidence. Every assigned candidate receives exactly one proposal disposition. Reconcilers read immutable proposals directly; extraction packets are supporting evidence, not substitutes for proposals.

**Exit outputs**

- Re-read `mem_import_work_status`; require `uniqueProposedCandidateCount === candidateCount`, `unproposedCandidateCount === 0`, and `duplicateProposalDispositionCount === 0`.
- Re-read `mem_import_cluster_plan_status`; require zero pending clusters, every required reconciliation set completed, and `readyForMerge: true`.
- Page `mem_import_effect_inventory`; require every plan-bound proposal or identity hash to have its completed exact-profile dispatch receipt.

A duplicate proposal disposition is a ledger error. Revoke/retry or fail explicitly; do not choose one from prose and do not begin merge.

## Phase 3: merge

**Startup inputs**

- Call `mem_import_work_status`; require active terminal status and complete non-duplicated proposal coverage.
- Independently call `mem_import_cluster_plan_status`; require the expected plan hash and `readyForMerge: true`. Merger assignment and every planned merge write revalidate this ledger gate.
- Call `mem_import_merge_state` for compact canonical controls. Use only the proposal and identity hashes derived into the merger assignment, plus bounded proposal, identity, canonical inventory, and explicit artifact reads for content; never request or reconstruct a complete snapshot.
- Page `mem_import_effect_inventory` to recover immutable proposal/identity hashes and completed dispatch evidence.

Dispatch one merger. Prefer `accept` changes that copy proposal artifacts exactly, group compatible proposals into weighted transactions, and use explicit `upsert` only for intentional synthesis. Copy `artifactContentHash` into read sets; use `null` only after observing an absent target. A batch consuming any proposal from a reconciliation set must include that set's identity packet unless an earlier accepted transaction already consumed it.

`mem_merge_commit` owns lease, fence, current-revision CAS, candidate-accounting carry-forward, and release. Never broaden `assignment.tools`, guess fences, or revoke a lease-owning worker before cleanup completes. On stale evidence, re-read only the affected canonical neighborhood.

**Exit outputs**

- Re-read `mem_import_work_status` and compact merge controls.
- Require `unconsumedProposalCount === 0`, `unaccountedCandidateCount === 0`, `blockingConflictCount === 0`, and a non-null canonical `contentHash` with positive `revision` when candidates exist.
- Require every merge effect to have a completed exact-profile dispatch receipt in `mem_import_effect_inventory`.

The coordinator never writes a complete canonical snapshot or invents dispositions for failed semantic work.

## Phase 4: review/finalization

**Startup inputs**

- Call `mem_import_work_status` and `mem_import_merge_state`; require active status and all merge exit conditions.
- Assess current revision/hash, review validity counts, conflicts, and bounded effect inventory. Do not accept a prior coordinator's claim that a review is current.

Review one explicit lens at a time. Select any repair actions; a repairer receives only those checkpoint/action IDs. Any canonical repair makes the prior revision review stale, so dispatch a new reviewer against the resulting revision. Run `mem_check_run` after the final accepted transaction.

**Exit outputs**

- Before finalization, require compact controls to report a current review for the final revision, no blocking conflict, no proposal/candidate gap, and checks with no errors.
- Acquire the coordinator finalization lease, call `mem_import_finalize`, and release the lease in cleanup.
- Re-read `mem_import_work_status`; success requires `terminalStatus: "finalized"`. If the phase cannot repair a failed finalization/check result, call `mem_import_fail` and require durable `terminalStatus: "failed"`; never exit on a prose-only failure.

## Dispatch ledger for every phase

1. Issue a role assignment.
2. Pass its bootstrap and semantic `tools` array verbatim to the selected facility; launch no helper child.
3. End the turn and wait at rest for push-delivered terminal completion. Do not poll, schedule an ordinary wake-up, or launch a wait/no-op/monitor child.
4. Require the exact semantic tool profile plus documented lifecycle controls. Verify active/denied tools and profile-preserving resume when the host exposes that evidence; record unavailable fields as unavailable.
5. Record requested tools and only actually observed model, thinking, child ID, tools, lifecycle profile, and outcome with `mem_import_record_dispatch`. Never derive observations from the assignment or worker prose.
6. Inspect the effect with `mem_import_effect_inventory` before dependent work. A durable effect cannot replace required dispatch evidence.

A failed, cancelled, missing, mismatched, broadened, or inaccurately recorded receipt invalidates the dispatch; retry fresh or stop. Treat a terminal host result as final even if its prose claims otherwise.

For an unplanned non-extractor retry, revoke the old assignment and issue a fresh task ID. For a plan-bound proposer or reconciler, a fresh retry may name `retriesTaskId` only after the prior assignment is revoked, expired, or has a recorded failed/cancelled dispatch and no semantic effect. An effective cluster/set cannot be assigned again. `supersedesTaskIds` remains extractor-only.

## Scale and recovery

- Keep source reads, proposal reads, canonical inventories, and commits paginated/bounded.
- Keep one canonical merger active. Immutable packets permit restart without re-extraction or proposal replay.
- Earlier accepted transactions survive later interruption.
- Reconstruct from typed status/inventory/effect tools, never conversation memory or filesystem helpers.
- Stop fanout on repeated schema failures, provider failures, weak source coverage, or parent backlog.

## Facility-specific setup

Read only the selected facility's adapter reference for launch syntax, extension setup, workspace layout, model choices, and current-phase recovery. [pi-herdr-subagents](adapters/pi-herdr-subagents.md) is one example recipe, not a required facility.
