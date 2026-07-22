---
title: "Mem-import Acceptance Simplification and Runtime Safety - Plan"
type: fix
date: 2026-07-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-in-progress
product_contract_source: failed-mem-import-acceptance-run
execution: code-and-eval
related_plan: docs/plans/2026-07-21-001-fix-mem-import-efficiency-parity-plan.md
---

# Mem-import Acceptance Simplification and Runtime Safety - Plan

> **Canonical acceptance decision record.** Installation acceptance is harness-owned, independently materialized, and limited to one specified production-tool call per semantic probe. No requested corpus coordinator runs probes or continues from a probe into an import. Host catalog/resume conformance is disposable and separate from semantic stage progression.

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Replace the model-coordinated installation acceptance pipeline with independent fixture-backed production-tool probes while closing the runtime authorization and transaction defects exposed by the failed acceptance run. |
| Primary users | Operators installing or changing a mem-import adapter/profile, and developers changing mem-import tools, schemas, authorization, or stage formats. |
| Authority | Failed run `mir-fcb88e8ad52bf9e80da21243`, the current installation acceptance ladder, the mem-import durable ledger contract, and the efficiency/parity plan linked above. |
| Execution profile | Production safety fixes, tracked semantic fixtures, deterministic fixture materialization, one production-tool call per role probe, deterministic integration coverage, and a separate semantic evaluation corpus. |
| Stop conditions | Stop before weakening per-run authorization, provenance, candidate accounting, dispatch correlation, transaction reconstruction, or finalization checks; do not replace production tools with acceptance-only wrappers. |

---

## Executive Summary

The failed acceptance run should have been a small proof that the selected model/adapter could see and call the assigned mem-import tools. Instead, acceptance reproduced most of the import pipeline under a long-lived coordinator. That coordinator launched unassigned helper children, raced stage dependencies, reused task identities, depended on worker prose and filesystem inspection for effect hashes, mutated after terminal failure, and created same-content revisions.

The response is twofold:

1. fix the production defects that acceptance exposed: assignment-bound dispatch, terminal-state monotonicity, no-op rejection, compact effect discovery, fresh-task retry enforcement, and consistent weighted merge limits;
2. simplify installation acceptance into independent probes. Each probe starts from version-controlled semantic stage data, creates fresh runtime authority, dispatches one assigned child with the exact role allowlist, and requires exactly one normal production-tool call.

Acceptance will evaluate tool transport, schema routing, authorization, persistence, lifecycle identity, and allowlist enforcement. It will not evaluate whether a coordinator model can plan an entire import. Pipeline compatibility remains covered by deterministic integration tests. Semantic quality and coordinator efficiency remain covered by the three-chapter Alice evaluation corpus, outside installation acceptance.

---

## Implementation Progress

### Completed on 2026-07-21

| Area | Status | Evidence |
|---|---|---|
| Compact merge flow prerequisite | Complete | `dd104f1` adds compact merge/repair receipts, compact merge controls, weighted accept batching, and this acceptance redesign plan. |
| Terminal mutation safety | Complete for sequential authorization paths | `7068fee` adds authoritative run-root terminal state, coordinator/worker mutation guards, successful-finalization terminal state, explicit-failure terminal state, no-op transaction rejection, and consistent lower-level weighted limits. |
| Tracked fixture pack | Complete for core probes | `e139c84` adds `fixtures/mem-import/acceptance/v1/` with hashed source, extraction/proposal/review semantics, target calls, and expected effects. |
| Independent materialization | Complete for core probes | `e139c84` adds fresh-root normalize, extractor, proposer, merger, and reviewer materialization through production services. |
| Effect discovery | Complete | `7175d9f` adds bounded `mem_import_effect_inventory`, normalizing extraction and ordinary worker effect records without exposing grants or artifact paths. |
| Launch and receipt contract | Complete for library/adapter integration | `7175d9f` adds assignment-derived one-call launch requests, exact observed-tool and durable-dispatch validation, profile fingerprinting, XDG receipt paths, and credential-free partial/accepted receipts. |
| Active skill guidance | Complete for core probes | `19f4f99` removes the acceptance coordinator/full-pipeline instructions and documents independent production-tool probes plus separate Alice evaluation. |
| Verification | Passing | `npm run build`, `npm run test:mem-import` (**46/46**), and `git diff --check` passed on 2026-07-22. |
| Conditional role fixtures | Complete | Tracked reconciler and repairer semantics, independent materialization, one-call execution, exact semantic effect hashes, altered-effect rejection, and receipt coverage are implemented. |
| Concurrent terminal safety | Complete | A shared cross-process run-mutation critical section serializes assignments, submissions, reviews, leases, canonical writes, failure, and successful finalization; heartbeat, live-owner protection, crashed-owner recovery, and cleanup-safe lease release are covered. |
| Concrete host adapter | Complete | The assignment-bound Pi SDK adapter uses in-memory child sessions, exact active tools, native session identity, actual model/thinking observation, tool-call argument hashing, and production effect validation. |
| Focused model acceptance | Accepted | `openai-codex/gpt-5.4` with `low` thinking passed normalize, extractor, proposer, reconciler, merger, reviewer, and repairer probes under fingerprint `c976cc1103e7315548ebbd4f53a5f89917f15859d096bf2eb0f79ea8e7cb2600`. |

