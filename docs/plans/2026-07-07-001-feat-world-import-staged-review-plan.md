---
title: "World Import Staged Review and Repair Loop - Plan"
type: feat
date: 2026-07-07
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# World Import Staged Review and Repair Loop - Plan

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Add bounded reviewer/repair checkpoints inside `world-import` so weak semantic output can be detected and corrected before the final eval result is written. |
| Primary users | Agents and humans running `world-import` who want stronger narrative/wiki output without manually inspecting every intermediate stage. |
| Authority | Current `world-import` staged workflow in `src/world-import/model-runner.ts`, `AGENTS.md` helper-boundary rules, the new plot/eval hardening behavior, and the Romeo & Juliet run showing that a final reviewer can still discover repairable semantic gaps such as weak `things` coverage. Single-session support is explicitly deferred/skipped in this MVP because it currently runs as one opaque model session. |
| Execution profile | Multi-unit code/documentation change touching staged orchestration, helper/eval review surfaces, and regression tests. |
| Stop conditions | Stop before adding unbounded self-healing loops, helper-owned semantic decisions, or making staged review mandatory for all runs without an explicit bounded policy. |

---

## Product Contract

### Summary

`world-import` currently performs semantic extraction/merge, emits markdown, then runs deterministic lint/eval plus optional reviewer scoring at the end. That final reviewer can detect problems such as missing plot-critical object coverage, weak omission visibility, or thin narrative surfaces — but by then the run is effectively finished. This plan adds intermediate reviewer checkpoints and bounded repair stages so the pipeline can improve semantic output before finalization while preserving the project rule that semantic judgment stays in the model/skill workflow, not in TypeScript helpers.

### Problem Frame

The Romeo & Juliet run produced a good final bundle, but the reviewer still identified issues that could plausibly have been repaired inside the same run: missing durable object pages for important props, omissions that were not explicitly visible, and narrative artifacts that were a bit lightly cited for their length. Today the workflow has no structured place for the model to pause after extraction or merge, hear a focused critique, and patch the semantic output before final eval. Without that, the pipeline either ships known-fixable issues or relies on a human to start another session.

### Requirements

- R1. `world-import` staged mode must support one intermediate semantic review checkpoint before the final eval result is written; additional checkpoints are deferred.
- R2. Intermediate review must remain model-owned: helpers may summarize structure and persist review envelopes, but must not decide canon, significance, identity, or rewrite semantic prose themselves.
- R3. The first staged-review pass must target the highest-value repair point for missing/weak artifacts: after the staged `merge` session has produced merge/emitted artifacts and before final eval success is declared. A true pre-emit merge-only checkpoint is deferred until the workflow is split further.
- R4. Review output must be structured and actionable enough to drive a bounded repair pass, especially for narrative-surface completeness, plot-critical object coverage, omission visibility, and citation/provenance quality.
- R5. Repair loops must be explicitly bounded (for example, max one or two iterations per checkpoint) so a run cannot silently loop forever.
- R6. Runs must preserve observability: emitted artifacts, review artifacts, repair summaries, and final decisions must remain inspectable under `stages/` and/or `world/`.
- R7. Final reviewer/eval remains authoritative for end-of-run quality reporting; intermediate reviews are aids to improve output, not replacements for final eval.
- R8. The first implementation supports staged orchestration mode. Single-session mode must clearly record or report skip behavior because it currently runs as one opaque `full` model session with no orchestrator-visible merge boundary.
- R9. The system must allow a reviewer to request repairs for issues like missing `things` artifacts, missing scene/plot surfaces, weak candidate dispositions, or sparse provenance on synthesis pages.
- R10. The implementation must not force every tiny step through a heavyweight general review; checkpoints should be focused and right-sized.
- R11. Tests must cover bounded-loop behavior, stage artifact writing, skip conditions, and at least one Romeo-like case where review feedback would trigger a semantic repair request.

### Scope Boundaries

#### In scope

- Introducing one focused post-merge review checkpoint in staged mode.
- Defining review artifact envelopes and stage metadata for repair requests/results.
- Adding bounded orchestration logic for review -> repair -> re-emit / re-check.
- Prompting reviewer models with focused rubrics for artifact coverage, object coverage, omission visibility, and provenance density.
- Updating docs for the new stage flow and debugging/inspection expectations.

#### Deferred to Follow-Up Work

