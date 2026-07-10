---
title: "World Import Staged Quality Parity - Plan"
type: feat
date: 2026-07-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# World Import Staged Quality Parity - Plan

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Make staged `world-import` runs consistently match or exceed single-session quality by improving context handoff, review evidence, and bounded repair coverage. |
| Primary users | Agents and humans running long `world-import` jobs who want staged observability and repair without losing semantic richness across stage boundaries. |
| Authority | Alice staged-vs-single comparison from `world-output/alice-wonderland-20260710-034901` and `world-output/alice-wonderland-staged-20260710-043551`, existing staged orchestration in `src/world-import/model-runner.ts`, final eval/review bundle construction in `src/world-import/eval.ts`, and world-import skill guidance in `skills/world-import/SKILL.md`. |
| Execution profile | Multi-unit quality hardening across prompts, review bundle construction, checkpoint flow, lint/eval tests, and docs. |
| Stop conditions | Stop before helper-owned semantic judgment, unbounded self-repair loops, or provider-specific scoring hacks. |

---

## Product Contract

### Summary

Staged `world-import` now gives better observability and can catch repairable omissions before final eval, but the Alice comparison showed staged output can underperform single-session output when stage boundaries lose holistic context. The staged run correctly found and repaired a missing Knave's letter object, but it scored lower because it lost some standalone minor entities/style pages, produced long synthesis pages with sparse citations, and gave final reviewers incomplete evidence about source text and candidate dispositions.

This work improves staged runs by making context transfer explicit, giving reviewers better evidence, and adding bounded verification/repair surfaces for the exact issues that caused the lower score.

### Problem Frame

The current staged pipeline has a valuable shape: `extract -> merge -> post-merge-review -> repair -> review`. However, the Alice run exposed five quality gaps:

1. **Context loss between extract and merge**: minor entities and style surfaces may be merged away without enough visible omission rationale.
2. **Reviewer evidence loss**: final eval samples source prefixes, causing the reviewer to perceive later chapters as truncated even when retained source pages exist.
3. **Disposition invisibility**: final eval does not clearly expose represented/dropped/merged candidate accounting, so dropped-candidate risk is over-penalized.
4. **Sparse provenance on synthesis pages**: long synopsis/timeline/chapter-guide/entity pages pass lint but carry too few claim-supporting refs.
5. **Checkpoint false positives and narrow repair**: post-merge review can misread existing narrative surfaces, and repair only addresses requested actions rather than verifying residual quality.

### Requirements

- R1. Staged mode must preserve enough extraction context for merge to retain or explicitly account for minor named entities, plot-critical objects, and style/poem candidates.
- R2. Final eval/reviewer prompts must include candidate accounting summaries so represented, dropped, merged, and deferred candidates are visible to reviewers.
- R3. Final eval source sampling must give every body unit explicit, reconstructable start/middle/end evidence within a documented bounded-budget policy, so reviewers do not infer missing late-chapter source evidence from prefix truncation.
- R4. Post-merge review prompts must include deterministic artifact existence/size summaries for narrative surfaces (`plot/corpus synopsis`, `timeline`, `chapter/scene guide`) to reduce false missing-surface findings.
- R5. Staged repair must support one deterministic, action-scoped verification step after repair. The checkpoint must record per-action verified, residual, or not-deterministically-verifiable outcomes; it may report `verified-repaired` only when every requested action is verified.
- R6. Provenance review must deterministically highlight sparse long-form synthesis pages using a documented coverage threshold, and give the repair model bounded evidence-finding instructions using existing helper tools.
- R7. All changes must keep semantic decisions model-owned; TypeScript may summarize, sample, validate, and route, but must not decide entity importance or author world prose.
- R8. Tests must cover prompt/bundle contents, staged checkpoint behavior, repair verification states, and regression cases matching the Alice quality gap.
- R9. Documentation must explain how staged is intended to beat single: more reviews plus explicit context handoff, not opaque retries.

### Acceptance Examples

