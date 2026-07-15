---
title: "feat: Add portable world-import invocation audit trails"
type: feat
date: 2026-07-15
origin: follow-up review of the successful Alice staged import
---

# feat: Add portable world-import invocation audit trails

## Summary

Record which models and model-facing invocations produced a world-import bundle. Add one TypeScript-owned, machine-readable run ledger at `stages/import-run.json`, and project a concise human-readable summary into `world/log.md` after orchestration finishes.

The audit will use the confirmed **compact audit** and **portable/redacted path** policies:

- retain model roles, requested and resolved model ids, effective thinking levels, stage/checkpoint context, timings, outcomes, canonical redacted skill invocations, and prompt hashes;
- do not duplicate corpus-sized reviewer prompts or full model responses;
- do not retain local working directories, account names, output paths, auth-file paths, tokens, environment values, or other credential material;
- retain only the portable source basename and content-derived hashes needed to identify the imported source.

The semantic extraction, merge, and artifact packets remain model-owned. Execution metadata stays in the orchestrator-owned audit ledger.

---

## Problem

A successful staged import currently leaves several useful but incomplete traces:

- terminal transcripts can show model selection, thinking level, prompt text, and stage transitions, but they are external to the generated bundle and may not be retained;
- `WorldImportRunResult.stages` contains stage names and some resolved model labels in memory, but the result is not persisted;
- post-merge checkpoints and `stages/review.json` identify reviewer models in some paths, but they do not provide one ordered account of every model invocation;
- `world/log.md` records emitted artifact, source, and citation counts, but not the models, workflow, repair invocations, verification result, or final reviewer result;
- `world/log.md` is generated during emission, before final semantic review, so it cannot currently summarize the completed staged run.

For example, the latest Alice run used the same requested model for several distinct roles, but with different effective settings:

1. extract with high thinking;
2. merge with high thinking;
3. post-merge semantic review with thinking off;
4. semantic repair with high thinking;
5. final reviewer evaluation with low thinking.

That execution history should travel with the imported bundle without requiring access to the original TTY transcript.

---

## Goals

1. Persist a complete ordered audit of model invocations for successful, partial, failed, dry-run, staged, and single-session imports.
2. Record both requested and actually resolved model ids and the effective thinking level at invocation time.
3. Distinguish import skill calls, recovery/repair skill calls, post-merge review, and final evaluation.
4. Preserve the stage/checkpoint/iteration context and observable outcomes of each invocation.
5. Keep the audit compact by storing canonical redacted invocation text plus prompt and response hashes rather than large duplicated prompts or responses.
6. Make the most useful details readable in `world/log.md` while keeping `stages/import-run.json` authoritative.
7. Persist lifecycle changes atomically so an interrupted import still explains which invocation was active.
8. Keep local paths and credential configuration private and keep semantic stage packets free of orchestration metadata.

## Non-goals

- Capturing hidden provider-side sampling settings, deployment revisions, request routing, or other values the runtime does not expose.
- Persisting API keys, auth tokens, credential file paths, environment values, usernames, home directories, or working directories.
- Persisting full intermediate/final reviewer prompts that duplicate retained source and emitted Markdown.
- Persisting model thinking text or complete assistant responses in the audit ledger.
- Replacing terminal transcripts, checkpoint packets, review results, or semantic provenance.
- Adding execution metadata to each model-authored extraction candidate or artifact packet.
- Guaranteeing bit-for-bit reproducibility of a hosted model response.

---

## Confirmed Policy Decisions

### Invocation detail: compact audit

For world-import skill sessions, retain a canonical redacted `/skill:world-import` invocation and the SHA-256 of the exact model-facing prompt. For generated post-merge and final reviewer prompts, retain a stable prompt-builder identifier, exact prompt SHA-256, and prompt character count, but not the complete corpus-sized prompt.

For responses, retain character count and SHA-256. Full reviewer text remains where the existing review/checkpoint formats already store it; import/merge narrative responses remain available in an explicitly requested transcript rather than being duplicated into the bundle.

### Path and credential privacy: portable and redacted

Retain:

- source basename;
- normalized/source aggregate hashes;
- credential configuration mode such as `explicit-auth-file`, `project-default`, or `provider-environment-available` only when it can be determined without exposing values;
- package version, optional Git revision, and skill/prompt hashes.

Do not retain:

- absolute or relative input/output paths beyond the source basename;
- current working directory or package root;
- auth-file or model-registry paths;
- account/user names;
- credential values or environment variable values;
- raw error messages until they have passed path/secret redaction.

---

## Proposed Output

### `stages/import-run.json`

Add one atomic, TypeScript-owned run ledger:

```json
{
  "version": 1,
  "kind": "world-import-run",
  "runId": "20260715T000000Z-a1b2c3d4",
  "status": "completed",
  "startedAt": "2026-07-15T00:00:00.000Z",
  "completedAt": "2026-07-15T00:46:29.000Z",
  "source": {
    "name": "Alice_Adventures_in_Wonderland.epub",
    "contentHash": "sha256:...",
    "normalizedUnits": 13
  },
  "workflow": {
    "sessionStrategy": "staged",
    "dryRun": false,
    "maxRepairIterations": 1
  },
  "software": {
    "packageVersion": "0.1.0",
    "gitRevision": "a1f526a",
    "worldImportSkillHash": "sha256:...",
    "promptContractVersion": 1
  },
  "credentials": {
    "configuration": "explicit-auth-file"
  },
  "invocations": [],
  "result": {
    "stageSequence": ["extract", "merge", "merge-readiness", "post-merge-review", "repair", "merge-readiness", "post-merge-verify", "review"],
    "outputSummary": {},
    "checkpointStatus": "verified-repaired",
    "deterministicPassed": true,
    "reviewerScore": 5
  }
}
```

The ledger is a current-run record because a world-import output root represents one import attempt and fresh output roots are the documented workflow. Historical multi-run maintenance ledgers can be introduced later if maintained-world updates require them.

### Invocation records

Each model call receives a monotonically ordered invocation id and records:

- purpose: `full`, `extract`, `merge`, `merge-readiness-repair`, `post-merge-review`, `semantic-repair`, or `final-review`;
- associated orchestrator stage;
- checkpoint id and iteration when applicable;
- requested model;
- actually resolved model;
- effective thinking level;
- start/completion timestamps and duration;
- lifecycle status: `running`, `completed`, `failed`, or `skipped`;
- canonical redacted invocation descriptor;
- exact prompt SHA-256 and character count;
- response SHA-256 and character count when a response exists;
- output summary before and after the call;
- affected stage/checkpoint paths expressed relative to the output root;
- sanitized error category/message on failure.

Example skill invocation:

```json
{
  "id": "invocation-04",
  "purpose": "semantic-repair",
  "stage": "repair",
  "checkpointId": "post-merge",
  "iteration": 1,
  "requestedModel": "openai-codex/gpt-5.6-sol",
  "resolvedModel": "openai-codex/gpt-5.6-sol",
  "thinking": "high",
  "status": "completed",
  "invocation": {
    "kind": "world-import-skill",
    "canonical": "/skill:world-import {\"input\":\"Alice_Adventures_in_Wonderland.epub\",\"output\":\"<output-root>\",\"stage\":\"repair\",\"checkpointId\":\"post-merge\",\"iteration\":1}",
    "promptSha256": "sha256:...",
    "promptChars": 286
  }
}
```

Example reviewer invocation:

```json
{
  "id": "invocation-05",
  "purpose": "final-review",
  "stage": "review",
  "requestedModel": "openai-codex/gpt-5.6-sol",
  "resolvedModel": "openai-codex/gpt-5.6-sol",
  "thinking": "low",
  "status": "completed",
  "invocation": {
    "kind": "generated-review",
    "promptBuilder": "world-import-final-review-v1",
    "promptSha256": "sha256:...",
    "promptChars": 148220
  }
}
```

### `world/log.md`

Retain the existing emission summary and add a compact final projection:

```md
## Import Details

- **Source:** `Alice_Adventures_in_Wonderland.epub`
- **Workflow:** staged
- **Import model:** `openai-codex/gpt-5.6-sol`
- **Reviewer model:** `openai-codex/gpt-5.6-sol`
- **Result:** completed; deterministic checks passed; reviewer score 5
- **Audit record:** [`stages/import-run.json`](../stages/import-run.json)

## Model Invocations

| # | Purpose | Model | Thinking | Outcome |
|---|---|---|---|---|
| 1 | Extract | `openai-codex/gpt-5.6-sol` | high | completed |
| 2 | Merge | `openai-codex/gpt-5.6-sol` | high | completed |
| 3 | Post-merge review | `openai-codex/gpt-5.6-sol` | off | repair requested |
| 4 | Semantic repair | `openai-codex/gpt-5.6-sol` | high | completed |
| 5 | Final review | `openai-codex/gpt-5.6-sol` | low | score 5 |
```

The table shows resolved models. If requested and resolved values differ, the human summary notes both; the JSON always retains both fields.

---

## Design

### TypeScript-owned run ledger

Add explicit run/invocation audit types in the world-import type layer and atomic staging helpers for reading and writing `stages/import-run.json`. Do not expand `StageEnvelope` or require models to author execution metadata.