### Remaining work

1. Run the three-chapter Alice semantic/efficiency evaluation separately. It is not a profile acceptance gate and should measure identity consolidation, narrative surfaces, transaction count, duration, and token use.

### Implementation-unit status

- **U0:** complete for all tracked core and conditional role fixtures and independent materialization.
- **U1:** complete for sequential guards and cross-process mutation serialization.
- **U2:** complete, including semantic no-op rejection and weighted-limit alignment.
- **U3:** complete with bounded coordinator effect inventory.
- **U4:** complete for the assignment-bound Pi SDK host adapter, exact observed profile validation, and lifecycle evidence.
- **U5:** complete for normalize, extractor, proposer, reconciler, merger, reviewer, and repairer probes.
- **U6:** complete for skill, acceptance reference, helper-tool, workflow, Pi/Herdr guidance, and Pi SDK adapter guidance.
- **U7:** deterministic integration/pressure suites and focused model-backed acceptance are green; the separate Alice semantic evaluation remains pending.

---

## Evidence and Problem Frame

### P1. Acceptance currently tests too much at once

The current ladder asks one model-backed coordinator to normalize, assign, dispatch, inspect, sequence, merge, review, check, and finalize. A failure can therefore reflect planning, timing, semantic generation, effect discovery, host lifecycle handling, or a production invariant rather than the intended installation question: can this exact adapter/profile invoke its assigned production tools correctly?

### P2. Independent stage probes need durable tracked inputs

The existing disposable testing tree is ignored by Git. The generated three-chapter Alice EPUB is also ignored and depends on host `zip`/`unzip`. Installation acceptance needs tiny, reviewable, versioned semantic inputs and expected effects that remain stable across machines.

### P3. Simplifying acceptance does not remove production defects

The failed run demonstrated production problems that deterministic services must reject regardless of coordinator behavior:

- failed runs still accepted new assignments and canonical mutations;
- same-content writes created new revisions;
- coordinator-recorded dispatch correlation did not prevent unassigned helper launches;
- retry task identity and effect ownership were not sufficiently constrained;
- proposal, identity, review, and dispatch effect hashes were not available through compact coordinator tools;
- weighted merge limits were not enforced consistently through every lower-level mutation path.

These are runtime correctness requirements, not acceptance-only checks.

### P4. Semantic evaluation and installation acceptance have different purposes

A three-chapter Alice import is useful for identity consolidation, narrative quality, transaction efficiency, and token measurement. It is unnecessarily large and nondeterministic for proving tool-call transport. Combining these purposes makes profile acceptance slow, costly, and difficult to diagnose.

---

## Product Contract

### Runtime requirements

- **R1. Assignment-bound dispatch:** Semantic children are launched only from a live assignment. The host derives task identity, bootstrap, role, and exact tool allowlist from that assignment rather than accepting arbitrary coordinator-selected tools.
- **R2. Terminal monotonicity:** After `mem_import_fail` or successful terminal finalization, new assignments, worker submissions, reviews, leases, merge/repair mutations, and further finalization attempts are rejected without durable effects.
- **R3. No-op rejection:** A canonical transaction that changes no semantic artifacts, candidate accounting, identity/conflict state, or review-relevant controls does not create a transaction or revision.
- **R4. Fresh retry identity:** A revoked, failed, cancelled, expired, or completed semantic task is never reused for a new effective attempt. A retry receives a fresh task ID and explicit lineage.
- **R5. Compact effect discovery:** Coordinators can page authoritative assignment, dispatch, proposal, identity, review, and mutation effect summaries, including immutable hashes and terminal outcomes, without filesystem access or worker prose.
- **R6. Consistent weighted limits:** Every model-facing and lower-level merge path enforces the same independent limits for proposal hashes, lightweight accepts, synthesized changes, and total operations.
- **R7. Existing safety remains:** Provenance derivation, candidate accounting, bounded reads, immutable packets, fencing/CAS, reconstruction, review binding, and finalization readiness remain mandatory.

