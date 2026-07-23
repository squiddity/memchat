# Mem-import weekly plan consolidation

## Purpose

This index resolves overlap among the July 20–22 mem-import plans. It is the current roadmap map, not a replacement for their detailed designs.

## One boundary in three layers

### 1. Installation acceptance

**Authority:** `skills/mem-import/references/acceptance.md` and `skills/mem-import/references/facility-recipes.md`.

The parent chooses an available subagent facility and asks only whether it has a good chance of supporting the planned import. It reuses a matching local/known recipe or runs one brief disposable launch, with at most one nested child and one harmless tool call when needed. Evidence is capability-oriented and may vary by extension.

Acceptance never requires a custom programmatic adapter, exhaustive role probes, a semantic pipeline, finalization, Alice, or quality measurement. The July 21 fixture-backed runner remains optional maintainer conformance.

### 2. Real import runtime

**Authority:** `skills/mem-import/SKILL.md`, its role/workflow references, and the still-relevant golden-path portions of [Mem-import Simplification](2026-07-20-mem-import-simplification.md).

After brief acceptance, the parent launches one corpus coordinator. Real workers remain assignment-bound and ledger-driven, using the strongest lifecycle/tool evidence the selected facility exposes. A cached recipe never replaces per-dispatch authorization or exact requested tool profiles.

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

- extension-agnostic brief acceptance and local/known facility recipe guidance;
- optional tracked fixture pack, focused conformance runner, and Pi SDK maintainer adapter;
- conformance validation for call count, arguments, model/thinking, tool profile, durable effects, and sanitized receipts;
- terminal-state guards, no-op rejection, weighted limits, and bounded effect inventory;
- host-attested `pi-herdr-subagents` launch profiles, exact active/denied telemetry, and profile-preserving resume;
- active guidance separating brief facility acceptance, optional maintainer conformance, and corpus execution;
- artifact-led phase-bounded coordination across four fresh coordinator contexts with typed durable startup/exit gates;
- immutable extraction-snapshot-bound cluster plans with model-owned cross-unit identity/coherent shards, plan-derived worker scopes, reconciliation dependencies, and merge-readiness enforcement.

Historical DeepSeek coordinator-driven attempts are rejected diagnostics, not acceptance evidence. See the [superseded hardening handoff](2026-07-22-mem-import-subagent-hardening-handoff.md).

## Remaining roadmap

1. Let real imports accumulate small sanitized facility recipes; version-control only broadly useful examples.
2. Implement efficiency-plan U6–U7 for real imports: demand-driven reads and usage telemetry. U4 phase-bounded coordination and U5 identity-aware planning are complete.
3. Run a tiny artifact-led import to validate the new phase and cluster-plan contracts, then run Alice evaluation only when explicitly requested after U6–U7.
4. Remove legacy `world-import` surfaces under the older orchestration cleanup plan when its migration gate is reached.

## Documentation authority map

- `skills/mem-import/SKILL.md`: short role branch and corpus coordinator behavior.
- `skills/mem-import/references/parent-preflight.md`: parent-only acceptance check and coordinator launch.
- `skills/mem-import/references/acceptance.md`: brief capability probe and exclusions.
- `skills/mem-import/references/facility-recipes.md`: local cache and known recipe contract.
- `skills/mem-import/references/subagent-capabilities.md`: minimum facility capabilities.
- `skills/mem-import/references/adapters/*.md`: adapter mechanics only.
- `skills/mem-import/references/workflow.md`: real corpus coordinator decisions only.
- `docs/plans/2026-07-21-002-*`: optional multi-role conformance and runtime-safety decision history.
- `docs/plans/2026-07-21-001-*`: real-import optimization/evaluation roadmap.

Do not duplicate the acceptance sequence in top-level docs or role files; link to the authority instead.
