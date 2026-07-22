# Mem-import weekly plan consolidation

## Purpose

This index resolves overlap among the July 20–22 mem-import plans. It is the current roadmap map, not a replacement for their detailed designs.

## One boundary in three layers

### 1. Installation acceptance

**Authority:** [Acceptance Simplification and Runtime Safety](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md) and `skills/mem-import/references/acceptance.md`.

Acceptance asks whether an exact adapter/profile can expose and invoke the production tools needed by an import. The harness independently materializes each tiny tracked fixture and permits one specified production-tool call. Host catalog, allowlist, lifecycle, extension, and resume evidence must be exact.

Acceptance never uses a free-running corpus coordinator, chains semantic stages, finalizes a probe run, imports Alice, or measures semantic quality.

### 2. Real import runtime

**Authority:** `skills/mem-import/SKILL.md`, its role/workflow references, and the still-relevant golden-path portions of [Mem-import Simplification](2026-07-20-mem-import-simplification.md).

After acceptance, the parent launches one corpus coordinator. Real workers remain assignment-bound, host-observed, and ledger-driven. Cached acceptance never replaces per-dispatch authorization or exact-profile evidence.

### 3. Integration, quality, and efficiency evaluation

**Authority:** [Efficiency and Legacy Parity](2026-07-21-001-fix-mem-import-efficiency-parity-plan.md).

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

- tracked acceptance fixture pack and independent materializer;
- focused acceptance runner and Pi SDK adapter;
- exact call-count, argument, model/thinking, tool-profile, durable-effect, and sanitized-receipt validation;
- terminal-state guards, no-op rejection, weighted limits, and bounded effect inventory;
- host-attested `pi-herdr-subagents` launch profiles, exact active/denied telemetry, and profile-preserving resume;
- active guidance separating focused acceptance from corpus execution.

Historical DeepSeek coordinator-driven attempts are rejected diagnostics, not acceptance evidence. See the [superseded hardening handoff](2026-07-22-mem-import-subagent-hardening-handoff.md).

## Remaining roadmap

1. Add or finish an adapter-specific focused acceptance host for any production adapter not represented by the Pi SDK fingerprint; do not model-coordinate it.
2. Keep acceptance receipts fingerprinted by adapter/runtime, extensions, model/thinking, tool schema, fixture, and source revision.
3. Implement efficiency-plan U4–U7 for real imports: phase-bounded coordinators, identity-aware planning, demand-driven reads, and usage telemetry.
4. Run Alice evaluation only when explicitly requested after those runtime changes.
5. Remove legacy `world-import` surfaces under the older orchestration cleanup plan when its migration gate is reached.

## Documentation authority map

- `skills/mem-import/SKILL.md`: short role branch and corpus coordinator behavior.
- `skills/mem-import/references/parent-preflight.md`: parent-only acceptance check and coordinator launch.
- `skills/mem-import/references/acceptance.md`: harness contract and exclusions.
- `skills/mem-import/references/subagent-capabilities.md`: host profile and resume requirements.
- `skills/mem-import/references/adapters/*.md`: adapter mechanics only.
- `skills/mem-import/references/workflow.md`: real corpus coordinator decisions only.
- `docs/plans/2026-07-21-002-*`: acceptance decision history.
- `docs/plans/2026-07-21-001-*`: real-import optimization/evaluation roadmap.

Do not duplicate the acceptance sequence in top-level docs or role files; link to the authority instead.
