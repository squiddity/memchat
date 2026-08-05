# Mem-import weekly plan consolidation

> **Historical/non-product status:** This file is a preserved roadmap and decision record, not runtime authority or an installation contract. Its historical handoffs and plan references do not require their old commands, paths, or benchmarks to remain available. The controlled legacy cost A/B is waived, no new legacy run is required, and the [legacy cleanup feature handoff](2026-08-04-mem-import-legacy-cleanup-feature-handoff.md) replaces parity as cleanup input.

## Purpose

This index resolves overlap among the July 20–22 mem-import plans. It is a historical roadmap map, not a replacement for their detailed designs or current production guidance.

## One boundary in three layers

### 1. Installation acceptance

**Authority:** `skills/mem-import/references/acceptance.md` and `skills/mem-import/references/facility-recipes.md`.

The parent chooses an available subagent facility and asks only whether it has a good chance of supporting the planned import. It reuses a matching local/known recipe or runs one brief disposable launch, with at most one nested child and one harmless tool call when needed. Evidence is capability-oriented and may vary by extension.

Acceptance never requires a custom programmatic adapter, exhaustive role probes, a semantic pipeline, finalization, Alice, or quality measurement. The July 21 fixture-backed runner remains optional maintainer conformance.

### 2. Real import runtime

**Authority:** `skills/mem-import/SKILL.md`, its role/workflow references, and the still-relevant golden-path portions of [Mem-import Simplification](2026-07-20-mem-import-simplification.md).

After brief acceptance, the parent launches one corpus coordinator. Real workers remain assignment-bound and ledger-driven, using the strongest lifecycle/tool evidence the selected facility exposes. A cached recipe never replaces per-dispatch authorization or exact requested tool profiles.

### 3. Integration, quality, and efficiency evaluation

**Historical decision record:** [Efficiency and Legacy Parity](2026-07-21-001-fix-mem-import-efficiency-parity-plan.md). Its cost A/B is waived and no new legacy run is required; use the cleanup feature handoff for legacy retirement.

Deterministic tests cover cross-stage compatibility, authorization, concurrency, scale, reconstruction, checks, and finalization. Alice evaluations separately measure semantic quality, identity consolidation, coordinator behavior, transactions, duration, and token usage. Evaluation results do not create acceptance receipts.

## U-label disambiguation

Several plans use local U numbers; they are not one global sequence.

- **Acceptance-plan U4:** assignment-bound host dispatch.
- **Acceptance-plan U5:** independent one-production-tool-call probes.
- **Acceptance-plan U6:** receipts and guidance that exclude coordinator-driven acceptance.
- **Efficiency-plan U4:** phase-bounded coordinator sessions for real imports.
- **Older orchestration-plan U4:** legacy `world-import` cleanup and canonical compendia.

When discussing work, include the plan name rather than saying only “U4.”

## Current implementation state

Completed:

- extension-agnostic brief acceptance and local/known facility recipe guidance;
- optional tracked fixture pack, focused conformance runner, and Pi SDK maintainer adapter;
- conformance validation for call count, arguments, model/thinking, tool profile, durable effects, and sanitized receipts;
- terminal-state guards, no-op rejection, weighted limits, and bounded effect inventory;
- host-attested `pi-herdr-subagents` launch profiles, exact active/denied telemetry, and profile-preserving resume;
- active guidance separating brief facility acceptance, optional maintainer conformance, and corpus execution;
- artifact-led phase-bounded coordination across four fresh coordinator contexts with typed durable startup/exit gates;
- immutable extraction-snapshot-bound cluster plans with model-owned cross-unit identity/coherent shards, plan-derived worker scopes, reconciliation dependencies, and merge-readiness enforcement;
- exact named-profile launch stabilization, dispatch-gated effects, and one successful fresh four-phase tiny import;
- explicit deferral of assignment-scoped cwd closures while trusted/local grant-v1 evaluation continues, with model-visible replay and missing cwd/session binding accepted as residual risks;
- demand-driven proposer/merger evidence guidance plus all-role content-free read telemetry in bounded status and final-audit summaries;
- adapter-specific post-facto Pi/Herdr usage retrieval by sanitized child identity, latest-sequence resume deduplication, portable per-session audit snapshots, explicit sidecar failure classifications, and a final synchronous live-completion refresh;
- same-run failed-checkpoint recovery with coordinator-grant rotation, worker authorization epochs, preserved immutable semantic stages/transactions, remaining-only planned merger assignments, and explicit permanent finalization;
- the first full 13-unit Alice terminal success: revision 10, 28/28 proposal consumption, 183/183 candidate accounting, 155 artifacts, no conflicts/errors, and live recovery from a 26/28 partial merge.