- Automatic multi-pass quality optimization across many reviewer models.
- Fully autonomous retry selection based on cost/latency budgets.
- Semantic/vector coverage measurement beyond current structural and reviewer signals.
- Human-in-the-loop approval UIs for accepting/rejecting repair requests.

#### Outside this plan

- Helper-generated semantic summaries or helper-authored world artifacts.
- Infinite or open-ended self-healing loops.
- Redesigning the artifact taxonomy beyond what review prompts recommend.
- General-purpose agentic workflow orchestration outside `world-import`.
- Extraction-stage and pre-emit merge-only checkpoints; those require additional workflow splitting beyond this MVP.

### Acceptance Examples

- AE1. Given a narrative import whose merge stage omitted plot-critical objects but preserved enough source evidence, when post-merge review runs, then the review requests adding specific durable `things` artifacts before final eval.
- AE2. Given a bundle with missing synopsis/timeline/scene-guide surfaces, when intermediate review runs, then it flags those gaps and the repair stage can author the missing artifacts before final eval.
- AE3. Given a bundle whose synthesis pages are structurally valid but sparsely cited, when focused review runs, then it can request provenance strengthening without helper-authored prose changes.
- AE4. Given a run that already satisfies the review rubric, when staged review runs, then no repair pass is triggered and the pipeline proceeds directly to final eval.
- AE5. Given a reviewer that keeps asking for more changes, when the loop reaches its configured limit, then the run stops with explicit residual findings rather than silently continuing.

### Product Contract Preservation

Product Contract unchanged.

---

## Planning Contract

### Key Technical Decisions

- D1. Start with **staged post-merge review** as the first checkpoint because it is the best current leverage point for repairing missing semantic artifacts before final eval. In the current codebase this means after the staged `merge` session, which already performs merge/emission work, and before the final reviewer/eval stage.
- D2. Represent intermediate review output as persisted checkpoint artifacts under `stages/checkpoints/` (for example `stages/checkpoints/post-merge-01.review.json`, `stages/checkpoints/post-merge-01.repair.json`, and `stages/checkpoints/post-merge-01.summary.json`) with structured findings and requested actions, not only freeform logs. Do not collide with the existing final `stages/review.json` eval artifact.
- D3. Keep repairs model-owned by re-entering the skill workflow with the review packet plus existing merge/emitted state; helpers only persist, summarize, and validate envelopes.
- D4. Bound the checkpoint with a small iteration cap (default 1, configurable to 2 later) and explicit skip/stop reasons.
- D5. Keep final `eval` as a distinct end-stage that reads the repaired world state after intermediate fixes.

### High-Level Technical Design

1. **New checkpoint model**
   - Add a stage abstraction for intermediate review/repair checkpoints, starting and ending this MVP with `post-merge`.
   - Each checkpoint writes:
     - reviewer request/context
     - structured findings
     - requested repairs with grounding fields
     - iteration count
     - resolution status (`no-action`, `repair-attempted`, `verified-repaired`, `residual`, `skipped`)
   - Grounding fields must include target artifact id/path when known, candidate id/unit id/source refs when known, confidence, requested action type, and whether the repair model should re-read source text.

2. **Focused reviewer prompt family**
   - Introduce a narrower review prompt than final eval.
   - Initial rubric focuses on:
     - narrative surface completeness
     - plot-critical object coverage
     - omission visibility / candidate-disposition visibility
     - provenance density on synthesis pages
     - obvious missing durable artifacts for major scenes/props
   - Output should be JSON-first so orchestration can decide whether to trigger repair.

3. **Bounded repair loop**
   - If findings are actionable, re-prompt the import skill in a dedicated repair stage to patch merge artifacts and re-emit as needed using the structured review packet.
   - Re-run deterministic lint/eval checks after repair. If no post-repair semantic re-review is performed because the iteration limit is exhausted, record `repair-attempted` or `residual` rather than claiming `verified-repaired`.
   - Stop after the configured iteration limit and record residual findings.

4. **Mode integration**
   - Staged mode: review/repair integrates as explicit orchestrator stages after the current `merge` session and before final `review`/eval, with resumable artifacts on disk.
   - Single-session mode: skip staged review with an explicit skip reason because the `full` run is one model session and the orchestrator has no merge-boundary hook. A future plan may decompose single-session into the same stages.

5. **Observability**
   - Persist checkpoint artifacts under `stages/`.
   - Include concise summaries in CLI output and docs so users know where a run paused, repaired, or accepted residual issues.

### Plain-Language Staged Mode Summary

`world-import` has two broad ways to run:

- **Single-session mode** gives one model session the whole job. The model receives the `world-import` skill instructions and is expected to normalize sources, extract candidates, merge artifacts, emit markdown, run checks, and summarize the result in one continuous context window. This is simple, but the TypeScript orchestrator cannot see a clean “merge just finished” moment inside the model's private context.
- **Staged mode** splits the same job into separate model sessions. Each stage starts with a fresh context window, reads durable files from disk, does one bounded part of the workflow, writes durable files back to disk, and exits. Disk artifacts are the handoff between windows.

In current staged mode, the main program control flow is:

1. `src/world-import-cli.ts` parses flags and calls `runWorldImportSkill`.
2. `src/world-import/model-runner.ts` runs the actual orchestration.
3. The runner starts an **extract** model session with `/skill:world-import { stage: "extract", ... }`.
   - The model uses deterministic helper commands to normalize/read sources.
   - The model authors semantic extraction candidates.
   - Helpers persist extraction envelopes under `stages/extraction/`.
4. If extraction produced stage files, the runner starts a separate **merge** model session with `/skill:world-import { stage: "merge", ... }`.
   - This is a new model context window, so it must inspect files on disk rather than relying on extract-session memory.
   - The model makes semantic merge decisions and authors artifact packets.
   - Deterministic helpers validate/write merge state, emit markdown, lint, and produce repair summaries.
5. If emitted markdown exists and a reviewer model is configured, the runner runs final deterministic/reviewer eval, which writes `stages/review.json`.

The proposed checkpoint fits between steps 4 and 5. After the merge session exits, the orchestrator has a durable world bundle on disk and can run a focused reviewer before final eval. If the reviewer asks for grounded repairs, the orchestrator starts another fresh model session in a new **repair** mode. That repair model receives the review packet path and current output root, reads the durable merge/world files, performs only the requested model-owned semantic repairs, then uses deterministic helpers to re-emit/lint.

The responsibility split is:

- **Model/skill-owned:** deciding what the story means, which entities matter, whether an object deserves a page, how to word narrative summaries, how to explain omissions, and how to resolve conflicts/retcons.
- **Deterministic helper-owned:** normalizing sources, reading bounded slices, resolving/quoting provenance refs, validating JSON/envelopes, writing stage files, emitting markdown from artifact packets, linting links/frontmatter/provenance shape, auditing coverage, and persisting review/checkpoint artifacts.
- **Orchestrator-owned:** starting and stopping sessions, passing skill args, enforcing stage order, checking whether files exist, bounding repair iterations, deciding whether to skip because config is missing, and recording statuses.

### Research Findings

- Current workflow already distinguishes deterministic helper work from model-owned semantic work; staged review should preserve that boundary instead of pushing semantic checks into helpers.
- The recent plot/eval hardening already added reviewer dimensions for object coverage and omission visibility, which can seed a narrower intermediate rubric.
- The Romeo & Juliet run showed that final reviewer findings can be actionable without implying the whole run failed; this supports a bounded repair checkpoint rather than a pass/fail-only gate.

### Assumptions

- A stronger reviewer model will usually be available for imports where staged review is worth the cost.
- Merge-stage artifacts remain the easiest semantic surface to patch before re-emit.
- Users will accept a moderate runtime increase in exchange for better final artifact quality when staged review is enabled.

### Risks & Mitigations

- **Risk:** Review prompts become too broad and expensive.  
  **Mitigation:** Start with one focused checkpoint and a short rubric.
- **Risk:** Repair loops thrash or oscillate.  
  **Mitigation:** Hard iteration caps, residual recording, no silent retries.
- **Risk:** Helpers begin making semantic decisions.  
  **Mitigation:** Keep findings/request generation model-authored; helpers only persist/route structured data.
- **Risk:** Staged mode and single-session mode diverge too much.  
  **Mitigation:** Make staged mode the explicit MVP and document single-session skip behavior. Reuse the persisted review artifact contract if single-session is later decomposed into explicit stages.
- **Risk:** The repair stage is underspecified and becomes impossible to invoke deterministically.  
  **Mitigation:** Define an explicit repair invocation contract before implementing orchestration: stage name, review packet path, checkpoint id, iteration number, expected artifacts, and status semantics.

---

## Implementation Units

### U1. Define staged-review artifact contract and orchestration policy