Initialize the ledger before the first model session. Update it before and after each model call. Use the existing same-directory atomic JSON replacement so an interruption leaves either the previous complete lifecycle state or the next complete one.

### Model resolution and effective settings

Capture actual model and thinking only after the pi session has resolved the requested model and applied the thinking level. Requested values come from orchestration options; resolved values come from the active session. This avoids treating a configured alias/default as proof of the model actually used.

The post-merge reviewer uses thinking `off` for direct, bounded gap finding; final review uses `low` thinking for stronger structured QA consistency. The audit records each session's effective value rather than duplicating assumptions in the orchestrator.

### Prompt descriptors and hashes

Compute hashes inside the component that constructs the exact prompt:

- `runWorldImportModelPrompt()` hashes the exact `/skill:world-import` prompt and also produces a separately canonicalized/redacted display form;
- `runPostMergeReviewEvaluation()` identifies and hashes the exact generated post-merge prompt;
- `runReviewerModelEvaluation()` identifies and hashes the exact final reviewer prompt.

Use stable prompt-builder identifiers with explicit versions so a hash can be interpreted later. Hash the loaded world-import skill and its reference files in sorted path order. Record package version and an optional Git revision when available, but do not make Git a runtime requirement.

### Orchestrator lifecycle

The orchestrator remains responsible for invocation ordering and outcomes:

1. Create the run ledger with status `running` before extraction/full-session work.
2. Add a `running` invocation before each model prompt.
3. Update it with resolved model, thinking, hashes, timing, output summary, and completion/failure.
4. Include recovery and semantic repair attempts as separate invocation records with checkpoint context.
5. Record deterministic stage sequence entries in the final result, but do not mislabel readiness/lint/verification as model invocations.
6. On normal completion, write final readiness/checkpoint/reviewer outcomes and status `completed`.
7. On error, write status `failed`, preserve completed invocation records, sanitize the active error, and rethrow.
8. On dry-run completion, write status `dry-run-completed` or an equivalently explicit terminal status.

### Refreshing `world/log.md`

Split log rendering/writing from the destructive semantic `emitWorldLibrary()` operation. The emitter may continue to create the initial log, but orchestration must refresh only `world/log.md` after:

- post-merge verification;
- final reviewer evaluation;
- terminal failure when a world directory already exists;
- normal no-reviewer completion.

The refresh reads the merge/manifest/run ledger and rewrites only the deterministic log file. It must not re-emit or alter semantic concept pages merely to update execution metadata.

If a manual helper-only emit has no `stages/import-run.json`, preserve the existing log behavior and omit the invocation sections or state that no orchestrated run audit is available.

### Privacy and redaction

Build canonical invocation JSON from an allowlist rather than attempting to redact an arbitrary command string after the fact. The allowlist may include source basename, stage, dry-run, reviewer model, checkpoint id, and iteration. Replace output and helper paths with stable placeholders.

Apply an allowlist to credential metadata as well. Record configuration mode, never the resolved auth path or credential value. Sanitize errors before persistence; raw provider errors can contain URLs, request details, or local paths.

Add a final defensive scan in tests using sentinel cwd/auth/input-parent values to prove they do not occur anywhere in the audit or `world/log.md`.

---

## Implementation Units

### U1. Define the audit schema and atomic staging API

**Files:** `src/world-import/types.ts`, `src/world-import/staging.ts`

- Add versioned run and invocation types.
- Add `importRunPath()`, `readImportRun()`, and `writeImportRun()`.
- Define terminal and in-progress statuses explicitly.
- Keep all paths inside the audit output-root-relative.
- Reuse atomic `writeJson()`.

### U2. Add canonicalization, hashing, and privacy helpers

**Files:** likely a focused `src/world-import/run-audit.ts` plus tests

- Generate run ids.
- Produce portable source identity and aggregate hashes.
- Produce canonical redacted skill invocation strings from allowlisted fields.
- Hash exact prompts/responses and the skill/reference contract.
- Detect package version and optionally Git revision without requiring Git.
- Sanitize error records and credential configuration.

### U3. Instrument import skill invocations

**Files:** `src/world-import/model-runner.ts`

- Create and update invocation records around `full`, `extract`, `merge`, and each `repair` call.
- Return resolved model, effective thinking, prompt descriptor, and response digest from the low-level model prompt runner.
- Record failed worker calls before durable-state reassessment and preserve recovery iteration context.
- Keep deterministic readiness and verification in the run's stage sequence/result, not the invocation list.

### U4. Instrument post-merge and final reviewer invocations

**Files:** `src/world-import/eval.ts`, related result types

