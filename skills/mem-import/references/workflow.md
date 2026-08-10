# Phase coordinator decisions

A fresh phase coordinator schedules bounded semantic work for exactly one phase. Tools persist and validate the ledger; no coordinator conversation is a handoff.

## Universal phase contract

At startup, call the named typed read tools against the supplied `outputRoot` and `runId`. Treat their current durable result—not prior prose or a status object copied into the prompt—as the phase input. Check `terminalStatus` before mutation. `finalized` is permanently terminal. A `failed` run is mutation-closed until an authorized caller invokes `mem_import_recover`, which rotates coordinator authority and the run authorization epoch while preserving verified durable stage artifacts and canonical transactions.

At exit, call the same typed reads again and verify the phase's output conditions. Do not claim a phase complete from worker prose. If a phase is interrupted, resume or restart only that phase and reconstruct again from typed reads. Earlier phase artifacts remain inputs; earlier coordinator sessions do not. Recovery keeps the same run ID and immutable semantic hashes, records failure/recovery lineage, invalidates every previously issued worker grant, and requires fresh assignments only for ledger-derived incomplete work.

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

Put recurring observations of a supported identity into one labeled, source-spanning `identity` cluster so its proposer emits one synthesized artifact; do not leave repeated Alice-like identities scattered through chapter clusters for a later grand reconciliation. Use labeled `coherent` clusters for scene, chapter, fact, or style shards where shared identity is not asserted. For a substantive multi-unit narrative, plan coherent source-spanning evidence for dedicated synopsis, ordered timeline, and chapter/scene-guide artifacts rather than assuming entity pages can substitute for narrative reconstruction. Inspect `things` candidates for plot-salient standalone objects—items whose unusual property, transfer, loss, use, or failure changes character action or plot direction (for example, the White Rabbit's watch)—and keep enough evidence together to propose a findable object artifact. Give every cluster a concise rationale. In every authored section body across every group and narrative surface, apply the exact-ID inline traversal contract from the skill: clear durable mentions use `[[artifact-id|reader-facing label]]` with natural aliases/possessives; omit pronouns, ambiguous nouns, self-links, existing links, URLs, code, and provenance quotes; keep `related` complementary and deduplicated; and make useful relationship/event traversal bidirectional when both artifacts exist.

A reconciliation set is a small atomic identity question across its named proposal artifacts or explicit existing-canon dependencies; it is not a second clustering pass, a candidate-accounting envelope, or a book-wide continuity set. Omit reconciliation sets entirely when identity-aware clusters already resolve a fresh import and no real cross-proposal/canonical ambiguity remains. Otherwise keep uncertain identities separate, name each cluster in at most one set, and design multiple disjoint sets that can be reconciled independently. Each set must remain mergeable as one immutable identity packet: at most 50 bound proposals, at most 62 total bound proposal artifacts, and no more than 12 synthesized changes after accounting for `create` decisions whose canonical ID differs from the provisional artifact ID. Because proposal artifact counts are not known until proposers finish, plan conservatively from candidate counts and expected artifacts; never put broad chapter/coherent clusters into one set merely because a character recurs across them. For a fresh distinct artifact, normally keep `create.canonicalId` equal to its stable provisional artifact ID; renaming every artifact creates unnecessary synthesized changes.

Deterministic validation checks exact candidate partitioning, references, hashes, and hard bounds—it never chooses identity or salience. Assign each proposer by exactly one `planHash` and `clusterId`; the service derives its unit/candidate scope. Launch proposer assignments in independent waves of at most four; after each wave, record terminal dispatches and verify effects before opening the next wave. After the required cluster proposals persist, launch up to four disjoint reconciliation sets in parallel using exactly `planHash` and `reconciliationSetId`; never pass `proposalHashes` for a planned reconciler because the service derives them. One set produces exactly one identity packet and cannot be split across submissions. Every assigned candidate receives exactly one proposal disposition. Reconcilers read immutable proposals directly; extraction packets are supporting evidence, not substitutes for proposals.

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

Dispatch one merger. For each intended transaction, call `mem_merge_requirements` with that transaction's exact proposal subset; do not use assignment-wide identity requirements for a smaller batch. Include its pending identity packets, same-batch upserts for listed creates, exact match hashes, and blocking conflicts. Prefer grouped `proposalAccepts` that copy unchanged proposal artifacts exactly, cover every artifact in every declared proposal, and use explicit `upsert` only for intentional synthesis. Copy `artifactContentHash` into read sets; use `null` only after observing an absent target. Call `mem_merge_validate` with the complete payload, fix every returned issue, and then call `mem_merge_commit` with the same semantics. Validation is read-only and advisory; commit atomically rechecks current state.

`mem_merge_commit` owns lease, fence, current-revision CAS, candidate-accounting carry-forward, and release. Never broaden `assignment.tools`, guess fences, or revoke a lease-owning worker before cleanup completes. On stale evidence, re-read only the affected canonical neighborhood.

**Exit outputs**

- Re-read `mem_import_work_status` and compact merge controls.
- Require `unconsumedProposalCount === 0`, `unaccountedCandidateCount === 0`, `blockingConflictCount === 0`, and a non-null canonical `contentHash` with positive `revision` when candidates exist.
- Require every canonical worker transaction to appear as one merge/repair effect with a completed exact-profile dispatch receipt in `mem_import_effect_inventory`. Typed status/inventory may idempotently rebuild a missing effect projection from a fully reconstructed, assignment-valid immutable transaction; any malformed chain, actor/scope mismatch, or dispatch gap blocks the phase.

A partial durable merge is resumable, not an immediate terminal failure. If a merger returns while proposals or candidates remain, and the host can preserve the exact merger profile/assignment/session, resume that same merger to commit only the remainder, record the latest cumulative dispatch evidence, and re-read the exit gates. If profile-preserving resume is unavailable but the run remains healthy, issue a fresh plan-scoped merger assignment: the service derives only currently unconsumed proposals and their relevant identity scope. `mem_import_fail` rejects a healthy partial merge unless the coordinator uses reason code `merge-recovery-unavailable`; use that code only when neither exact resume nor a fresh exact-profile merger can run. The coordinator never writes a complete canonical snapshot or invents dispositions for failed semantic work.

## Phases 4–7: review, repair, verification, finalization

Review is a fresh read-only checkpoint. Call `mem_import_work_status`, `mem_import_merge_state`, and `mem_import_quality_state`; dispatch only reviewers in `initial-shard` mode. Persist one version-2 packet (version-1 packets remain readable), reconcile findings, and stop. Never dispatch repairers or loop internally. An identity page that omits major cross-unit actions/state/relationships or falsely says available units were unavailable is a repair-level finding.

The parent owns `mem_import_review_policy_submit`. Policy may approve, defer, reject, split, or request a second opinion only for action IDs in the checkpoint. An approved campaign freezes the exact action IDs, baseline revision/hash, scope, creation permission, and budgets. Repair is a fresh coordinator phase: read `mem_import_quality_state` and use its durable `campaignId` to read the campaign before assigning workers, rather than guessing an ID, inspecting the filesystem, or relying on the launch envelope. Repair receives only this frozen checkpoint/action scope and runs one episode. It cannot widen budget or scope.

Verification is a fresh read-only phase. Its packet is bound to one campaign and judges exactly the approved action IDs; it cannot create ordinary actions. A partial, impossible, critical, budget-exhausted, or non-convergent result is explicit and returns control to the parent rather than starting a hidden loop. Deferred non-blocking findings remain visible debt and may finalize; unresolved repair/critical findings block. A current `repair` or `critical` finding/action is a finalization error unless a typed policy and verification artifact resolves it.

Finalization launches no semantic worker. Run `mem_check_run`, inspect `mem_import_quality_state`, acquire the coordinator lease only when readiness allows, finalize once, and release it. Re-read `mem_import_work_status` and require `terminalStatus: "finalized"` or `"finalized-with-deferred-findings"` on success. caller_report, when available, is lifecycle telemetry only: it cannot authorize policy, mutation, scope, identity, or budgets, is never in semantic assignment.tools, and is never persisted.

## Dispatch ledger for every phase

1. Issue a role assignment.
2. Pass its bootstrap and semantic `tools` array verbatim to the selected facility; launch no helper child.
3. If more independent assignments belong to the current bounded wave, launch the next semantic worker on the next tool-result turn; otherwise end the turn and wait at rest for push-delivered terminal completion. Do not do unrelated work between launches, poll, schedule an ordinary wake-up, or launch a wait/no-op/monitor child.
4. Require the exact semantic tool profile plus documented lifecycle controls. Verify active/denied tools and profile-preserving resume when the host exposes that evidence; record unavailable fields as unavailable.
5. Record only actually observed model, thinking, exact selected `hostAdapter`, running-child ID, sanitized session filename stem, and outcome with `mem_import_record_dispatch`. Set both `requestedTools` and `observedTools` to the exact semantic `assignment.tools`; do not include coordinator tools or documented lifecycle additions such as `caller_ping`, `caller_report`, and `subagent_done`. Verify lifecycle additions separately from host terminal profile evidence. A correctable dispatch-payload rejection is not a capability failure: correct it once, and call `mem_import_fail` only when exact-profile enforcement or required recovery is genuinely unavailable. Copy schema-v1 terminal `usage` and `usageByModel` when present, but never estimate metrics or infer them from prose. Adapter-specific post-facto retrieval is authoritative when configured; the persisted identity, not model prose, correlates the content-free sidecar.
6. Inspect the effect with `mem_import_effect_inventory` before dependent work. A durable effect cannot replace required dispatch evidence.

A failed, cancelled, missing, mismatched, broadened, or inaccurately recorded receipt invalidates the dispatch; retry fresh or stop. Treat a terminal host result as final even if its prose claims otherwise.

For an unplanned non-extractor retry, revoke the old assignment and issue a fresh task ID. For a plan-bound proposer or reconciler, a fresh retry may name `retriesTaskId` only after the prior assignment is revoked, expired, or has a recorded failed/cancelled dispatch and no semantic effect. An effective cluster/set cannot be assigned again. `supersedesTaskIds` remains extractor-only. Correct a malformed tool argument once, but do not retry or resume a reconciler after an atomic-scope error (`>50` proposals, `>62` proposal artifacts, or `>12` required synthesized changes): that error is structural for the immutable set. Do not attempt multiple identity packets, metadata batching, candidate batching, or invented grouped-decision fields; persist failure with the exact set/bounds instead.

## Scale and recovery

- Keep source reads, proposal reads, canonical inventories, and commits paginated/bounded.
- Keep one canonical merger active. Immutable packets permit restart without re-extraction or proposal replay.
- Earlier accepted transactions survive later interruption.
- Reconstruct from typed status/inventory/effect tools, never conversation memory or filesystem helpers.
- Stop fanout on repeated schema failures, provider failures, weak source coverage, or parent backlog.

## Facility-specific setup

Read only the selected facility's adapter reference for launch syntax, extension setup, workspace layout, model choices, and current-phase recovery. [pi-herdr-subagents](adapters/pi-herdr-subagents.md) is one example recipe, not a required facility.
