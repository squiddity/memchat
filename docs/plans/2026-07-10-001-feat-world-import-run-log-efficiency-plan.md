---
title: "World Import Run Log Efficiency and Model Tool Discipline - Plan"
type: feat
date: 2026-07-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: herdr-run-observation
execution: code
---

# World Import Run Log Efficiency and Model Tool Discipline - Plan

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Reduce context-wasting world-import tool errors and stdout flood by adding durable transcripts, better helper affordances, and stronger skill/prompt guidance for model workers. |
| Primary users | Agents and humans running `world-import` staged imports in Herdr/pi, especially long narrative imports with repair checkpoints. |
| Authority | `world-output/frankenfrankenstein` run observations, `docs/world-import.md`, `skills/world-import/SKILL.md`, `skills/world-import/references/workflow.md`, `src/world-import/model-runner.ts`, and helper surfaces in `src/world-import/command-router.ts`. |
| Execution profile | Multi-unit helper, orchestration, skill prompt, and docs change. |
| Stop conditions | Stop before moving semantic decisions into helpers, hiding model tool output needed for debugging, or making one corpus-specific workflow hard-coded. |

---

## Product Contract

### Summary

The Frankenstein staged import successfully exercised the new post-merge review and repair loop, but the observed stdout showed avoidable context loss: ad hoc Python scripts to write JSON artifacts, wildcard unit-id mistakes, shell `head`/`tail` truncation, repeated verbose tool updates, and a misleading repair artifact that retained original findings as residuals after they were resolved. This plan adds helper and prompt improvements so running models use existing deterministic tools effectively, avoid brittle shell/Python glue, and leave durable logs that can be reviewed after long Herdr runs.

### Problem Frame

`world-import` is intentionally skill-first: models own semantic extraction/merge/repair while TypeScript helpers own deterministic persistence, provenance, validation, and emission. The Frankenstein run showed this boundary mostly works, but the model still fell back to brittle operational patterns:

- constructing batch artifacts in inline `python3 << 'PYEOF'` scripts;
- using wildcard-like unit ids that helpers interpreted literally and failed with `ENOENT`;
- piping helper output through `head`/`tail`, which hides structured helper errors and encourages repeated retries;
- streaming extremely verbose `--show-tool-updates` into the visible pane without a compact durable transcript strategy;
- persisting `residualFindings` in `post-merge-01.repair.json` even though the repair response said all requested actions were resolved;
- final reviewer still found low-scoring dimensions (`styleToneCoverage`, `droppedCandidateRisk`, `omissionVisibility`) that should become clearer intermediate-review/prompt targets.

The fix should improve model behavior through better tools and clearer prompts, not by making helpers decide artifact significance or write semantic prose.

### Requirements

- R1. Model-backed world-import runs must have an easy, documented way to preserve full stdout/tool logs outside the scrollback pane.
- R2. Skill and workflow prompts must explicitly discourage ad hoc Python/shell JSON construction when a helper surface exists.
- R3. Helpers must support batch artifact persistence so a model can add multiple model-authored artifacts without writing a custom Python loop.
- R4. Helpers must provide safe unit discovery/lookup affordances that prevent literal wildcard unit-id mistakes and guide the model back to `list-units`/prefix matching.
- R5. Helpers should expose bounded source-read options so models do not rely on shell `head`/`tail` pipes for context control.
- R6. Verbose tool updates should remain available for debugging, but the default observed Herdr flow should favor compact pane output plus durable detailed artifacts/transcripts.
- R7. Repair summary artifacts must distinguish original findings, attempted actions, resolved actions, and actual residual findings without contradicting the model summary.
- R8. Intermediate review prompts should include style/tone coverage and omission/candidate-disposition visibility when those are the most important remaining quality gaps.
- R9. Changes must preserve the model/helper boundary: helpers route, validate, persist, and summarize; models decide semantic importance, artifact content, and repair disposition.
- R10. Tests must cover helper ergonomics and repair-summary accounting so regressions are caught without requiring a live model run.

### Scope Boundaries

#### In scope