Historical DeepSeek coordinator-driven attempts are rejected diagnostics, not acceptance evidence. See the [superseded hardening handoff](2026-07-22-mem-import-subagent-hardening-handoff.md).

## Cleanup completion

The legacy-surface cleanup is complete. Root-level owned Markdown projection, retained-source provenance links, inline traversal, canonical link lint, symlink refusal, and nested-directory migration refusal are active under `mem-import`; deleted runtime docs and import surfaces are not authority or compatibility shims. The controlled legacy cost A/B remains waived and no benchmark rerun is required.

The completed cleanup baseline passed `rm -rf dist && npm run build`, focused path/stage/projection/lint tests, `npm run test:cleanup`, `npm run test:mem-import`, `npm test`, `npm pack --dry-run`, and `git diff --check`.

## Remaining roadmap: post-cleanup quality

1. Let real imports accumulate small sanitized facility recipes; version-control only broadly useful examples.
2. Improve sidecar retention when useful for future mem-import measurements, without rerunning to re-prove basic completion.
3. Improve hyperlink traversal, narrative-surface classification, style citation density, provenance specificity, retrieval usefulness, and maintained-compendium update guidance.
4. Add stronger consistency fixtures and optional longitudinal quality evaluation outside installation acceptance.

## Historical new-session handoff snapshot (2026-07-28)

> This dated handoff is preserved for traceability and is not an active instruction. It predates the 2026-08-03 full-corpus milestone; do not rerun a legacy benchmark or treat its U8 gate as current product authority.

Start from pushed memchat commit `75e663e` on `feat/world-import-model-led-subagents-u0`, then inspect the uncommitted working tree before editing. The pushed commit implements reviewer-action enforcement, narrative/salient-object guidance, projection-aware pre-final checks, merger accounting guidance, tests, and the successful strong-model evaluation report at `docs/evaluations/2026-07-28-alice-three-chapter-review-enforced-rerun.md`.

### Validated before the latest DeepSeek probe

- Current `repair`/`critical` findings and actions block finalization. Once any review requests repair, a clean scoped post-repair review of the final revision is required.
- The successful Alice Chapters I–III run `mir-d292df080c1829dba050ccb9` finalized revision 2 with 56/56 candidates, 39 artifacts, a synopsis, combined source-order timeline/chapter guide, standalone White Rabbit watch, a clean current post-repair review, and 18/18 sidecar-backed usage records with no duplicate child IDs.
- `mem_check_run` emits the deterministic Markdown projection before checking it.
- Merger guidance requires exact set reconciliation against receipt `consumedProposalHashes` and profile-preserving recovery of partial commits.
- Build and the then-current 63-test mem-import suite passed.

### Uncommitted completion/preflight work

The working tree now also contains:

- one centralized Herdr completion contract appended to every generated mem-import coordinator and worker profile: put the informative result inside `subagent_done`, make it the final action, and send/call nothing afterward;
- dynamic launch guidance that explicitly forbids duplicating or paraphrasing that completion contract;
- host-enforced `.pi/agents/facility-preflight-coordinator.md` and `facility-preflight-reader.md` profiles for testing named-profile nested isolation;
- dispatch guidance clarifying that `requestedTools` and `observedTools` contain only semantic `assignment.tools`, never `caller_ping`, `subagent_done`, or coordinator tools; correct a payload error once and reserve `mem_import_fail` for a genuine unrecoverable capability/recovery failure;
- generated Herdr/pi-subagents profile updates and profile/acceptance tests. Build passed and the mem-import suite passed with 64 tests before the later dispatch clarification; rerun the full suite before committing.

The first generic DeepSeek Flash preflight was not representative: its unnamed nested child launched unrestricted with 59 tools. The new named-profile preflight passed exact host enforcement (`facility-preflight-reader`, `read` as the only content tool plus lifecycle tools), although the child still read a preflight Markdown file despite prose asking it to read nothing. Prefer host-enforced named profiles; treat behavioral prose as secondary.

### Latest DeepSeek Flash import evidence

