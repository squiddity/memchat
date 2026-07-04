---
title: "feat: Add model-owned staged session orchestration to world-import"
type: feat
date: 2026-07-02
origin: conversation
---

# feat: Add model-owned staged session orchestration to world-import

## Summary

Evolve the repo's `world-import` runner so it can invoke the model-owned import workflow across separate pi sessions for extraction, merge/repair, and review, without turning the runner into a semantic pipeline. The skill remains the source of workflow judgment and stays usable as a single-session instruction set for users who point any capable agent at the skill and helper commands directly.

The harness should provide context boundaries and operational convenience; the model should continue to decide entity identity, merge meaning, candidate dispositions, artifact prose, retcon/conflict handling, style guidance, lint repair choices, and final import summary.

## Problem Frame

The current model-backed CLI creates one pi `AgentSession` in `src/world-import/model-runner.ts` and sends one `/skill:world-import ...` prompt for the entire normalize/extract/merge/emit/lint workflow. That works with large-context models such as DeepSeek's 1M-window variants, but it encourages very long single turns and makes it harder to deliberately reset context between conceptually different phases.

Reviewer eval already runs in a separate pi session via `src/world-import/eval.ts`, but that split is helper-owned and only happens after the import has completed. The main import still couples extraction and merge decisions into one conversational context.

We want our repo runner to support staged sessions while preserving the package-first, skill-first design:

- a direct user or external agent can still run the whole workflow from `skills/world-import/SKILL.md` in one session;
- the repo's CLI can choose to run the same model-owned workflow in multiple sessions;
- deterministic TypeScript remains operational only: session setup, prompt dispatch, file handoff, summary/status capture, and structural checks.

## Scope

### In scope

- Add an explicit stage vocabulary to model-facing skill instructions.
- Add runner orchestration for three sessions: extraction, merge/repair, review.
- Preserve single-session/full-workflow invocation as a supported path.
- Add CLI flags and docs for staged vs single-session strategies.
- Keep reviewer-model scoring from being accidentally skipped when a model is available.
- Add tests for prompt rendering, option parsing/defaults, and orchestration ordering using stubs/mocks where feasible.

### Out of scope

- Deterministic extraction, deterministic merge, or deterministic ontology decisions.
- Replacing the world-import skill with hard-coded TypeScript stage logic.
- Changing the stage envelope contracts except for optional metadata that records orchestration/session information.
- Solving all current provenance/lint quality issues as part of this session orchestration change.
- Building a full pi runtime replacement stack unless the simple `createAgentSession` approach proves insufficient.

## Requirements

- R1. The skill must remain runnable end-to-end in one session with the existing helper commands.
- R2. The repo runner must be able to run extraction, merge/repair, and review in separate pi sessions.
- R3. Stage boundaries must be model-facing instructions, not deterministic semantic gates.
- R4. Stage handoff must happen through the existing output directory artifacts: `sources/`, `stages/extraction/`, `stages/merge/`, `world/`, and `stages/review.json`.
- R5. The extraction session must normalize and write extraction stages, then stop without merging.
- R6. The merge session must consume extraction stages, decide artifacts/dispositions, emit markdown, run lint, repair or explicitly explain diagnostics, and stop without reviewer scoring.
- R7. The review session must evaluate the emitted bundle with a reviewer model when configured/defaulted, write `stages/review.json`, and summarize semantic findings.
- R8. If no `--reviewer-model` is provided, reviewer scoring should default to the active import model unless explicitly disabled.
- R9. The runner should make session boundaries observable in debug output and final summaries.
- R10. The CLI should provide an escape hatch for the current single-session behavior.
- R11. The implementation should not require users invoking the skill outside this runner to understand the runner's orchestration details.

## Key Decisions

### KTD1. Use one skill with optional stage hints, not separate semantic implementations

Add optional `stage` input to the existing `world-import` skill contract:

- `full` or omitted: current end-to-end workflow.
- `extract`: normalize/list/read source units, write extraction stages, then stop.
- `merge`: inspect normalized sources/extraction stages/existing world state, write merge stage, emit, lint, repair as appropriate, then stop before reviewer scoring.
- `review`: inspect emitted world, run/coordinate eval, and summarize review output.

These are prompts to the model, not deterministic modes that decide content. This keeps direct agent usage simple: a user can still say `/skill:world-import { input, output }` and get the full workflow.