### Acceptance requirements

- **R8. One target call per probe:** Each model-backed role probe requires exactly one target production-tool call against independently seeded state.
- **R9. Production tools only:** Probes call the same registered TypeBox tool and service route used by corpus imports. No acceptance-only semantic mutation wrapper is permitted.
- **R10. Exact host profiles:** The harness verifies the exact adapter profile used by each probe. Initial/resumed host telemetry must be `verified`/`exact`; active tools equal the assignment allowlist plus lifecycle controls, deny telemetry matches, and shell, generic mutation, unrelated tools, and unrestricted helpers are absent. Coordinator catalog/resume conformance is a separate disposable host-profile check, not a semantic pipeline.
- **R11. Fixture-backed expectations:** Probe arguments and expected durable effects are derived from tracked, schema-versioned semantic fixtures.
- **R12. Runtime authority is ephemeral:** Grants, output roots, task/run IDs, timestamps, host IDs, and credentials are generated at materialization time and never committed to fixtures.
- **R13. Independent diagnosis:** Extractor, proposer, merger, reviewer, reconciler, and repairer probes can run independently and report role-specific failure.
- **R14. Cached fingerprinting:** Acceptance receipts include protocol/tool-schema version, installed extension/runtime identity, explicit extension-entry hashes, host-attested coordinator/worker active and denied tool hashes, resume-preservation result, model/thinking, fixture version/hash, and package/source revision.
- **R15. Conditional roles:** Reconciler and repairer probes are required only before the exact profile is used for those roles. Core import roles remain mandatory.

### Scope boundaries

#### In scope

- Runtime terminal guards and authorization checks.
- No-op transaction detection.
- Production two-level subagent launch integration for real imports, tested independently from installation acceptance.
- Bounded coordinator effect inventory.
- Retry/task/effect ownership rules.
- Consistent weighted batch enforcement.
- Tracked fixture format and materializer.
- Independent role tool-call probes and acceptance receipts.
- Deterministic tiny full-path integration coverage.
- Reclassification of the Alice excerpt as semantic integration/evaluation data.

#### Out of scope

- Using a free-running coordinator as installation acceptance.
- Evaluating prose quality, identity judgment, synopsis quality, or corpus efficiency in profile acceptance.
- Removing the model from real extraction, proposal, reconciliation, merge, review, or repair decisions.
- Treating model-visible allowlists as an operating-system sandbox.
- Weakening normal per-run dispatch receipts because a profile has cached acceptance.

---

## Technical Design

### D1. Track semantic fixture packs

Add a repository-controlled fixture pack:

```text
fixtures/mem-import/acceptance/v1/
  fixture.json
  input/
    scene.html
  normalized/
    manifest.json
    unit.json
  extraction/
    packet.json
  proposals/
    proposal.json
    identity.json
  canonical/
    baseline.json
  reviews/
    review.json
  calls/
    normalize.json
    extraction-submit.json
    proposal-submit.json
    identity-submit.json
    merge-commit.json
    review-submit.json
    repair-apply.json
  expected/
    effects.json
    controls.json
    checks.json
```

Fixtures contain semantic source, stages, tool argument templates, and expected semantic effects. They omit runtime control data. Use disjoint candidates where multiple proposals are involved so accounting behavior is realistic.

`fixture.json` records:

- fixture schema and version;
- source and semantic stage content hashes;
- supported probe names;
- placeholder declarations;
- expected protocol/tool-schema compatibility.

### D2. Materialize each probe independently

Implement a deterministic fixture materializer that:

1. creates a fresh temporary output root and run;
2. copies or submits only the semantic prerequisites for one probe through trusted test/setup services;
3. creates the required live assignment;
4. substitutes fresh run/task/authority, content hashes, read tokens, revision controls, and lease fence into the tracked call template;
5. returns the exact child bootstrap, `assignment.tools`, target tool name, call body, and expected durable effect;
6. cleans up or preserves the disposable root according to test/diagnostic mode.

The materializer does not make semantic decisions. It only reproduces a known stage boundary and resolves runtime identifiers.

### D3. Prove the exact host adapter profile

