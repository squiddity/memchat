---
title: "Mem-import Efficiency and Legacy Parity - Plan"
type: fix
date: 2026-07-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: alice-import-observation
execution: code-and-eval
acceptance_plan: docs/plans/2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md
---

# Mem-import Efficiency and Legacy Parity - Plan

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Preserve mem-import's bounded authorization, provenance, resumability, and audit guarantees while removing quadratic context growth, repeated merge work, and semantic fragmentation relative to legacy world-import. |
| Primary users | Agents importing books or maintained series with budget workers under stronger supervision. |
| Authority | The finalized Alice mem-import run `mir-9b27945d9f1eb450cd8a2d0f`, legacy Alice run `world-output/alice-staged-quality-20260710-175231`, `docs/world-import.md`, `docs/plans/2026-07-20-mem-import-simplification.md`, session usage records, and model-visible mem-import tool contracts. |
| Execution profile | Tool response contraction, phased coordination, merge batching, identity-aware proposal planning, telemetry, and controlled Alice A/B evaluation. |
| Stop conditions | Stop before weakening provenance/accounting, moving semantic identity decisions into deterministic code, silently dropping candidates, or optimizing solely by imposing candidate/artifact count caps. |

---

## Executive Summary

The successful Alice mem-import run was much less efficient than legacy world-import:

- **105.88M processed tokens** and approximately **$7.50** for the corpus run, excluding acceptance and the supervising conversation;
- approximately **four hours** across the main run and finalization recovery;
- **51 model sessions**, including 44 semantic worker sessions and four coordinator/finalizer sessions;
- **181 extraction candidates**, **24 persisted proposals**, **25 canonical transactions**, and **158 canonical artifacts**.

The comparable legacy Alice run completed in approximately **86 minutes** using about **five staged model invocations**, with **129 candidates** and **85 artifacts**. Legacy sessions used `SessionManager.inMemory`, so exact legacy token totals were not persisted; the comparison is exact for duration, invocation count, candidate/artifact counts, and mem-import usage, but not for a legacy token ratio.

The dominant regression is not extraction or bounded proposal sharding. It is the merge protocol:

- merger workers processed **63.10M tokens (59.6%)**;
- coordinators/finalizers processed **31.96M tokens (30.2%)**;
- proposal workers processed only **4.24M tokens (4.0%)**;
- extraction and miscellaneous workers processed about **4.38M tokens (4.1%)**.

`mem_merge_commit` returns the complete cumulative canonical stage. By revision 25, one result was about 790 KB. Replaying cumulative snapshots across later turns creates approximately quadratic context growth. Repeated merger restarts then re-read proposals and canonical state. Semantic fragmentation compounds the problem: chapter-local proposal shards turn recurring entities into separate provisional artifacts, leaving a later merger/reconciler with excessive deduplication work.

The first implementation priority is therefore to make all mutation and state-control responses compact. Proposal multi-call submission is not currently justified: all 24 persisted Alice proposals succeeded at 5–9 candidates, and the one missing proposal effect was a prematurely terminated worker rather than payload clipping.

---

## Baseline Evidence

### Corpus and outputs

Both observed runs used the 13-unit Project Gutenberg Alice EPUB normalization shape.

| Metric | Legacy world-import | Mem-import |
|---|---:|---:|
| Normalized units | 13 | 13 |
| Extraction candidates | 129 | 181 |
| Canonical artifacts | 85 | 158 |
| Candidate-to-artifact ratio | 65.9% | 87.3% |
| Canonical transactions | One assembled merge stage | 25 bounded transactions |
| Model sessions/invocations | About 5 | 51 |
| Elapsed time | About 86 minutes | About 4 hours |
| Output tree size | 2.3 MB | 14 MB |
| Narrative surfaces | Synopsis, timeline, chapter guide | Missing; warned at final checks |
| Exact recorded processed tokens | Unavailable | 105.88M |
| Exact recorded cost | Unavailable | ~$7.50 |