### KTD2. The runner orchestrates sessions; artifacts are the handoff protocol

The staged runner should create fresh sessions between phases and pass only a focused stage prompt plus the output root. The durable handoff is the existing output tree. The model in each stage uses helper commands to inspect the artifacts it needs.

This keeps the harness from summarizing or reinterpreting stage output. It also keeps session context smaller without inventing a second model of the world inside TypeScript.

### KTD3. Default the repo CLI to staged, keep single-session available

The repo's import harness should use staged sessions by default once implemented, because that is the safer experimental posture for large imports. Add an escape hatch such as:

```bash
npm run world-import-run -- --session-strategy single --input ... --output ... --model ...
# or
npm run world-import-run -- --single-session --input ... --output ... --model ...
```

The exact flag shape can be finalized during implementation, but docs should make the default and escape hatch clear.

### KTD4. Reviewer eval remains model-backed, but can be invoked as the third stage

The current reviewer helper already creates a separate model session and writes `stages/review.json`. For staged orchestration, the third stage should be explicitly represented in runner/debug output and skill guidance so reviewer scoring is not an afterthought.

Two acceptable implementation shapes:

1. **Skill-prompt review stage:** create a third import session and ask the model to run `world-import-helper eval` and summarize results.
2. **Helper review stage:** call `runReviewerModelEvaluation(...)` as today, but label it as stage 3 and ensure default reviewer-model selection prevents accidental skip.

Prefer option 1 only if it materially improves model-owned repair/review behavior. Otherwise, option 2 is acceptable because the semantic reviewer itself is still model-backed and isolated in its own pi session.

### KTD5. Context management should be visible before it is clever

Do not introduce automatic semantic compaction or model-written handoff summaries as a first step. Stage boundaries and file artifacts are already strong context controls. Add debug/status output such as:

- `starting stage extract session`
- `extract session completed; extractionStages=N`
- `starting stage merge session`
- `merge session completed; worldMarkdownFiles=N`
- `starting stage review session`

If later runs show context pressure within a stage, add model-owned checkpoint prompts or pi compaction hooks as a follow-up.

## Proposed User-Facing Behavior

### Default staged run

```bash
npm run world-import-run -- \
  --input samples/pg120-images-3.epub \
  --output world-output/pg120-images-3-$(date +%Y%m%d-%H%M%S) \
  --model openrouter/deepseek/deepseek-v4-pro \
  --show-tool-updates
```

Expected high-level phases:

1. Session A: `/skill:world-import { stage: "extract", input, output, helperCommand, dryRun }`
2. Session B: `/skill:world-import { stage: "merge", input, output, helperCommand, dryRun: false }`
3. Session C or reviewer helper session: review/eval using `reviewerModel` defaulted to the active import model.

### Direct skill full run remains valid

```text
/skill:world-import {"input":"./sources","output":"world-output/my-corpus"}
```

The skill should continue to tell the model how to perform the whole workflow in one session.

### Single-session runner escape hatch

```bash
npm run world-import-run -- \
  --session-strategy single \
  --input samples/pg120-images-3.epub \
  --output /tmp/world-single \
  --model openrouter/deepseek/deepseek-v4-pro
```

This should use the current one-session `session.prompt(...)` behavior.

## Implementation Units

### U1. Add model-facing stage vocabulary to the world-import skill

- **Files:** `skills/world-import/SKILL.md`, `skills/world-import/references/workflow.md`, `docs/world-import.md`.
- **Change:** Document optional `stage` input and stage-specific stopping points.
- **Important boundary:** The skill must say stages are orchestration hints. A model may still inspect all needed artifacts and make semantic decisions; helper code does not own those decisions.
- **Tests:** No direct unit tests required, but docs should be reviewed for preserving the full workflow path.

### U2. Extend prompt rendering with stage metadata

- **Files:** `src/world-import/model-runner.ts`, `src/world-import.test.ts`.
- **Change:** Extend `renderWorldImportSkillInvocation(...)` to optionally include `stage`.
- **Tests:** Assert that stage is omitted for legacy/full prompts unless requested, and included for staged prompts.

### U3. Refactor session creation into a reusable stage runner

- **Files:** `src/world-import/model-runner.ts`.
- **Change:** Extract common session setup/subscription/model selection into an internal function such as `runWorldImportModelPrompt(stageOptions)`.
- **Boundary:** This function should only run a prompt and stream events; it should not interpret import artifacts beyond status summaries.
- **Tests:** Prefer pure-function coverage for prompt/status helpers; integration test with real pi sessions is not required for unit tests.