- AE1. Given an Alice-like staged output with dropped candidates, final eval includes candidate disposition summaries and the reviewer no longer says dropped-candidate risk is impossible to assess solely because dispositions are hidden.
- AE2. Given a corpus with 12 chapters, final eval source sampling includes start/middle/end excerpts and source-page references for each body unit rather than only early prefixes; tests assert exact body-unit coverage.
- AE3. Given existing `plot-synopsis.md`, `timeline.md`, and `chapter-guide.md`, post-merge review sees their presence and sizes and does not falsely request missing narrative surfaces.
- AE4. Given a synthesis page of at least 2,500 body characters with only two bookend refs, provenance diagnostics emit `sparse-synthesis-provenance` from its deterministic ref-density and heading-ref signals; repair guidance points to bounded helper commands for strengthening evidence.
- AE5. Given a repair action adding a missing plot object, the subsequent verification checkpoint records a per-action result for artifact existence, index presence, and resolved provenance; semantic actions without a deterministic predicate are explicitly `not-deterministically-verifiable` and leave the checkpoint `residual`.

---

## Technical Design

### Decision 1: Treat staged quality as context-handoff quality

Staged should not attempt to recreate a single long model context. Instead, each boundary should persist the context the next stage needs:

- extraction candidates with rich payloads and provenance;
- candidate accounting with explicit dispositions keyed by the existing `(unitId, candidateId)` identity;
- narrative-surface inventory;
- provenance warning summaries;
- checkpoint findings and action-scoped verification outcomes.

This preserves the project boundary that helpers own structure while models own semantics.

### Decision 2: Improve review bundles before tuning reviewer prompts

The lower staged score was partly caused by reviewer inputs, not only artifact quality. `buildReviewBundle()` currently budget-slices normalized units and markdown in ways that can hide later source text, dispositions, or full timeline/synopsis content. Fixing bundle construction makes both final eval and post-merge review fairer and more actionable.

### Decision 3: Add verification, not unbounded self-healing

After a repair stage, run a bounded verification checkpoint that inspects the requested actions and current emitted bundle. It should mark actions as resolved/residual and optionally request one more repair only if configured. Default remains bounded and inspectable.

---

## Implementation Units

### Unit 1: Review bundle evidence coverage

**Files**

- `src/world-import/eval.ts`
- `src/world-import-eval.test.ts`

**Work**

- Replace prefix-only source sampling with source-unit-balanced sampling.
  - Include unit metadata for all units.
  - Include bounded start/middle/end snippets per body unit when full content cannot fit.
  - Preserve source unit page references for reconstructability.
- Replace sequential source slicing with a deterministic allocator:
  - reserve an equal source-text share for every body unit before adding optional detail;
  - emit start/middle/end snippets plus the source page reference for each unit;
  - use a 240-character preferred snippet size and adapt evenly down to a 80-character minimum if the 60,000-character budget requires it;
  - if the body-unit count cannot meet the minimum, emit all unit metadata and a `coverage-truncated` bundle diagnostic rather than silently dropping late units; reviewer instructions must treat that diagnostic as insufficient evidence, not missing source.
- Add candidate accounting summary to `ReviewBundle` or prompt construction using the existing `CandidateDisposition` identity and enum:
  - extraction candidate count by unit/group;
  - represented/merged/deferred/dropped/unaccounted counts;
  - dropped/deferred candidates with reasons, bounded by size;
  - a separate extraction-coverage section so disposition completeness is not presented as extraction recall.
- Add artifact inventory summaries for key narrative surfaces and long synthesis pages:
  - id, group, title, section count, body character count, provenance count, related count.

**Tests**

- `src/world-import-eval.test.ts`: source sampling covers every body-unit ID and selects start/middle/end excerpts for a multi-unit corpus.
- `src/world-import-eval.test.ts`: oversized-unit fixture emits `coverage-truncated` instead of silently omitting late units.
- `src/world-import-eval.test.ts`: reviewer prompt includes candidate disposition summary and dropped-candidate reasons.
- `src/world-import-eval.test.ts`: Alice-like extraction fixture verifies required minor entity, plot-object/document, and style candidate classes before merge; disposition accounting remains a separate assertion.
- `src/world-import-eval.test.ts`: reviewer prompt includes narrative-surface artifact inventory.

### Unit 2: Post-merge review false-positive hardening

**Files**

- `src/world-import/eval.ts`
- `src/world-import.test.ts`
- `docs/world-import.md`

**Work**

- Add deterministic preamble to post-merge review prompt:
  - narrative surfaces found/missing;
  - artifact counts by group;
  - top provenance warnings;
  - candidate accounting summary.
- Update the focus rubric to require checking the inventory before claiming a surface is missing.
- Make requested actions distinguish:
  - missing artifact;
  - strengthen existing artifact;
  - record omission/disposition;
  - strengthen provenance.