The acceptance harness—not the requested corpus coordinator—owns launch and evidence collection. For every independently materialized probe, the host adapter must:

- expose a correlatable native identity and terminal outcome;
- launch from the live assignment rather than arbitrary model-selected tools;
- set active worker tools exactly to `assignment.tools` plus lifecycle controls;
- reject stale, revoked, terminal, or mismatched assignments;
- report verified/exact active and denied tool telemetry;
- record dispatch evidence from host events rather than child prose.

Coordinator catalog and resume preservation use separate disposable host-profile checks. They do not schedule semantic roles or continue into a corpus. The semantic worker prompt remains mechanical: call the named production tool exactly once with the supplied body, then stop.

### D4. Define the probe matrix

| Probe | Seeded semantic state | Target production tool | Expected evidence |
|---|---|---|---|
| Normalize | Tiny tracked HTML source | `mem_import_normalize` | Harness-observed coordinator-owned tool route is exact; normalized semantic units and anchors match tracked expectation. |
| Extractor | Normalized two-block unit | `mem_extraction_submit` | One immutable packet, derived quotes, exact task/effect ownership, completed dispatch. |
| Proposer | Accepted extraction packet | `mem_proposal_submit` | One immutable proposal and complete assigned candidate accounting. |
| Merger | Accepted proposal and canonical baseline | `mem_merge_commit` | Compact receipt, new revision, consumed proposal, carried dispositions, completed dispatch. |
| Reviewer | Canonical revision | `mem_review_submit` | Immutable revision/hash-bound review with bounded read set. |
| Reconciler, conditional | Two proposals and canonical alternatives | `mem_identity_submit` | Immutable identity decisions and any declared blocking conflict. |
| Repairer, conditional | Review checkpoint/action and parent-preissued lease | `mem_merge_apply_repair_batch` | Scoped compact repair receipt; unrelated actions remain unauthorized. |

Negative schema, stale-token, pagination, reconstruction, no-op, and finalization cases remain deterministic tests rather than additional model turns.

### D5. Persist bounded acceptance receipts

Persist one sanitized receipt per profile fingerprint under the configured acceptance state root. Each probe entry records:

- role/probe and fixture hash;
- assigned and observed tool hashes;
- sanitized host/runtime identity;
- task/effect identifiers and immutable effect hash;
- terminal outcome and concise diagnostic;
- completion time and optional expiration.

The parent validates durable effects before marking a probe accepted. Worker prose is not evidence. Conditional role coverage remains explicit in the receipt.

### D6. Keep deterministic pipeline coverage

Retain one tiny scripted integration test:

```text
normalize → extract → propose → merge → review → checks → finalize
```

Use fixture-backed semantic effects and direct deterministic setup/validation. This test checks cross-stage format compatibility and finalization without paying for model planning or host orchestration.

Keep pressure tests separate for:

- 500 units / 5,000 candidates / 1,000 artifacts;
- 24 Alice-sized proposals under weighted batching;
- transaction interruption/reconstruction;
- sequential compendium works.

### D7. Separate Alice semantic evaluation

Move the three-chapter Alice excerpt out of installation acceptance terminology. If retained, place its reproducible source or generated artifact under an explicitly tracked integration/evaluation fixture location, or deterministically derive it from a tracked repository input.

Use it only for periodic or release evaluation of:

- coordinator phase behavior;
- semantic extraction and identity consolidation;
- narrative surfaces and reviewer quality;
- merge transaction count and token use;
- compact response effectiveness.

Its outcome does not create or invalidate an installation profile acceptance receipt.

### D8. Enforce terminal state centrally

Add a shared run-state guard used by coordinator authorization, worker authorization, assignment creation, submissions, reviews, lease acquisition, canonical mutation, repair, and finalization. Tests must prove a failed or finalized run cannot gain any new assignment, effect, lease, transaction, or revision.

Read-only status and audit inspection remain available after terminal state.

### D9. Reject semantic no-ops before persistence

Before writing transaction history:

1. materialize the proposed semantic canonical state and accounting/identity/conflict controls;
2. compare its semantic hash and relevant control hashes with current state;
3. reject a true no-op with a stable actionable error;
4. do not increment revision, invalidate reviews, create effects, or consume proposals unless the accepted operation makes a meaningful durable change.

A conflict-only or accounting-only change is not a no-op when it changes durable canonical controls.

### D10. Add compact effect inventory