- Capture actual resolved reviewer model and thinking.
- Version and hash generated prompts without persisting full prompts.
- Return invocation metadata to orchestration while preserving existing checkpoint and evaluation formats.
- Record skipped reviewer paths without pretending a model was invoked.

### U5. Render the final human-readable log

**Files:** `src/world-import/emit.ts` or a focused log module, `src/world-import/model-runner.ts`

- Extend `renderLog()` from run-ledger data.
- Preserve existing artifact/source/citation summary.
- Add import details and model invocation table.
- Link to `../stages/import-run.json` using a portable relative path.
- Refresh the log at terminal orchestration boundaries without re-emitting concept pages.

### U6. Document and test the contract

**Files:** `docs/world-import.md`, `docs/smoke-tests.md`, world-import runner/emitter/eval tests

- Document the ledger schema, privacy boundary, and log projection.
- Test staged success, repair, recovery, final review, no-reviewer, single-session, dry-run, and failed invocation flows.
- Test requested/resolved model differences and effective thinking values.
- Test prompt/response digest stability and prompt-builder ids.
- Test that final reviewer score and repair verification appear after log refresh.
- Test manual helper emission without a run ledger.
- Test path/credential/secret sentinels never appear.

---

## Acceptance Criteria

1. A successful staged import contains `stages/import-run.json` with every actual model invocation in execution order.
2. Each invocation records purpose, requested model, resolved model, effective thinking, timing, outcome, and a compact prompt descriptor/hash.
3. Recovery and semantic repair calls are separate records with checkpoint id and iteration.
4. Post-merge review accurately shows thinking `off`; final review accurately shows thinking `low`, reflecting each effective session value.
5. Deterministic readiness/lint/verification stages appear in the final stage sequence but not as fake model calls.
6. `world/log.md` includes source/workflow/result details and a readable model invocation table after final review.
7. The log links to the authoritative run ledger.
8. Interrupted/failed runs retain an atomic ledger showing completed invocations and the active failed invocation.
9. Full generated reviewer prompts, full responses, thinking text, credential values, auth paths, cwd, package root, and output path are absent.
10. Input identity is portable: source basename plus content-derived hashes, not a machine-local path.
11. Manual helper-only emission remains supported when no run ledger exists.
12. Existing extraction, merge, checkpoint, verification, and evaluation contracts remain valid.

---

## Risks and Mitigations

- **Audit writes become a failure source:** Treat audit initialization and updates as required for orchestrated imports, use the existing atomic writer, and add focused error messages. Avoid partially valid JSON.
- **Final log is stale:** Refresh it after final review and in terminal no-reviewer/failure paths rather than relying only on model-triggered emission.
- **Sensitive data leaks through canonical strings or errors:** Construct display invocations from allowlisted fields; sanitize errors; run sentinel tests against every persisted audit/log string.
- **Prompt hashes are not interpretable after code changes:** Record prompt-builder version, package version, skill hash, and optional Git revision.
- **Requested model is mistaken for actual model:** Record both and derive the resolved value from the active session after model selection.
- **Large or noisy audit files:** Store only compact descriptors, hashes, counts, timings, and summaries; keep full transcripts opt-in and external.
- **Mock runners lack low-level model metadata:** Define test-friendly invocation result fields and deterministic fallbacks without claiming a model was resolved when it was not.
- **Reusing an output root overwrites history:** Continue documenting fresh output roots. Defer a multi-run history directory until maintained-world updates need it.

---

## Validation

Run focused checks:

```bash
node --import tsx --test src/world-import.test.ts
node --import tsx --test src/world-import-emit.test.ts
node --import tsx --test src/world-import-eval.test.ts
npm run build
npm test
git diff --check
```

Then run one fresh Alice staged import and confirm:

- the ledger contains extract, merge, post-merge review, any requested repair, and final review invocations;
- resolved models and thinking levels match the observed runtime;
- final checkpoint and score appear in both the ledger and `world/log.md`;
- the generated files contain no cwd, account name, auth path, or credential value;
- deterministic lint/eval still pass.

---

## Expected Files

- New: `src/world-import/run-audit.ts` and focused tests if separation remains useful.
- Modified: `src/world-import/types.ts`
- Modified: `src/world-import/staging.ts`
- Modified: `src/world-import/model-runner.ts`
- Modified: `src/world-import/eval.ts`
- Modified: `src/world-import/emit.ts` or a focused log renderer
- Modified: `src/world-import.test.ts`
- Modified: `src/world-import-emit.test.ts`
- Modified: `src/world-import-eval.test.ts`
- Modified: `docs/world-import.md`
- Modified: `docs/smoke-tests.md`

No implementation is included in this plan document.