- **Goal:** Introduce a concrete checkpoint contract and bounded review/repair policy for `world-import` runs.
- **Requirements:** R1, R2, R5, R6, R8, R10.
- **Dependencies:** None.
- **Files:** `src/world-import/types.ts`, `src/world-import/model-runner.ts`, `src/world-import/staging.ts`, `docs/world-import.md`, `skills/world-import/SKILL.md`, `skills/world-import/references/workflow.md`.
- **Approach:** Add new review-stage/result types and iteration metadata. Document when checkpoints run, what they are allowed to do, and how loops stop. Update model-runner stage results and CLI/session summaries to report checkpoint outcomes.
- **Patterns to follow:** Existing staged orchestration and dependency injection in `src/world-import/model-runner.ts`; current CLI summary reporting in `src/world-import-cli.ts`; current eval result typing in `src/world-import/types.ts`; skill boundary language in `skills/world-import/SKILL.md`.
- **Test scenarios:**
  - Given a run with staged review disabled or unavailable reviewer config, the orchestration records a clear skip reason and proceeds.
  - Given a run with one actionable checkpoint, the orchestration records iteration 1 and `repair-attempted`, `verified-repaired`, or `residual` status.
  - Given a loop limit of 1, the run never performs a second repair pass.
- **Verification:** Targeted orchestration/type tests prove the checkpoint contract is persisted and bounded.

### U2. Add focused post-merge reviewer prompt and parser

- **Goal:** Create a narrow review surface that can spot repairable semantic gaps before final eval.
- **Requirements:** R3, R4, R9, R10.
- **Dependencies:** U1.
- **Files:** `src/world-import/eval.ts`, `src/world-import/types.ts`, `src/world-import-eval.test.ts`.
- **Approach:** Add a dedicated prompt builder/parser for intermediate review. The schema should include findings, severity, requested actions, and a boolean/enum indicating whether a repair pass is recommended. Seed the rubric from existing final-eval dimensions but keep it focused on merge/emission readiness.
- **Patterns to follow:** Existing final reviewer prompt + structured parsing in `src/world-import/eval.ts`.
- **Test scenarios:**
  - Valid JSON findings parse into a structured intermediate review result.
  - Missing/invalid structured output is visible and does not silently trigger repairs.
  - Review packets can express requests like “add durable `things` artifact for Friar Lawrence letter” or “make omission visible via candidate disposition.”
- **Verification:** Eval tests cover prompt shape, parsing, and non-authoritative malformed outputs.

### U3. Define and wire the repair-stage invocation contract

- **Goal:** Make repair re-entry explicit before implementing the bounded loop.
- **Requirements:** R2, R4, R5, R7, R9.
- **Dependencies:** U1, U2.
- **Files:** `src/world-import/model-runner.ts`, `skills/world-import/SKILL.md`, `skills/world-import/references/workflow.md`, `src/world-import/types.ts`.
- **Approach:** Extend the skill invocation contract with a dedicated repair mode, such as `stage: "repair"`, plus `checkpointId`, `reviewPacket`, and `iteration`. The repair stage must inspect existing merge/emitted state, address only grounded requested repairs, update merge artifacts via helper tools, re-emit/lint, and summarize attempted/residual work. This unit establishes the API and prompt contract; U4 implements the loop around it.
- **Patterns to follow:** Current staged extract/merge/review skill invocation in `src/world-import/model-runner.ts`; helper-driven incremental artifact writing; skill input documentation in `skills/world-import/SKILL.md`.
- **Test scenarios:**
  - Rendered skill invocation can include repair-stage fields without affecting extract/merge/full calls.
  - Repair-stage args include checkpoint id, review packet path, and iteration number.
  - Skill docs define repair as model-owned and bounded to requested findings.
- **Verification:** Unit tests cover rendering/typing of repair invocations and docs clearly describe expected repair-stage behavior.

### U4. Implement bounded repair pass over merge/emitted artifacts

- **Goal:** Let the model patch repairable semantic issues discovered by intermediate review.
- **Requirements:** R2, R4, R5, R7, R9.
- **Dependencies:** U1, U2, U3.
- **Files:** `src/world-import/model-runner.ts`, `src/world-import/staging.ts`, `skills/world-import/SKILL.md`, `skills/world-import/references/workflow.md`.
- **Approach:** Feed the intermediate review packet plus current merge/emitted state back into the skill repair stage. Constrain the scope to repairing findings, not redoing the whole import. Re-emit and rerun deterministic checks afterward. Only mark `verified-repaired` if a verification pass confirms the repair; otherwise record `repair-attempted` or `residual`.
- **Patterns to follow:** Current staged extract/merge/review orchestration in `src/world-import/model-runner.ts` and helper-driven incremental artifact writing.
- **Test scenarios:**
  - Actionable review findings trigger one repair pass and then re-emit.
  - Non-actionable or empty findings skip repair.
  - Repair-limit exhaustion records residual issues and continues to final eval with explicit status.