Artifact count is evidence of fragmentation, not a target to minimize mechanically. The plan must improve identity consolidation and narrative usefulness without a hard artifact cap.

### Mem-import token use by phase

| Phase | Sessions | Processed tokens | Share | Logged cost |
|---|---:|---:|---:|---:|
| Coordinators/finalizers | 4 primary sessions | 31.96M | 30.2% | $2.72 |
| Merger workers | 10 | 63.10M | 59.6% | $3.94 |
| Proposer workers | 28 attempts | 4.24M | 4.0% | $0.34 |
| Extraction/helper sessions | 6 | 4.38M | 4.1% | $0.29 |
| Repairer | 1 | 1.55M | 1.5% | $0.15 |
| Reviewer | 1 | 0.40M | 0.4% | $0.04 |
| Reconciler | 1 | 0.24M | 0.2% | $0.02 |

Acceptance added about 1.87M processed tokens and $0.128, but is cacheable and was not a material contributor to corpus inefficiency.

### Model-visible tool traffic

Across the Alice run and bounded finalization continuations:

| Tool | Calls | Raw returned text | Maximum one result |
|---|---:|---:|---:|
| `mem_merge_commit` | 111 | 9.80 MB | 788 KB |
| `mem_proposal_read` | 163 | 5.78 MB | 73 KB |
| `mem_import_merge_state` | 6 | 3.92 MB | 790 KB |
| `mem_extraction_read_worker` | 53 | 1.08 MB | 77 KB |
| `mem_merge_apply_repair_batch` | 2 | 801 KB | 790 KB |

Only 24 of 111 merger commit calls created merger transactions. The other 87 calls failed:

- 57 model/tool-schema validation failures;
- 30 service-level read-set, identity-baseline, operation, or lease failures.

There were 61 proposal submit calls for 24 persisted proposals. Proposal retries were inefficient but remained a small fraction of total tokens; merge retries and cumulative response replay dominated.

### Semantic fragmentation

Legacy's global merge pass consolidated repeated observations into 85 artifacts and produced first-class narrative surfaces. Mem-import's 24 chapter-local proposals produced 158 artifacts, including chapter-specific and `provisional.*` variants of recurring entities. Only one reconciliation worker ran before 25 commits.

This indicates two separate issues:

1. candidate shards were transport-safe but not identity-aware;
2. the merge path mostly accepted proposal artifacts by reference instead of globally consolidating repeated entities.

---

## Problem Frame

### P1. Cumulative mutation responses cause quadratic context growth

`mem_merge_commit`, repair mutation, and coordinator merge-state reads expose complete canonical state. Every later model turn carries prior snapshots plus a larger new snapshot. The model does not need the complete stage after a successful write; it needs revision/hash controls, counts, consumed proposal identities, and explicit bounded reads for any artifact it will reconsider.

Legacy `write-artifact` returned a compact acknowledgement containing the artifact ID and count. Mem-import should preserve transactional semantics while restoring that response discipline.

### P2. Merger workers repeatedly rediscover durable state

Ten merger workers processed the 24 proposals. Restarts repeatedly paged proposal inventories, read proposal packets, read canonical neighborhoods, and retried commits. Twenty-five transactions referenced only 28 proposal hashes in total—an average of 1.12 proposal references per transaction.

The transaction model permits bounded safety, but current operation limits and prompts encourage one-proposal-at-a-time commits even when most operations are immutable accept-by-reference decisions.

### P3. Long-lived coordinators retain irrelevant lifecycle prose

The main coordinator processed 23.69M tokens. It retained extraction and proposal child summaries while later coordinating merge/finalization. Follow-up finalization coordinators added more context after workflow bugs. Some continuation coordinators also spawned helper subagents to inspect lifecycle records, work better owned by the supervising launcher.

The ledger already supports fresh resumption. Coordinator context should be phase-bounded instead of serving as the durable state store.

### P4. Proposal sharding is operationally safe but semantically local