- CLI/docs changes to recommend or default transcript capture for Herdr model-backed imports.
- Helper command additions for batch artifact writing, unit prefix/match lookup, and bounded reads.
- Skill/prompt revisions that tell running models when and how to use the new helper surfaces.
- Staged repair result schema improvements for resolved vs residual action accounting.
- Intermediate-review prompt updates for style/tone and omission visibility.
- Tests for helper behavior, prompt text, and repair artifact shape.

#### Deferred to Follow-Up Work

- A full TUI dashboard for world-import runs.
- Multi-reviewer fanout or automatic second repair iteration selection.
- Corpus-specific Frankenstein quality tuning.
- Replacing all verbose tool-event streaming with a new event-log subsystem if transcript capture is sufficient.

#### Outside this plan

- Helper-authored semantic artifacts.
- Disabling `--show-tool-updates` entirely.
- Hard-coding style artifacts or object pages for particular books.
- Changing the OKF/world artifact taxonomy.

### Acceptance Examples

- AE1. Given a repair packet requesting four new `things` artifacts, the repair model can persist them with one batch helper command and no inline Python loop.
- AE2. Given a model passes `--unit oebps-...-*u001`, the helper fails with a targeted message explaining that wildcards are not accepted and suggesting `list-units --match` or `read-unit --unit-prefix`.
- AE3. Given a model wants the first 80 blocks of a source unit, it can use a helper flag instead of piping `read-unit` through `head`.
- AE4. Given all requested repair actions are resolved, `post-merge-01.repair.json` records resolved action ids and leaves residual findings empty or absent.
- AE5. Given a long Herdr run, a future reviewer can inspect a durable transcript/log artifact even if pane scrollback has rotated.
- AE6. Given a narrative import with no style artifacts and weak omission visibility, the intermediate review prompt can request a bounded repair or residual note for those dimensions.

---

## Planning Contract

### Key Technical Decisions

- D1. Prefer **helper affordances plus prompt discipline** over more model admonitions alone. The model fell back to Python because batch persistence was awkward; adding the right helper is more reliable than only saying “do not use Python.”
- D2. Treat transcript capture as operational evidence, not semantic output. Store/run transcripts outside `world/` and mention them in docs/debug guidance.
- D3. Keep visible Herdr output compact by documentation/defaults first; only add a tool-event JSONL sink if existing transcript capture is insufficient during implementation.
- D4. Add structured repair-action accounting to the checkpoint contract rather than parsing freeform repair summaries as authoritative state.
- D5. Expand the intermediate review rubric, but keep it focused and bounded: style/tone coverage and omission visibility are eligible only when grounded and repairable.

### High-Level Technical Design

1. **Transcript-first Herdr run guidance**
   - Update docs and possibly `scripts/world-import-run.sh`/CLI help to recommend or default `--transcript` for long model-backed imports.
   - Keep visible pane output useful, but make post-hoc log review independent of scrollback length.

2. **Batch artifact persistence helper**
   - Add a helper command such as `write-artifacts --output <dir> --mode upsert --file artifacts.json` or stdin JSONL support.
   - Validate each artifact with the existing artifact validator.
   - Return per-artifact success/failure summaries with paths and validation diagnostics.
   - Do not generate artifact prose or ids; the input remains model-authored.

3. **Safe unit lookup and bounded reading**
   - Extend `list-units` with `--match <text>` or `--prefix <text>`.
   - Extend `read-unit` with `--unit-prefix <prefix>` and/or a helpful error for wildcard-like unit ids.
   - Add bounded output flags such as `--max-blocks`, `--start-index`, `--max-chars`, or `--head-blocks` so models stop piping through `head`/`tail`.

4. **Repair result accounting**
   - Extend `StagedRepairSummary` with fields like `attemptedActionIds`, `resolvedActionIds`, and `residualActionIds`/`residualFindings`.
   - Update the repair model prompt to output a small structured summary, or have the orchestrator derive resolved/residual only from explicitly returned action ids.
   - Avoid writing all original findings into `residualFindings` after a successful repair.