Model: `openrouter/deepseek/deepseek-v4-flash`, high thinking, fixture `.memchat-agent-testing/fixtures/alice-chapters-1-3.epub`.

1. Run `mir-a041327830dbd9e4aa14af71` failed after extraction because its coordinator confused lifecycle tools with semantic dispatch arrays and prematurely called `mem_import_fail`. This motivated the dispatch clarification above.
2. Retry run `mir-a1cb08019d43638820f28f8a` completed extraction (49 candidates), proposal/reconciliation (16 proposals, 7 identity packets), and canonical merge (revision 1, 45 artifacts, 49/49 accounting). Review found and repaired two false cross-chapter provenance notes, advancing canonical state to revision 2.
3. The retry correctly ended terminally failed with `merge-effect-missing`. Immutable transaction revision 1 names worker `merger-001` and consumed all proposals, and its exact completed dispatch is present, but `stages/orchestration/effects/merger-001` is absent and effect inventory has no merge effect. The repair effect cannot replace the missing original merge effect. The final coordinator was explicitly steered not to finalize this invalid audit state.
4. All four DeepSeek phase-coordinator activity sidecars ended with `phase: done`, `latestEvent: subagent_done`, and no active agent/turn/tool. The final-action lifecycle contract therefore worked structurally. Result text still included meta-language such as “Let me now call `subagent_done`,” so phrasing is not yet clean even though the tool was last.
5. DeepSeek semantic quality remained weaker than the strong-model baseline: revision-1 review found false “chapter not extracted” notes; the missing synopsis and incomplete cross-chapter Alice page were only informational, so the requested narrative quality bar was not enforced strongly enough by that reviewer.

### Handoff implementation progress (2026-07-28)

> **Superseded historical snapshot:** The dated implementation checklist below is retained for traceability. It is not an active handoff; the cleanup and validation it describes are complete, and the cleanup completion section above is current.

Completed in the current uncommitted working tree:

1. New worker transactions bind deterministic semantic controls (actor task/role, assignment scope digest, proposals/identity packets, read set, stored operations, dispositions, conflict/repair scope, rationale, extraction and parent controls) into canonical `contentHash` through `transactionControlHash`. Runtime run IDs, timestamps, token hashes, and fences remain in the exact receipt/effect hash but are excluded from semantic hashing so fresh fixture materializations remain stable.
2. Typed status/effect/check/finalization paths validate every receipt from revision 1 without trusting checkpoints; require kind/directory/filename/revision/parent/snapshot/control/hash correctness; reject unknown/non-worker actors and orphan/duplicate effects; validate every actor assignment and exact scope before mutation; replay missing canonical-head and identity/conflict projections; and materialize exactly one idempotent transaction effect per owning standalone or compendium run. Canonical writes recheck lease/CAS under the canonical mutation lock at the final persistence boundary. Reconciliation compares the complete active owner, avoids canonical/owner-run lock inversion, preflights all missing effects, writes effects before identity projection, and uses checkpoints only after bounded exact filename/content/receipt binding. A live unrelated writer lease defers reconciliation.
3. Legacy transactions remain readable when their original exact-path effect exists. A pre-upgrade transaction with a missing unbound effect is explicitly manual-repair-required rather than guessed; the failed DeepSeek run remains valid failure evidence and is not rewritten.
4. Fault/restart tests cover interrupted merge and repair effects, missing canonical/identity projections, compendium-prior-run recovery, idempotency, malformed run/actor/role/assignment/lifecycle/hash/parent controls, wrong receipt directory, missing pre-checkpoint history, corrupted snapshots, orphan effects, missing dispatch, active writer synchronization, and blocked finalization.
5. The centralized Herdr completion contract now gives one direct-result example and forbids “I will call,” “Let me call,” and “Now calling” narration. Generated coordinator/worker profiles were regenerated; disposable named preflight profiles carry the same rule.
6. Reviewer authority, workflow, and generated static reviewer profiles now make explicitly requested missing/materially incomplete synopsis, timeline, chapter/scene guide, salient-object, and cross-unit identity coverage `repair`, not `info`.
7. `mem_import_record_session` is registered with a typed parent schema and routes to `MemImportCanonicalService.recordCoordinatorSession`; a source-contract test protects the registration. The currently running parent session loaded its catalog before that registration and cannot prove live exposure; verify it after restart.
8. Acceptance expected hashes were deliberately updated for the new deterministic transaction-control binding. The Luna medium recovery audit's lease, synchronization, projection-order, checkpoint, effect-run, and revoked-dispatch findings were addressed; the DeepSeek Flash profile audit found no blockers. `npm run build` passes, `npm run test:mem-import` passes 69/69, and `git diff --check` passes at this checkpoint.