Sharding by chapter and 5–9 candidates solved DeepSeek's atomic proposal transport limit. It did not solve identity. Recurring people and concepts appeared in multiple proposals and became multiple artifacts. This increases merge state, read-set collisions, stale identity baselines, provenance duplication, warnings, and final browsing noise.

Deterministic code may suggest clusters from group/title/aliases, but the model must own identity decisions.

### P5. Readiness and lifecycle failures become expensive late recovery

The observed run included lease misuse, stale worker waiting, hidden dispatch readiness diagnostics, a coverage counting bug, a missing revision-bound review, and one lifecycle outcome recorded from worker prose instead of authoritative host status. These defects caused multiple continuation coordinators and finalization passes.

Several fixes were made during the run, but efficiency evaluation must include a clean run on the corrected revision rather than treating recovery overhead as unavoidable protocol cost.

### P6. Acceptance orchestration is not yet safely host-bounded

The disposable preflight run `mir-fcb88e8ad52bf9e80da21243` exposed a blocking orchestration defect before the planned small Alice excerpt import. The coordinator had an explicit coordinator allowlist, but generic `subagent` access still allowed it to launch unassigned `hash-finder`, `proposal-list`, and `find-review` children with shell/filesystem tools rather than a live semantic assignment's exact `assignment.tools`. It raced reconciliation before proposal persistence, reused semantic task identities across retries, relied on worker prose and direct filesystem inspection to recover proposal hashes, and exercised a malformed-hash rejection instead of the required stale canonical read-set probe.

The run called `mem_import_fail` at 15:34:49 with status `failed`, then continued assigning workers and wrote three merge transactions. All three revisions had the same semantic content hash, demonstrating both post-terminal mutation and no-op transaction acceptance. The run never completed the repairer, post-repair review, checks, or successful finalization rungs. It processed approximately 1.2M reasoning tokens in the coordinator before termination. No acceptance receipt was written.

This is a hard gate: do not run another acceptance ladder or fresh corpus import until assignment-bound dispatch, compact coordinator effect discovery, terminal-state monotonicity, and no-op rejection are enforced and covered by tests.

The implementation authority for these runtime safeguards and the replacement of the coordinator-driven acceptance ladder with fixture-backed, one-production-tool-call role probes is [Mem-import Acceptance Simplification and Runtime Safety](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md). This efficiency plan retains the corpus performance and quality objectives; it does not require acceptance to execute an entire semantic pipeline.

**Progress:** commits `7068fee`, `e139c84`, `7175d9f`, and `19f4f99` implement sequential terminal guards, no-op rejection, tracked core-role fixtures, independent normalize/extractor/proposer/merger/reviewer materialization, bounded effect discovery, assignment-derived launch/receipt validation, and simplified active guidance. The linked plan tracks the remaining conditional reconciler/repairer probes, cross-process terminal-transition serialization, concrete host-adapter wiring, and fresh model-backed focused acceptance.

---

## Product Contract

### Requirements

