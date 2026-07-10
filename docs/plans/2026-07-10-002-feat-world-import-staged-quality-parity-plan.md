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
- R3. Final eval source sampling must represent every body unit well enough that reviewers do not infer missing late-chapter source evidence from prefix truncation.
- R4. Post-merge review prompts must include deterministic artifact existence/size summaries for narrative surfaces (`plot/corpus synopsis`, `timeline`, `chapter/scene guide`) to reduce false missing-surface findings.
- R5. Staged repair must support at least one verification step after repair so the checkpoint records whether requested actions appear resolved or residual.
- R6. Provenance review must highlight sparse long-form synthesis pages and give the repair model bounded evidence-finding instructions using existing helper tools.
- R7. All changes must keep semantic decisions model-owned; TypeScript may summarize, sample, validate, and route, but must not decide entity importance or author world prose.
- R8. Tests must cover prompt/bundle contents, staged checkpoint behavior, repair verification states, and regression cases matching the Alice quality gap.
- R9. Documentation must explain how staged is intended to beat single: more reviews plus explicit context handoff, not opaque retries.

### Acceptance Examples

- AE1. Given an Alice-like staged output with dropped candidates, final eval includes candidate disposition summaries and the reviewer no longer says dropped-candidate risk is impossible to assess solely because dispositions are hidden.
- AE2. Given a corpus with 12 chapters, final eval source sampling includes representative excerpts from each chapter/source unit rather than only early prefixes.
- AE3. Given existing `plot-synopsis.md`, `timeline.md`, and `chapter-guide.md`, post-merge review sees their presence and sizes and does not falsely request missing narrative surfaces.
- AE4. Given a long synopsis page with only heading citations, provenance diagnostics identify the weak refs and repair guidance points to bounded helper commands for strengthening evidence.
- AE5. Given a repair action adding a missing plot object, the subsequent verification checkpoint records whether the object exists, is indexed, has provenance, and whether residual findings remain.

---

## Technical Design

### Decision 1: Treat staged quality as context-handoff quality

Staged should not attempt to recreate a single long model context. Instead, each boundary should persist the context the next stage needs:

- extraction candidates with rich payloads and provenance;
- candidate accounting with explicit dispositions;
- narrative-surface inventory;
- provenance warning summaries;
- checkpoint findings and repair outcomes.

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
- Add candidate accounting summary to `ReviewBundle` or prompt construction:
  - extraction candidate count by unit/group;
  - represented/merged/deferred/dropped/unaccounted counts;
  - dropped/deferred candidates with reasons, bounded by size.
- Add artifact inventory summaries for key narrative surfaces and long synthesis pages:
  - id, group, title, section count, body character count, provenance count, related count.

**Tests**

- `src/world-import-eval.test.ts`: source sampling includes more than early units for a multi-unit corpus.
- `src/world-import-eval.test.ts`: reviewer prompt includes candidate disposition summary and dropped-candidate reasons.
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
- Persist verification under `stages/checkpoints/`, e.g. `post-merge-01.verify.json` or extend `post-merge-01.repair.json` with structured action results.
- Verification should be bounded and action-scoped:
  - target artifact exists;
  - emitted markdown exists;
  - target appears in group index when applicable;
  - provenance refs resolve;
  - lint is clean or residual diagnostics are explicit.
- Record `verified-repaired` when requested actions are satisfied; otherwise `residual`.

**Tests**

- `src/world-import.test.ts`: repair action followed by verification can produce `verified-repaired`.
- `src/world-import.test.ts`: unresolved repair records `residual` and does not loop indefinitely.

### Unit 4: Provenance repair guidance for long synthesis pages

**Files**

- `skills/world-import/SKILL.md`
- `skills/world-import/references/contracts.md`
- `docs/world-import.md`
- Optional: `src/world-import/helper-tools.ts` if a deterministic summary helper is needed.

**Work**

- Tighten skill guidance: long synthesis artifacts should carry provenance across major sections, not just bookends.
- Teach repair stage to use `provenance-audit`, `suggest-ref-candidates`, and `quote-ref --as-ref` for synthesis-page provenance strengthening.
- Document expected provenance pattern for synopsis/timeline/chapter-guide:
  - at least representative refs across beginning/middle/end;
  - chapter-level surfaces should cite multiple chapter units or explicitly justify summary-level refs.

**Tests**

- Existing provenance audit tests remain green.
- Add prompt/fixture assertions only if helper behavior changes; otherwise validate through docs/skill review.

### Unit 5: Staged extraction/merge prompt hardening

**Files**

- `skills/world-import/SKILL.md`
- `skills/world-import/references/contracts.md`
- `src/world-import.test.ts` if prompt rendering changes.

**Work**

- In `stage: "extract"`, require candidates for:
  - minor named entities;
  - plot-critical props/documents;
  - poems/songs/parodies/style surfaces;
  - omission/disposition notes when something is likely too minor for a standalone page.
- In `stage: "merge"`, require dropped candidates to explain why their content remains discoverable or why standalone omission is acceptable.
- Encourage explicit `record-omission` or disposition artifacts/sections where minor entities are merged into broader event pages.

**Tests**

- Prompt rendering tests verify staged prompts include the new extraction/merge quality instructions if prompt construction is centralized.

### Unit 6: Default staged mode follow-through

**Files**

- `src/world-import-cli.ts`
- `src/world-import-cli.test.ts`
- `docs/world-import.md`

**Work**

- Preserve the just-made default of `--session-strategy staged`.
- Document when to override with `--session-strategy single` for comparison/debugging.
- Add docs explaining that staged may run longer but should produce better inspectability and bounded repair.

**Tests**

- `src/world-import-cli.test.ts`: default remains `staged`; explicit `single` still works.

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

Then run an empirical comparison:

```bash
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

Compare against:

- `world-output/alice-wonderland-20260710-034901`
- `world-output/alice-wonderland-staged-20260710-043551`

Success target: staged lint passes, final reviewer parse is valid, score is on par with or above single-session, provenance warnings are reduced or clearly justified, and checkpoint repair/verification artifacts explain any residual tradeoffs.

---

## Risks and Mitigations

- **Risk: prompts become too long.** Mitigate with bounded summaries and source-unit-balanced snippets rather than full dumps.
- **Risk: reviewer overfits to deterministic summaries.** Keep source snippets, markdown artifacts, and candidate summaries together so reviewers can cross-check.
- **Risk: more repair stages increase cost.** Default to one repair plus verification; make additional repair iterations explicit/configurable.
- **Risk: helper code starts making semantic decisions.** Keep helper additions to summarization, validation, routing, and prompt evidence; model-authored stages remain the semantic source of truth.

---

## Open Questions

- Should repair verification be model-reviewed, deterministic, or hybrid? Recommended first pass: deterministic action checks plus optional reviewer explanation when residual.
- Should staged extraction write a dedicated corpus inventory artifact, or should candidate dispositions carry enough inventory detail? Recommended first pass: candidate/disposition summaries, then decide from eval results.
- Should final eval score be allowed to proceed when deterministic warnings exist? Current behavior allows warnings but blocks on deterministic failures; keep this unless tests reveal warning handling regressions.