**Tests**

- `src/world-import.test.ts` or `src/world-import-eval.test.ts`: prompt for a bundle with `plot-synopsis`, `timeline`, and `chapter-guide` includes them as present.
- Parser tests still accept existing checkpoint JSON shape.

### Unit 3: Repair verification checkpoint

**Files**

- `src/world-import/model-runner.ts`
- `src/world-import/eval.ts`
- `src/world-import/types.ts`
- `src/world-import.test.ts`

**Work**

- Add a post-repair verification step after `stage: "repair"`.
- Persist a versioned `stages/checkpoints/post-merge-01.verify.json` separate from the immutable review and repair records.
- Add an `actionResults` contract keyed by requested action ID: `verified`, `residual`, or `not-deterministically-verifiable`; include the applicable checks, evidence paths/diagnostic codes, and residual explanation.
- Verification is bounded and action-scoped. Require action-type selectors/predicates before a structural action can be verified:
  - `add-artifact` / `add-narrative-surface`: target artifact and emitted markdown exist, index membership when applicable, and refs resolve;
  - `repair-candidate-disposition`: canonical `(unitId, candidateId)` disposition is present and valid;
  - `strengthen-artifact`, `record-omission`, `strengthen-provenance`, and `other`: record `not-deterministically-verifiable` unless the requested action supplies an explicit deterministic predicate. They remain residual for optional human/model review; file existence alone is not semantic verification.
  - lint diagnostics are action-scoped: unrelated pre-existing diagnostics are reported but do not fail another action.
- Record checkpoint `verified-repaired` only if every requested action is `verified`; otherwise record `residual`. This unit adds no automatic second repair loop: existing `maxRepairIterations` remains the single configured repair bound.

**Tests**

- `src/world-import.test.ts`: structural repair action followed by verification produces a versioned verify packet and `verified-repaired`.
- `src/world-import.test.ts`: semantic repair action is `not-deterministically-verifiable` and leaves the checkpoint `residual`.
- `src/world-import.test.ts`: unrelated existing lint diagnostics are reported without failing an otherwise verified action; unresolved repair records `residual` and does not loop indefinitely.

### Unit 4: Provenance repair guidance for long synthesis pages

**Files**

- `skills/world-import/SKILL.md`
- `skills/world-import/references/contracts.md`
- `docs/world-import.md`
- Optional: `src/world-import/helper-tools.ts` if a deterministic summary helper is needed.

**Work**

- Add deterministic `sparse-synthesis-provenance` reporting for synopsis/timeline/chapter-guide artifacts with at least 2,500 body characters when they have fewer than three resolved refs, more than 1,200 body characters per resolved ref, or only heading/title-like refs. Reuse existing artifact-level refs and body-character counts; report the triggered structural signals and do not infer claim-to-section placement, judge claim truth, or author prose.
- Tighten skill guidance: long synthesis artifacts should carry provenance across major sections, not just bookends.
- Teach repair stage to use `provenance-audit`, `suggest-ref-candidates`, and `quote-ref --as-ref` for synthesis-page provenance strengthening.
- Document expected provenance pattern for synopsis/timeline/chapter-guide: representative refs across beginning/middle/end; chapter-level surfaces should cite multiple chapter units or explicitly justify summary-level refs.

**Tests**

- Existing provenance audit tests remain green.
- Add deterministic fixtures for sparse two-ref/bookend-only density, sufficiently referenced pages, short-page exemption, heading-only refs, and unresolved-ref handling.
- Add prompt/fixture assertions for repair guidance; validate remaining narrative guidance through docs/skill review.

### Unit 5: Staged extraction/merge prompt hardening

**Files**

- `skills/world-import/SKILL.md`
- `skills/world-import/references/contracts.md`
- `src/world-import.test.ts` if prompt rendering changes.
- `src/world-import-eval.test.ts` for extraction fixture coverage.

**Work**

- In `stage: "extract"`, require candidates for:
  - minor named entities;
  - plot-critical props/documents;
  - poems/songs/parodies/style surfaces;
  - omission/disposition notes when something is likely too minor for a standalone page.
- Add an Alice-like deterministic extraction fixture with named expected candidate IDs/classes and source refs. It guards extraction recall before merge; it must not encode importance ranking or author prose.
- In `stage: "merge"`, require dropped candidates to explain why their content remains discoverable or why standalone omission is acceptable.
- Require the existing `CandidateDisposition` fields (`unitId`, `candidateId`, disposition enum, optional artifact ID, and reason where applicable) rather than introducing a second disposition artifact schema.