- **R1. Compact writes:** Model-facing merge and repair mutations must never return complete canonical stages.
- **R2. Compact controls:** Coordinator status/state tools must return revision/hash/counts and bounded diagnostics, not complete artifact arrays.
- **R3. Explicit reads:** Models inspect canonical content only through paginated inventory and explicit artifact reads.
- **R4. Bounded batching:** A merger can accept many immutable proposal artifact references in one transaction without retranscribing artifact bodies.
- **R5. Semantic synthesis remains bounded:** Explicit synthesized/upserted artifact bodies retain a lower independent limit than lightweight accept references.
- **R6. Phase-bounded coordination:** Extraction, proposal/reconciliation, merge, and review/finalization can run in fresh coordinator invocations against the same durable run.
- **R7. Host lifecycle authority:** Launcher lifecycle evidence, not final worker prose, determines completed/failed/cancelled dispatch outcome.
- **R8. Identity-aware planning:** Before proposals or merge, recurring entity observations receive a model-owned cross-unit clustering/reconciliation opportunity.
- **R9. No silent coverage loss:** Efficiency changes may not drop candidates, weaken provenance, or replace explicit disposition accounting.
- **R10. Usage telemetry:** Final run records must expose sanitized per-role/model usage totals when the adapter can obtain them.
- **R11. Actionable errors:** Validation failures return stable codes/paths and concise correction guidance so workers do not regenerate unchanged oversized bodies.
- **R12. Quality parity:** Efficiency improvements must not regress lint, provenance integrity, candidate accounting, identity conflicts, narrative surfaces, or reviewer quality.
- **R13. Assignment-bound dispatch:** A coordinator may launch semantic children only from a live assignment, with host-enforced tools exactly equal to `assignment.tools` plus adapter lifecycle controls; generic helper children cannot broaden tools.
- **R14. Terminal-state monotonicity:** After `mem_import_fail` or terminal finalization, assignments, semantic submissions, reviews, and canonical mutations are rejected.
- **R15. No-op rejection:** A transaction that does not change semantic canonical state, candidate accounting, identity/conflict state, or review-relevant controls must not create a new revision.
- **R16. Compact effect discovery:** Coordinators can discover durable proposal/identity/review effect hashes and their authoritative task/dispatch status through bounded typed tools without filesystem helpers or worker prose.

### Scope boundaries

#### In scope

- Contracting model-visible merge, repair, and state responses.
- Separate lightweight acceptance-reference and heavyweight synthesis limits.
- Phase-specific coordinator invocation guidance and launcher support.
- Identity-aware candidate/proposal planning with model-owned decisions.
- Per-role/model token/cost telemetry.
- Alice A/B fixtures and token/quality budgets.

#### Deferred

- Multi-call proposal draft/finalize protocol. Reconsider only if 5–9-candidate shards still clip on a clean run.
- Fully deterministic scheduling of semantic clusters.
- Provider-specific prompt caching controls.
- Replacing ordinary subagents with a custom batch inference backend.

#### Outside scope

- Hard candidate or artifact count caps.
- Deterministic entity identity decisions.
- Removing immutable transaction history, authorization grants, provenance validation, or candidate accounting.
- Treating low cost alone as success when semantic quality or browseability regresses.

---

## Technical Design

### D1. Return compact transaction receipts

Keep `MemImportU2Service.commitWorkerBatch` internally returning `MergeState` if useful for tests/internal composition, but map the model-facing extension result to a compact receipt:

```json
{
  "revision": 25,
  "contentHash": "...",
  "parentContentHash": "...",
  "artifactCount": 158,
  "candidateDispositionCount": 181,
  "consumedProposalHashes": ["..."]
}
```

Apply the same rule to repair mutation tools. No model-facing successful mutation response should contain `stage.artifacts` or full `candidateDispositions`.

Add a serialized response-size regression test against a 1,000-artifact canonical fixture. The result should remain effectively constant-size, with a target below 10 KB.

### D2. Replace full coordinator state with controls

Change `mem_import_merge_state` into a controls/readiness response or add `mem_import_merge_controls` and remove the full-state tool from normal coordinator profiles. Return:

- revision and content hash;
- artifact and disposition counts;
- proposal consumption counts;
- candidate accounting counts;
- conflict counts;
- current review validity;
- no artifact bodies.

Use `mem_import_merge_inventory` and explicit artifact reads for bounded content.

### D3. Batch accept-by-reference operations

Split merge change limits by operation weight:

- lightweight `accept` references: target up to 50 per call;
- synthesized/upsert artifact bodies: retain a small limit such as 12;
- proposal hashes: enough to support the accepted references while remaining bounded.

The service resolves immutable proposal artifacts internally. For observed-absent fresh-world targets, it may derive a null read token. Existing-target updates and synthesized replacements still require explicit artifact read tokens.

A fresh-world merger should be able to consume several proposals per transaction without loading their complete canonical aftermath.

### D4. Use phase-specific coordinators

Recommended launcher sequence after acceptance:

1. **Extraction coordinator** — normalize, dispatch extractors, validate packet ledger, exit.
2. **Proposal/reconciliation coordinator** — inspect compact candidate inventory, plan identity-aware shards, dispatch proposers/reconcilers, exit.
3. **Merge coordinator** — dispatch one merger over immutable proposals and identity packets, verify work status, exit.
4. **Review/finalization coordinator** — review current revision, repair if selected, require a new review after mutation, check and finalize.

Each invocation receives the same coordinator authority transiently from the launcher. No authority is written to artifacts. Durable state, not conversation replay, is the handoff.

### D5. Add identity-aware shard planning

Use the existing compact candidate inventory (`unitId`, candidate ID, group, title) to create model-owned cluster plans before proposal dispatch:

- cluster recurring entities across units by supported identity;
- keep chapter/scene facts coherent where cross-unit identity is not useful;
- preserve every qualified candidate exactly once;
- persist the plan or its assignment ledger for resumability.

Deterministic helpers may normalize text and present possible matches, but cannot assert identity. Ambiguous clusters remain separate or go through reconciliation.

For a fresh corpus, complete cross-proposal identity reconciliation before canonical merge begins. Avoid identity proposals whose baselines become stale after early commits.

### D6. Make proposal/source reads demand-driven

Proposal workers should treat extraction payload and provenance as their primary evidence packet. Re-read source spans only for ambiguity, missing support, or materially richer claims. Do not read the full chapter by default after receiving a complete extraction packet.

Merger workers should not read extraction/source data when accepting an unchanged proposal artifact unless identity or synthesis requires it.

### D7. Persist usage telemetry

Extend launcher/run audit with sanitized aggregates:

- model and thinking setting;
- role and phase;
- session/turn count;
- fresh input, cache-read, cache-write, output, and reasoning tokens;
- total processed tokens and provider-reported cost when available.

Do not persist prompts, grants, credentials, hidden reasoning, or account identifiers. Mark unavailable fields explicitly rather than estimating them.

### D8. Preserve lifecycle/readiness discipline

The clean-run baseline includes fixes made during the observed run:

- normal mergers receive only `mem_merge_commit`, not manual lease tools;
- commit cleanup cannot strand a lease after concurrent revocation;
- absent read-set hashes may be omitted and normalize safely to null;
- coverage counts explicit represented dispositions;
- `mem_check_run` surfaces dispatch and identity readiness diagnostics;
- finalization packets retain flattened diagnostics;
- complete coordinator snapshot mutation is not model-visible;
- launcher lifecycle status is authoritative.

These changes must be present before measuring protocol efficiency again.

### D9. Enforce runtime safety and simplify acceptance

Follow [Mem-import Acceptance Simplification and Runtime Safety](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md) for the detailed design. In summary:

- dispatch semantic workers through an assignment-bound launcher surface derived from durable assignments;
- expose bounded authoritative effect inventories;
- require fresh retry task identities;
- make failed/finalized run state mutation-terminal;
- reject semantic no-op transactions;
- replace the free-running acceptance coordinator and full acceptance pipeline with independent fixture-backed probes that each invoke one normal production tool;
- keep the Alice excerpt as a separate semantic quality and efficiency evaluation corpus.

---

## Implementation Units

### U0. Block unsafe acceptance and corpus launch

- **Goal:** Close the runtime and host-dispatch defects found in preflight run `mir-fcb88e8ad52bf9e80da21243` before another model-backed run.
- **Implementation authority:** [Mem-import Acceptance Simplification and Runtime Safety](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md).
- **Work:** Implement its terminal-state guards, no-op rejection, consistent weighted limits, compact effect inventory, assignment-bound dispatch, tracked fixture materializer, and independent one-production-tool-call role probes.
- **Done signal:** The focused profile probes pass with authoritative dispatch/effect evidence; failed or finalized runs cannot mutate; no-op transactions create no revisions; no free-running acceptance coordinator or full semantic acceptance pipeline is required.
- **Blocks:** Any new acceptance receipt, the three-chapter Alice semantic evaluation, and U8 controlled A/B evaluation.