### U4. Add staged orchestration in the CLI runner

- **Files:** `src/world-import-cli.ts`, `src/world-import/model-runner.ts`, `src/world-import.test.ts`.
- **Change:** Add a session strategy option, defaulting to staged for the CLI once ready, with single-session escape hatch.
- **Staged behavior:**
  - run extract prompt in fresh session;
  - inspect deterministic output summary;
  - run merge prompt in fresh session;
  - inspect deterministic output summary;
  - run reviewer stage if reviewer model is available/defaulted and not disabled.
- **Failure handling:** If extract produces no extraction stages or merge produces no world markdown, return the existing warning style and do not hide the failure behind later stages.
- **Tests:** Use injectable session/prompt runner stubs to assert ordering and stop-on-failure behavior without invoking providers.

### U5. Make reviewer behavior explicit and non-skipping by default

- **Files:** `src/world-import-cli.ts`, `src/world-import/command-router.ts`, `src/world-import-cli-format.ts`, `docs/cli.md`, `docs/world-import*.md`.
- **Current status:** The CLI-side default to active import model has already been added in this branch. Implementation should verify it remains compatible with staged orchestration.
- **Change:** Add an explicit disable if desired, e.g. `--no-reviewer` or `--reviewer-model off`, so skipping is intentional rather than accidental.
- **Tests:** Reviewer model resolution should cover explicit reviewer, fallback to import model, env fallback, and explicit disable.

### U6. Update TTY-safe wrapper docs after staged flags settle

- **Files:** `scripts/world-import-run.sh`, `package.json`, `README.md`, `docs/cli.md`, `docs/world-import-run-guide.md`.
- **Current status:** The TTY-safe wrapper already exists in this branch and is documented.
- **Change:** Once staged flags are final, update examples to show the default staged behavior and the single-session escape hatch.
- **Tests:** Keep the wrapper thin; test `npm run world-import-run -- --help` manually or via a lightweight spawn test if worth the maintenance cost.

## Test Plan

- Unit: `src/world-import-cli-format.test.ts` for reviewer model resolution and disable semantics.
- Unit: `src/world-import.test.ts` for skill prompt rendering with and without stage.
- Unit: new orchestration tests for staged ordering using a fake model prompt runner and fake output summaries.
- Existing: `src/world-import-eval.test.ts` remains the reviewer-eval coverage anchor.
- Existing: `src/world-import.test.ts` helper command flow remains unchanged; staged orchestration should not alter helper contracts.
- Smoke: run a dry-run or tiny HTML fixture through `--session-strategy staged` to verify the three-stage control flow without paying for a large model import.

## Risks and Mitigations

- **Risk: Stage prompts become too narrow and prevent model judgment.** Mitigation: word stages as stopping points, not rigid deterministic subcommands; retain the full workflow instructions.
- **Risk: Merge stage lacks extraction context after session reset.** Mitigation: require merge prompt to inspect `manifest.json`, extraction stage files, and relevant source slices through helper commands; do not depend on previous chat history.
- **Risk: Review stage becomes deterministic-only.** Mitigation: keep reviewer model evaluation active by default and report when skipped only through explicit opt-out or deterministic-check failure.
- **Risk: Existing users prefer the current one-session behavior.** Mitigation: keep `stage` optional and provide `--session-strategy single` / equivalent escape hatch.
- **Risk: More sessions increase provider overhead.** Mitigation: document the trade-off and make strategy configurable.

## Open Questions

- OQ1. Exact CLI flag shape: `--session-strategy staged|single`, `--single-session`, or both?
- OQ2. Should staged become the default immediately, or should it ship behind an opt-in flag for one round of manual testing?
- OQ3. Should review stage be a skill-prompted session that invokes eval, or should the runner call the existing `runReviewerModelEvaluation` helper and label it as stage 3?
- OQ4. Should reviewer disable be `--no-reviewer`, `--reviewer-model off`, or both?

## Recommended Next Step

Implement U1–U4 behind an explicit `--session-strategy staged` opt-in first, keep the existing single-session behavior as default for one smoke-test cycle, then flip the CLI wrapper docs/default to staged after one successful sample run. This reduces risk while preserving the intended direction.