The dated implementation checklist was completed and superseded by the full-corpus milestone and cleanup. Its historical commit/push and rerun instructions are not current actions; no legacy benchmark or new full-corpus proof is required.

## Handoff continuation (2026-07-31)

A fresh parent session confirmed `mem_import_record_session` is present in the live tool catalog. A Luna/high Alice Chapters I–III recovery run (`mir-ac60981d9be35f2c6b01c512`) completed extraction with 72 candidates, produced 9 plan-scoped proposals plus one identity packet, and merged revision 1 with 54 artifacts, 72/72 canonical accounting, exact dispatch/effect correspondence, and no blocking conflict. At the user's request, the run was then marked terminally failed before review/finalization so merger ergonomics could be improved; it is diagnostic evidence, not a successful evaluation.

The merger made four preventable rejected commit attempts before succeeding: omitted same-batch upserts for identity creates, omitted the plan-required identity packet, an upsert carrying the unsupported `proposalHash` field, and two mistyped proposal hashes. The resulting implementation work adds:

- `mem_merge_requirements`, which accepts one intended proposal subset and returns only that transaction's pending proposal/identity prerequisites, identity creates and matches, blocking conflicts, canonical controls, and batch limits without semantic inference;
- `mem_merge_validate`, which runs the shared scope/batch/read-set/identity/application path without acquiring the writer lease or mutating canonical state;
- grouped `proposalAccepts`, complete declared-proposal artifact coverage, strict lowercase SHA-256 checks, exact match read-set enforcement, and explicit rejection of control fields embedded in upserts;
- pre-validation transaction-reference calculation without artifact-blob writes, with persistence deferred until structural/provenance validation and final CAS succeed;
- merger role/profile guidance requiring requirements → validation → commit and exact receipt-set reconciliation;
- removal of mem-import-owned completion wording from named profiles and launch guidance, leaving auto-exit/manual completion behavior to the selected subagent facility.

The final fresh validation passes: `npm run test:mem-import` is 72/72, `npm run build` succeeds, and `git diff --check` is clean. The next semantic evaluation should start as a fresh run rather than resume the intentionally stopped run.

## Full-corpus milestone (2026-08-03)

Run `mir-9799774c5c67d6b78e186988` completed the current four-phase production workflow with Luna/high coordinators and workers. It initially retained four healthy canonical commits but was incorrectly terminalized at 26/28 proposals and 174/183 candidate accounting. The recovery implementation reactivated the same run, rotated authority, invalidated prior worker grants, preserved normalization/extraction/plan/proposal history, and assigned only the Alice/Gryphon remainder. Review and bounded repairs advanced revision 5 to final revision 10; final work status reports 28/28 proposals, 183/183 candidates, zero conflicts, and terminal `finalized`.

See [the full milestone report](../evaluations/2026-08-03-alice-full-mem-import-milestone.md). This completes the full-corpus execution/recovery milestone. The exact legacy cost comparison is now waived. Remaining evaluation work is mem-import quality refinement, including hyperlink traversal, narrative-surface classification, and provenance specificity; see the [legacy cleanup feature handoff](2026-08-04-mem-import-legacy-cleanup-feature-handoff.md).

## Documentation authority map

- `skills/mem-import/SKILL.md`: short role branch and corpus coordinator behavior.
- `skills/mem-import/references/parent-preflight.md`: parent-only acceptance check and coordinator launch.
- `skills/mem-import/references/acceptance.md`: brief capability probe and exclusions.
- `skills/mem-import/references/facility-recipes.md`: local cache and known recipe contract.
- `skills/mem-import/references/subagent-capabilities.md`: minimum facility capabilities.
- `skills/mem-import/references/adapters/*.md`: adapter mechanics only.
- `skills/mem-import/references/workflow.md`: real corpus coordinator decisions only.
- `docs/plans/2026-07-21-002-*`: optional multi-role conformance and runtime-safety decision history.
- `docs/plans/2026-07-21-001-*`: real-import optimization/evaluation roadmap.

Do not duplicate the acceptance sequence in top-level docs or role files; link to the authority instead.