5. **Skill/prompt updates**
   - Update `skills/world-import/SKILL.md` and `skills/world-import/references/workflow.md` to instruct models:
     - use `write-artifacts` for batches;
     - use `list-units --match` / `read-unit --unit-prefix` for unit lookup;
     - use bounded read flags instead of shell pipes;
     - avoid inline Python/shell JSON builders when helper commands exist;
     - produce structured repair action status.
   - Update post-merge review prompt text in `src/world-import/eval.ts` to mention style/tone artifacts and explicit omission/candidate-disposition visibility.

### Risks & Mitigations

- **Risk:** Batch helper becomes a semantic writer.  
  **Mitigation:** It only validates/persists model-authored packets, exactly like repeated `write-artifact`.
- **Risk:** Transcript defaults create huge files.  
  **Mitigation:** Document output path and allow opt-out; prefer transcript for long model-backed Herdr runs rather than every quick helper command.
- **Risk:** More review dimensions make checkpoint too broad.  
  **Mitigation:** Require findings to be grounded, bounded, and repairable; otherwise record residual notes for final eval.
- **Risk:** Repair action accounting depends on model honesty.  
  **Mitigation:** Persist explicit claimed statuses and pair them with deterministic lint/provenance checks; do not claim verified semantic repair unless evidence exists.

---

## Implementation Units

### U1. Document transcript-first Herdr import supervision

- **Goal:** Make durable run logs the default expectation for long model-backed imports.
- **Requirements:** R1, R6.
- **Files:** `docs/world-import.md`, `docs/smoke-tests.md`, `scripts/world-import-run.sh`, `src/world-import-cli.ts`.
- **Approach:** Update docs and CLI/help text to recommend `--transcript <path>` for Herdr import runs. During implementation, decide whether to only document the flag or have the wrapper auto-suggest/auto-create a transcript path for long model-backed runs.
- **Patterns to follow:** Existing Herdr supervision language in `docs/world-import.md`; current wrapper behavior in `scripts/world-import-run.sh`.
- **Test scenarios:** CLI help/docs mention transcript usage; wrapper behavior remains backward-compatible.
- **Verification:** Build passes and docs describe how to inspect a run after scrollback rotates.

### U2. Add batch artifact writing helper

- **Goal:** Remove the need for inline Python loops when persisting multiple model-authored artifacts.
- **Requirements:** R2, R3, R9, R10.
- **Files:** `src/world-import/command-router.ts`, `src/world-import/staging.ts`, `src/world-import-emit.test.ts` or `src/world-import.test.ts`, `skills/world-import/references/helper-tools.md`.
- **Approach:** Implement `write-artifacts` accepting a JSON array or JSONL/stdin. Reuse existing `validate-artifact` and `write-artifact` logic per artifact. Return structured per-id results and fail non-zero when any artifact fails validation.
- **Patterns to follow:** Existing `write-artifact`, `validate-artifact`, and `patch-merge` helper command patterns.
- **Test scenarios:**
  - Two valid artifacts are persisted in one command.
  - One invalid artifact returns a per-artifact diagnostic without silently writing a partial bad packet.
  - Existing single-artifact command behavior is unchanged.
- **Verification:** Targeted helper tests pass.

### U3. Add safe unit lookup and bounded read options

- **Goal:** Prevent wildcard unit-id mistakes and reduce shell-pipe truncation patterns.
- **Requirements:** R4, R5, R10.
- **Files:** `src/world-import/command-router.ts`, `src/world-import-normalize.test.ts` or `src/world-import.test.ts`, `skills/world-import/references/helper-tools.md`.
- **Approach:** Extend `list-units` with match/prefix filtering and `read-unit` with bounded output flags. Detect `*`, `?`, or unmatched unit ids and emit actionable guidance.
- **Patterns to follow:** Existing `list-units`, `read-unit`, and `read-slice` command output shapes.
- **Test scenarios:**
  - `list-units --match 84-h-29` returns matching units.
  - `read-unit --unit-prefix <unique-prefix>` reads the unique unit.
  - Ambiguous prefixes fail with candidate ids.
  - Wildcard-like ids fail with a helpful message.
  - Bounded reads return predictable blocks/chars without shell pipes.