Expose cursor-bounded coordinator summaries keyed by task and role. Include assignment status, dispatch outcome, exact observed-tool match, effect kind/hash, proposal/identity/review hash where applicable, merge revision/transaction ID where applicable, and retry lineage. Do not return packet bodies, grants, prompts, or filesystem paths.

Use this inventory in real corpus coordination as well as acceptance validation.

---

## Implementation Units

### U0. Add tracked semantic fixtures and materializer

**Status:** Complete on 2026-07-22 for all seven role probes.

- Add `fixtures/mem-import/acceptance/v1/` with tiny source and stage-boundary packets.
- Define fixture schema, placeholders, hashes, and expected effects.
- Add deterministic materialization into fresh temporary runs.
- Ensure fixtures contain no grants, machine paths, host IDs, or timestamps.

**Done signal:** Every role probe can be prepared independently from tracked data, and repeated materialization produces equivalent semantic state.

### U1. Enforce terminal monotonicity

**Status:** Complete on 2026-07-22, including cross-process serialization and post-terminal/revoked/expired lease cleanup.

- Centralize terminal-state reads and authorization rejection.
- Guard assignments, submissions, reviews, leases, merges, repairs, failure/finalization transitions, and semantic retries.
- Preserve read-only audit/status access.

**Done signal:** After failure or finalization, every semantic/mutation surface rejects and filesystem/ledger comparison shows no new effect or revision.

### U2. Reject no-op transactions and align weighted limits

- Detect semantic/control no-ops before transaction persistence.
- Enforce 50 proposal hashes, 50 accepts, 12 synthesized changes, and 62 total changes consistently through model-facing and lower-level paths.
- Retain the compact receipt and merge-control work from the efficiency/parity plan.

**Done signal:** True no-ops create no revision; accounting/conflict-only changes remain possible; all boundary and overflow cases agree across service and extension paths.

### U3. Add bounded coordinator effect discovery

- Add paginated assignment/dispatch/effect summaries.
- Correlate task, role, outcome, observed tools, immutable hashes, and retry lineage.
- Keep responses below the bounded size target.

**Done signal:** A coordinator or acceptance validator can discover every required effect hash without worker prose, shell, or filesystem reads.

### U4. Add assignment-bound host dispatch

**Status:** Complete on 2026-07-22 for the Pi SDK assignment-bound adapter.

- Use the installed subagent surface with a coordinator that consumes live assignments rather than arbitrary child tools.
- Derive bootstrap and allowlist from durable assignment state.
- Record authoritative host lifecycle evidence.
- Reject stale/revoked/terminal assignments and task reuse.

**Done signal:** The acceptance host adapter and real corpus coordinator cannot make an unassigned helper child count as semantic dispatch, and observed tools must equal the assignment profile.

### U5. Implement independent production-tool probes

**Status:** Complete on 2026-07-22 for core and conditional roles; live seven-role acceptance passed.

- Implement core normalize, extractor, proposer, merger, and reviewer probes. Verify allowlists as host evidence on every semantic probe rather than as a standalone probe.
- Implement conditional reconciler and repairer probes.
- Require exactly one target production-tool call per semantic child.
- Validate durable effects and write per-probe acceptance results.

**Done signal:** Each probe can pass or fail independently with one attributable target call and concise diagnostics.

### U6. Simplify acceptance receipts and guidance

- Update `skills/mem-import/references/acceptance.md` into the independent-probe contract.
- Update `skills/mem-import/SKILL.md` and adapter guidance to remove the acceptance coordinator pipeline.
- Version the acceptance fingerprint and invalidate prior incompatible receipts.
- Keep per-run dispatch and authorization checks mandatory after cached acceptance.

**Done signal:** The parent/harness completes independent one-call probes and separate verified/exact host-profile/resume checks before launching any requested corpus coordinator. No acceptance child continues into another probe or an import.

### U7. Retain deterministic integration and separate Alice evaluation

- Add one fixture-backed deterministic full-path test.
- Keep scale/recovery tests deterministic.
- Reclassify the three-chapter Alice excerpt and npm script as integration/evaluation support, not acceptance.
- Document when the Alice evaluation runs and which quality/efficiency metrics it measures.

**Done signal:** Cross-stage compatibility remains covered without model orchestration, while Alice remains available for explicit semantic evaluation.

---

## Verification Contract

### Deterministic gates