**Tests**

- Prompt rendering tests verify staged prompts include the new extraction/merge quality instructions if prompt construction is centralized.
- Extraction fixture asserts expected candidate IDs/classes and valid source refs before merge.

### Unit 6: Default staged mode follow-through

**Files**

- `src/world-import-cli.ts`
- `src/world-import-cli.test.ts`
- `src/world-import/model-runner.ts`
- `src/world-import.test.ts`
- `docs/world-import.md`

**Work**

- Keep `--session-strategy staged` as the CLI default and make `runWorldImportSkillWithRunners()` default to staged too, so direct library callers do not silently take a different product default.
- Document when to override with `--session-strategy single` for comparison/debugging.
- Add docs explaining that staged may run longer but should produce better inspectability and bounded repair.

**Tests**

- `src/world-import-cli.test.ts`: CLI default remains `staged`; explicit `single` still works.
- `src/world-import.test.ts`: direct runner invocation defaults to `staged`; explicit `single` still works.

---

## Sequencing

1. Land the staged-default change and this plan.
2. Implement Unit 1 first because fair review inputs reduce misleading scores across all later work.
3. Implement Unit 2 to reduce checkpoint false positives.
4. Implement Unit 3 so repairs can be verified instead of merely attempted.
5. Implement Units 4 and 5 to raise actual staged output quality.
6. Run an Alice staged rerun and compare against the existing single-session baseline.

---

## Validation Plan

Run targeted tests after implementation:

```bash
node --import tsx --test src/world-import-cli.test.ts
node --import tsx --test src/world-import.test.ts
node --import tsx --test src/world-import-eval.test.ts
node --import tsx --test src/world-import-provenance-tools.test.ts
```

Then run a reproducible empirical comparison. Preserve each deterministic review bundle and parsed reviewer JSON. Re-evaluate both historical baselines and the new staged output using the same current evaluator prompt/bundle version and pinned reviewer model ID; run each evaluation three times. Compare median overall score and dimension scores: staged must meet or exceed the single-session median overall score, with no dimension worse by more than one point. Invalid reviewer parses fail the comparison rather than being dropped.

```
npm run world-import-run -- \
  --transcript world-output/alice-staged-quality.typescript \
  --input samples/Alice_Adventures_in_Wonderland.epub \
  --output world-output/alice-staged-quality \
  --model openrouter/deepseek/deepseek-v4-pro \
  --debug \
  --show-tool-updates

npm run world-import-helper -- lint --output world-output/alice-staged-quality
npm run world-import-helper -- eval --output world-output/alice-staged-quality --reviewer-model openrouter/deepseek/deepseek-v4-pro
```

Compare against (re-evaluated with the same evaluator protocol, not their historical scores):

- `world-output/alice-wonderland-20260710-034901`
- `world-output/alice-wonderland-staged-20260710-043551`

Success target: staged lint passes; all reviewer parses are valid; staged median overall score is on par with or above the re-evaluated single-session median with no dimension regression greater than one point; deterministic provenance warnings are reduced or explicitly exempt; and checkpoint repair/verification artifacts explain every residual tradeoff.

---

## Risks and Mitigations

- **Risk: prompts become too long.** Mitigate with the documented equal-share source allocator, explicit `coverage-truncated` signal, and source-unit-balanced snippets rather than full dumps.
- **Risk: reviewer overfits to deterministic summaries.** Keep source snippets, markdown artifacts, and candidate summaries together so reviewers can cross-check.
- **Risk: more repair stages increase cost.** Default to one repair plus verification; make additional repair iterations explicit/configurable.
- **Risk: helper code starts making semantic decisions.** Keep helper additions to summarization, validation, routing, and prompt evidence; model-authored stages remain the semantic source of truth.

---

## Open Questions

- Should residual semantic repair actions receive an optional model-review explanation in a later follow-up? This plan records them as `not-deterministically-verifiable` and does not add another repair loop.
- Should staged extraction write a dedicated corpus inventory artifact after the candidate-fixture evidence is collected? This plan uses the existing candidate/disposition schema first.
- Should final eval score be allowed to proceed when deterministic warnings exist? Current behavior allows warnings but blocks on deterministic failures; keep this unless tests reveal warning handling regressions.