### U1. Contract merge and repair responses

- **Goal:** Remove cumulative canonical stages from mutation results.
- **Files:** `extensions/mem-import-tools.ts`, `src/mem-import/u2-service.ts`, `src/mem-import-tools.test.ts`.
- **Work:** Map merge/repair results to compact receipts. Add response-size tests at small and 1,000-artifact scale.
- **Done signal:** No model-facing successful mutation includes complete artifact/disposition arrays; response size remains bounded independent of corpus size.

### U2. Remove full canonical state from coordinator profiles

- **Goal:** Prevent accidental 800 KB state reads.
- **Files:** `extensions/mem-import-tools.ts`, `src/mem-import/u2-service.ts`, `skills/mem-import/references/helper-tools.md`, `skills/mem-import/references/workflow.md`.
- **Work:** Replace `mem_import_merge_state` with compact controls or remove it from normal profiles in favor of work status/inventory.
- **Done signal:** Coordinator can resume/finalize using controls and bounded inventory without receiving artifact bodies.

### U3. Add weighted merge batching

- **Goal:** Reduce 24 proposal transactions to a small bounded sequence.
- **Files:** `extensions/mem-import-tools.ts`, `src/mem-import/u2-service.ts`, merger role guidance, concurrency tests.
- **Work:** Increase lightweight accept-reference capacity while retaining small limits for synthesized bodies. Derive safe absent-target read tokens where appropriate.
- **Done signal:** A fixture with 24 Alice-sized proposals commits in no more than six transactions without a complete-state response.

### U4. Add phase-bounded coordinator launch contract

- **Goal:** Stop carrying extraction/proposal lifecycle prose into merge/finalization.
- **Files:** `skills/mem-import/SKILL.md`, `skills/mem-import/references/workflow.md`, Herdr adapter guidance, launcher integration/tests.
- **Work:** Define sanitized structured phase handoffs and fresh coordinator invocations sharing only durable run identity/authority.
- **Done signal:** A full import uses separate coordinator sessions for the four phases and resumes solely from typed status tools.

### U5. Add identity-aware proposal planning

- **Goal:** Consolidate recurring entities before canonical artifact creation.
- **Files:** coordinator/proposer/reconciler role guidance; optional bounded cluster-plan service/tool; evaluation fixtures.
- **Work:** Present compact cross-unit candidate title/group inventory, persist model-owned cluster decisions, and reconcile globally before merge.
- **Done signal:** Alice does not emit unresolved duplicate/provisional variants for central recurring entities, while every candidate remains accounted.

### U6. Add demand-driven evidence reads

- **Goal:** Avoid rereading full chapters and extraction packets without need.
- **Files:** proposer and merger role guidance; bounded read telemetry/evals.
- **Work:** Make source reopening conditional and record per-role read counts.
- **Done signal:** Proposers can complete from extraction evidence when sufficient; merge accept paths do not reopen source.

### U7. Persist role/model usage telemetry

- **Goal:** Make future legacy/mem-import comparisons exact and reproducible.
- **Files:** run audit types/services, adapter/launcher integration, docs/tests.
- **Work:** Aggregate sanitized host usage into schema-versioned run telemetry.
- **Done signal:** Final import-run audit reports per-role/model token and cost totals or explicit unavailability.

### U8. Run controlled Alice A/B evaluation

- **Goal:** Verify efficiency and quality after U1–U7.
- **Controls:** Same EPUB, skill revision, coordinator/worker models, thinking settings, acceptance profile, launcher behavior, and reviewer rubric.
- **Compare:** Current finalized baseline, compact-response mem-import, and a newly instrumented legacy run where practical.
- **Done signal:** Report exact token, duration, retry, transaction, artifact-identity, provenance, narrative-surface, and reviewer metrics.

---

## Verification Contract

### Deterministic gates