- **Verification:** Orchestration tests prove repair is bounded and stage artifacts reflect the result.

### U5. Surface staged-review artifacts and residual findings in docs and outputs

- **Goal:** Make staged review inspectable and debuggable for users and future agents.
- **Requirements:** R6, R7, R8.
- **Dependencies:** U1, U2, U3, U4.
- **Files:** `docs/world-import.md`, `docs/smoke-tests.md`, maybe `README.md` if the workflow summary changes materially.
- **Approach:** Document checkpoint order, stage artifact locations, skip reasons, residual findings, and how final eval relates to intermediate reviews.
- **Patterns to follow:** Existing world-import “Inspecting a run”, “Linting & eval”, and staged-session guidance.
- **Test scenarios:** Documentation-only unit; rely on U1-U3 automated coverage.
- **Verification:** A reader can inspect a run and understand whether staged review ran, what it requested, what got repaired, and what remained.

### U6. Add regression coverage for Romeo-like semantic repair requests

- **Goal:** Prove the new workflow can represent and act on reviewer-detected gaps like weak object coverage or omission visibility.
- **Requirements:** R4, R5, R9, R11.
- **Dependencies:** U2, U4.
- **Files:** `src/world-import-eval.test.ts`, `src/world-import.test.ts`, optional fixture files under `src/` test support.
- **Approach:** Add tests that simulate intermediate review findings for missing props/objects and confirm the orchestration routes them into the repair stage instead of only reporting them at the end.
- **Patterns to follow:** Existing Romeo-like eval failure-mode tests.
- **Test scenarios:**
  - Intermediate review flags missing plot-critical object coverage and recommends repair.
  - Orchestration records a repair attempt and final status.
  - Invalid review output does not cause spurious repair loops.
- **Verification:** Targeted tests demonstrate the new checkpoint is useful for the exact class of problem that motivated the plan.

---

## Verification Contract

| Gate | Command | Applies to | Done signal |
|---|---|---|---|
| Targeted eval tests | `node --import tsx --test src/world-import-eval.test.ts` | U2, U6 | Intermediate-review prompt/parser and regression cases pass. |
| Targeted orchestration tests | `node --import tsx --test src/world-import.test.ts` | U1, U3, U4, U6 | Checkpoint and bounded repair orchestration pass. |
| Full test suite | `npm test` | All units | Existing import/memory regressions remain green. |
| TypeScript build | `npm run build` | All units | TypeScript compiles with the new staged-review types and flow. |
| Manual staged run inspection | Run `npm run world-import-run -- ... --session-strategy staged` on a narrative fixture with reviewer enabled | U1-U5 | Run output and `stages/` artifacts clearly show review -> repair -> final eval behavior. |

---

## Definition of Done

- `world-import` staged mode has one intermediate semantic review checkpoint with a bounded repair loop.
- Review findings are structured, persisted, and clearly distinguish actionable repairs from residual issues.
- The repair pass remains model-owned and does not move semantic judgment into helper code.
- Final eval still runs on the repaired world state and remains the authoritative end-of-run report.
- Docs explain checkpoint order, outputs, and debugging expectations.
- Tests cover prompt/parsing, bounded iteration behavior, skip conditions, and a Romeo-like repairable-gap case.

---

## Appendix

### Sources & Research

- `AGENTS.md` — semantic-boundary rules and pane-supervision expectations.
- `README.md` — project design principle and workflow positioning.
- `docs/world-import.md` — current workflow, staged mode, eval, and inspection guidance.
- `skills/world-import/SKILL.md` — model-owned world-import workflow.
- `skills/world-import/references/workflow.md` — extract/merge/emit/lint/provenance/eval sequence.
- `src/world-import/model-runner.ts` — current single/staged orchestration and staged review/eval insertion point.
- `src/world-import-cli.ts` — CLI parsing and final output summaries.
- `src/world-import/eval.ts` — final reviewer prompt, parsing, and deterministic checks.
- `src/world-import/types.ts` — world-import/eval result contracts.
- `world-output/romeo-juliet-20260707-202247/stages/review.json` — motivating run showing useful final-review findings that could be turned into an earlier repair stage.
