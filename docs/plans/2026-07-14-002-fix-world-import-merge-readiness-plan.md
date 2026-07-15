# World-import merge readiness and bounded recovery plan

## Problem

Two fresh Alice imports completed extraction but did not complete merge:

- The Codex merge session spent its turn inspecting and planning, wrote no artifact, then returned normally. The runner treated zero Markdown files as a successful stopping point and skipped review.
- The DeepSeek merge session persisted a people-only partial merge, repeatedly changed strategies, then debugged a monolithic generated JavaScript file until the terminal run was interrupted. Its durable state was incomplete and had no orchestrator checkpoint.

“Stalled during merge” therefore means **the model remained active without making sufficient durable progress toward a ready merge**. It was not a provider timeout. In the DeepSeek run it ended with SIGINT; in the Codex run the model voluntarily returned.

## Goals

1. Make the first merge pass persist useful state early instead of designing one enormous transformation.
2. Give models a bounded, atomic artifact-batch helper so progress survives later failures.
3. Replace the `worldMarkdownFiles > 0` gate with deterministic merge readiness.
4. Feed concise lint and coverage diagnostics back through the existing repair-stage checkpoint contract.
5. Bound recovery attempts and refuse to run semantic review/final eval on structurally incomplete output.
6. Keep entity identity, grouping, dispositions, prose, links, and provenance decisions model-owned.

## Design

### Skill workflow

- On `stage: merge`, inspect extraction inventory once, choose canonical artifact IDs, and start writing bounded JSON artifact batches before authoring corpus-level synopsis prose.
- Use `write-artifacts` with small batches. Do not generate executable JavaScript/Python or one giant merge packet.
- Treat an existing merge as a resume checkpoint: preserve valid artifacts and upsert only unfinished or diagnosed work.
- Run coverage after durable batches, then emit/lint once the inventory is substantially accounted for.
- On `stage: repair`, read the persisted readiness/review packet and address only the listed diagnostics.

### Deterministic helper

Add `write-artifacts`, an atomic batch equivalent of `write-artifact`. It validates every model-authored packet, understands all IDs in the batch as planned link targets, and writes the merge stage only after the whole batch passes. It performs no semantic transformation.

### Merge readiness

After each merge-model attempt:

1. Inspect durable output even if the model worker rejected.
2. Require a parseable, non-empty merge stage.
3. Emit from the persisted stage.
4. Require deterministic lint to pass.
5. Require coverage/candidate-accounting diagnostics to have no errors.
6. Persist a compact readiness checkpoint and repair summary.

If not ready, invoke a bounded `stage: repair` session with that checkpoint. Reassess after the repair. Stop on readiness, unchanged diagnostic fingerprint, or exhausted budget. Only ready output proceeds to post-merge semantic review and final eval.

### Bounds

- Default to two total merge attempts: one initial merge plus one deterministic recovery pass, reusing the existing `stagedReview.maxRepairIterations` configuration for the recovery cap.
- Keep the existing semantic post-merge repair bounded to one pass.
- Persist residual diagnostics and throw an explicit error when readiness cannot be achieved; never silently return zero/partial output as success.

## Validation

- Unit-test atomic batch writes and cross-batch planned IDs.
- Test zero-output recovery, partial deterministic failure recovery, readiness success after retry, worker rejection with durable state, unchanged diagnostics, and exhausted budget.
- Run `npm run build`, targeted world-import tests, then `npm test`.