| Gate | Command | Done signal |
|---|---|---|
| Build | `npm run build` | TypeScript compiles. |
| Mem-import tests | `npm run test:mem-import` | Authorization, pagination, transactions, readiness, and finalization remain green. |
| Response-size test | Targeted mem-import test fixture | 1,000-artifact commit/repair/control responses remain below the bounded target and omit stages. |
| Batch transaction test | Targeted 24-proposal fixture | All proposals consumed in at most six transactions. |
| Reconstruction test | Existing transaction history tests | Compact responses do not alter immutable history or reconstruction hashes. |
| Coverage/provenance test | Existing checks | No accounting or provenance integrity regression. |
| Terminal-run guard test | Targeted mem-import failure fixture | After `mem_import_fail`, assignment and every semantic/canonical mutation surface reject without new effects or revisions. |
| Assignment-bound dispatch test | Herdr adapter acceptance fixture | Child tools equal the live assignment allowlist plus lifecycle controls; unassigned shell/helper launches cannot count as semantic dispatch. |
| No-op transaction test | Targeted merge fixture | Repeated same-content operations do not create a new revision or transaction receipt. |
| Coordinator effect inventory test | Large bounded fixture | Proposal/identity/review/effect hashes are discoverable without filesystem access and responses remain below 10 KB. |

### Live Alice gates

The next controlled Alice run should meet all correctness gates and target the following efficiency envelope:

- zero finalization errors;
- no blocking identity conflicts;
- all candidates accounted;
- a valid review bound to the final revision;
- no full-stage model-facing mutation/state response;
- merger processed tokens reduced from 63.10M to **below 15M** initially;
- total corpus processed tokens reduced from 105.88M to **below 35M** for the first compact-response milestone;
- no more than six merge transactions for 24 Alice-sized proposals, unless semantic synthesis justifies additional bounded commits;
- no missing synopsis/timeline/chapter-guide warnings;
- no central-character duplicate/provisional artifact family left unresolved;
- proposal shard size remains evidence-driven, with no hard semantic coverage cap.

The longer-term parity target is below 20M processed tokens without lowering reviewer quality or provenance coverage. Targets should be revised from measured clean-run evidence, not achieved by suppressing necessary work.

---

## Risks and Mitigations

- **Risk:** Compact responses hide useful mutation results.  
  **Mitigation:** Return revision/hash/counts/consumed hashes and preserve explicit bounded inventory/read tools.

- **Risk:** Larger accept batches exceed worker transport limits.  
  **Mitigation:** Accept references are tiny and resolved server-side; keep synthesized body limits separate and low.

- **Risk:** Title-based clustering falsely merges identities.  
  **Mitigation:** Text normalization only suggests candidates; a model-authored cluster/reconciliation decision remains required.

- **Risk:** Phase coordinators lose important context.  
  **Mitigation:** The durable ledger and typed status packets are the intended handoff. Add missing compact status fields rather than replaying prose.

- **Risk:** Fewer artifacts reduce retrieval coverage.  
  **Mitigation:** Do not optimize to an artifact count. Evaluate duplicate identity, standalone usefulness, narrative surfaces, provenance, and candidate accounting together.

- **Risk:** Token targets encourage dropped candidates.  
  **Mitigation:** Candidate accounting and provenance remain hard finalization gates; efficiency targets are subordinate to correctness.

---

## Definition of Done

- Model-facing merge, repair, and coordinator-control responses are constant-size and do not expose complete canonical stages.
- Merge accept-by-reference operations consume several proposals per bounded transaction.
- Coordinator contexts are phase-bounded and resume from durable typed state.
- Cross-unit recurring entities receive model-owned identity-aware proposal/reconciliation treatment before merge.
- Usage telemetry is persisted by role and model.
- A controlled Alice run finalizes cleanly below the first efficiency target while retaining or improving provenance and semantic review quality.
- Multi-call proposal submission remains deferred unless a clean bounded-shard run supplies direct evidence that it is needed.
