# Worker-facility capability guide

A coordinator evaluates a facility from the tools actually present in its current harness. This guide is a decision aid, not a requirement to implement or install anything during an import.

## Useful observable controls

When available, inspect whether the facility exposes:

- isolated child launch with a concrete task;
- requested model, thinking level, cwd, and context controls;
- an enforceable role-specific child-tool allowlist and the resolved effective child tool set;
- a task/run/session identity and unambiguous completion/failure result;
- waiting, interruption, stop, timeout, concurrency, resume, or lifecycle telemetry;
- a way to prevent ordinary workers from recursively becoming coordinators.

## U0 decision rule

For a harmless scout, the coordinator may make a provisional choice based on visible controls and an observed trial. It should prefer facilities that make correlation, lifecycle behavior, and the resolved child-tool set legible, but missing controls are evidence to weigh—not a mandate for a custom fixture.

If a facility cannot safely support the proposed limited task—or cannot enforce the worker's required tool restriction—do not delegate through it. Continue inline or explain the limitation.

## Tool-restriction requirement

Before assigning a worker role, the coordinator must request the smallest role-specific child-tool allowlist and record the resolved effective tool set. For privileged workers, delegation is acceptable only when the facility enforces that allowlist rather than relying on prompt guidance. The effective set may include documented, non-mutating lifecycle controls required by the facility; all other tools must be the requested role tools that the child runtime actually exposes. If this cannot be observed or enforced, do not delegate privileged work through that facility.

Tool restriction is not an OS sandbox or extension-isolation claim. Durable assignment grants, lifecycle controls, and concurrency safeguards remain independently required for scoped world-import mutations.

## Artifact-first quality rule

Once semantic workers produce world-import output, judge them by canonical extraction/merge/review/checkpoint artifacts and deterministic diagnostics. A persuasive completion message cannot compensate for missing, structurally invalid, incomplete, or low-quality artifacts.