- **Verification:** Targeted helper tests pass.

### U4. Fix repair summary resolved/residual accounting

- **Goal:** Make checkpoint repair artifacts accurately represent what was resolved and what remains.
- **Requirements:** R7, R10.
- **Files:** `src/world-import/types.ts`, `src/world-import/model-runner.ts`, `src/world-import.test.ts`, `docs/world-import.md`.
- **Approach:** Extend `StagedRepairSummary` with explicit attempted/resolved/residual action ids. Update repair-stage prompting to ask for structured action status, and ensure orchestrator does not copy all original findings into `residualFindings` unless they are actually residual.
- **Patterns to follow:** Current `StagedReviewCheckpoint` / `StagedRepairSummary` persistence under `stages/checkpoints/`.
- **Test scenarios:**
  - A repair response claiming all action ids resolved writes empty residuals.
  - A partial repair writes only unresolved action ids/findings as residual.
  - Missing structured action status is recorded as unverified/attempted rather than fabricated as resolved.
- **Verification:** `node --import tsx --test src/world-import.test.ts` passes.

### U5. Strengthen world-import skill and prompt tool discipline

- **Goal:** Make running models choose deterministic helper commands instead of brittle ad hoc scripts.
- **Requirements:** R2, R3, R4, R5, R8, R9.
- **Files:** `skills/world-import/SKILL.md`, `skills/world-import/references/workflow.md`, `skills/world-import/references/helper-tools.md`, `src/world-import/eval.ts`, `src/world-import-eval.test.ts`.
- **Approach:** Update skill guidance and post-merge review/repair prompts to name the new helper commands and anti-patterns. Add explicit repair-stage instruction to return action statuses. Expand intermediate review rubric to include style/tone coverage and omission/candidate-disposition visibility when grounded and bounded.
- **Patterns to follow:** Existing helper-boundary and anti-pattern sections in the skill docs.
- **Test scenarios:**
  - Prompt text includes batch helper and bounded-read guidance.
  - Post-merge review prompt can request style/tone or omission visibility repairs without making them mandatory.
  - Parser continues to treat malformed review output as non-authoritative.
- **Verification:** `node --import tsx --test src/world-import-eval.test.ts` passes.

### U6. Add run-log review fixture or regression notes

- **Goal:** Preserve the lessons from `world-output/frankenfrankenstein` without committing bulky generated output.
- **Requirements:** R1, R6, R10.
- **Files:** `docs/world-import.md`, optional small fixture under `src/` test support if needed.
- **Approach:** Add a concise documented “observed anti-patterns” note or a small synthetic test fixture representing the errors: inline Python batch write, wildcard unit id, `head`/`tail` read truncation, and stale residual findings.
- **Patterns to follow:** Existing smoke-test and world-import debugging sections.
- **Test scenarios:** Documentation-only unless a compact fixture is added.
- **Verification:** Reader can understand what to avoid and which helper to use instead.

---

## Verification Contract

| Gate | Command | Applies to | Done signal |
|---|---|---|---|
| Helper tests | `node --import tsx --test src/world-import.test.ts` | U2, U3, U4 | Batch writing, unit lookup, bounded reads, and repair accounting pass. |
| Eval/prompt tests | `node --import tsx --test src/world-import-eval.test.ts` | U5 | Intermediate review prompt/parser coverage remains green. |
| Full test suite | `npm test` | All units | Existing regressions remain green. |
| TypeScript build | `npm run build` | All units | New helper/types compile. |
| Manual Herdr smoke | Run a small staged import with transcript enabled | U1-U6 | Pane output is compact enough to monitor; durable transcript/checkpoint artifacts allow post-run review. |

---

## Definition of Done

- Long Herdr world-import runs have a documented durable transcript path.
- Running models have helper commands for batch artifact writes, safe unit lookup, and bounded reads.
- Skill and prompt guidance explicitly directs models away from inline Python/JSON glue when helpers exist.
- Repair checkpoint summaries accurately separate attempted, resolved, and residual work.
- Intermediate review can surface grounded style/tone and omission-visibility gaps.
- Tests cover helper ergonomics and checkpoint accounting.