| Gate | Done signal |
|---|---|
| Fixture integrity | Tracked hashes match; fixtures contain no authority, host, timestamp, or machine-path data. |
| Repeated materialization | Two fresh roots produce equivalent semantic prerequisites and expected call bodies after runtime placeholders are excluded. |
| Terminal failure guard | After `mem_import_fail`, assignment, extraction/proposal/identity/review submission, lease, merge, repair, and finalization reject with no new effects. |
| Finalized guard | The same mutation surfaces reject after successful finalization. |
| No-op transaction | Same-state accept/upsert creates no transaction or revision; meaningful accounting/conflict changes still commit. |
| Weighted limits | 50 accepts pass and 51 fail; 12 synthesized changes pass and 13 fail; 50+12 mixed passes; 51 proposal hashes fail through every path. |
| Compact mutation/control | Merge, repair, and controls omit complete stages and remain below 10 KB with 1,000 artifacts. |
| Effect inventory | Large paginated effect data remains bounded and exposes authoritative task/effect correlation. |
| Retry identity | Revoked/failed attempts require a fresh task ID and cannot create a second effective effect. |
| Deterministic integration | Tiny fixture completes normalize through finalization with exact accounting and reconstructable hashes. |
| Existing regression suite | `npm run build`, `npm run test:mem-import`, and relevant world-import tests pass. |

### Model-backed profile gates

For each required role:

- the child is launched from a live assignment;
- observed non-lifecycle tools exactly equal `assignment.tools`;
- forbidden shell/generic mutation/coordinator tools are absent;
- exactly one target production-tool call is attempted;
- the expected durable effect is present and hash-valid;
- host lifecycle outcome and opaque child identity are authoritative;
- response and diagnostics remain bounded;
- no dependent role or semantic pipeline is launched.

### Semantic evaluation gate

The Alice excerpt is run only when explicitly requested by release/evaluation policy. It reports quality, identity, narrative, transaction, duration, and usage metrics but does not determine installation acceptance.

---

## Migration and Ordering

1. Land fixture schema/materializer and deterministic tests first.
2. Add terminal guards and no-op rejection before another model-backed acceptance or corpus run.
3. Align weighted limits and retain compact receipt/control changes from the efficiency plan.
4. Add compact effect inventory.
5. Implement assignment-bound host dispatch.
6. Add independent model-backed probes and new receipt fingerprint version.
7. Replace acceptance ladder guidance and invalidate incompatible old receipts.
8. Run the new focused profile acceptance.
9. Run the Alice semantic evaluation separately only after the focused acceptance and deterministic gates pass.

Do not rerun the old coordinator-driven acceptance ladder during migration.

---

## Risks and Mitigations

- **Risk:** Independently seeded probes hide incompatible cross-stage formats.  
  **Mitigation:** Keep the deterministic full-path integration test using the same tracked semantic fixtures.

- **Risk:** Exact call bodies make the probe too easy.  
  **Mitigation:** That is intentional: installation acceptance measures tool transport/schema/authorization, not semantic creativity. Semantic behavior remains an explicit evaluation layer.

- **Risk:** An acceptance wrapper passes while production routing is broken.  
  **Mitigation:** Every child calls the registered production tool; the harness only materializes prerequisites and validates effects.

- **Risk:** Simplification leaves corpus coordinators able to launch arbitrary children.  
  **Mitigation:** Assignment-bound dispatch is a production prerequisite, not merely a probe behavior.

- **Risk:** Fixture snapshots become stale after schema changes.  
  **Mitigation:** Version fixture schema and include fixture/tool/protocol hashes in the acceptance fingerprint.

- **Risk:** Conditional roles are used without acceptance.  
  **Mitigation:** The parent checks required topology/role coverage before starting the corpus coordinator and runs the missing probe first.

- **Risk:** Terminal guards block legitimate inspection.  
  **Mitigation:** Block semantic writes and new assignments while retaining bounded read-only status/audit tools.

---

## Definition of Done

- Installation acceptance consists of independent fixture-backed role probes rather than a model-coordinated pipeline.
- Each semantic probe launches from a live assignment and makes exactly one normal production-tool call.
- Tiny semantic fixtures and expected effects are version-controlled and runtime credentials/control identifiers are not.
- Failed and finalized runs are mutation-terminal.
- No-op transactions do not create revisions.
- Weighted merge limits are consistent across all mutation paths.
- Coordinators can discover authoritative effect hashes through bounded typed tools.
- Assignment-bound host dispatch prevents unassigned helper children from counting as semantic workers.
- A deterministic tiny full-path integration test preserves stage compatibility coverage.
- Alice remains a separate semantic quality and efficiency evaluation corpus.
