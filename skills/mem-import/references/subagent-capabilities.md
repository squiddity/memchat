# Worker-facility capability guide

A coordinator evaluates a facility from the tools actually present in its current harness. This guide is a decision aid, not a requirement to implement or install anything during an import.

## Useful observable controls

When available, inspect whether the facility exposes:

- isolated child launch with a concrete task;
- requested model, thinking level, cwd, and context controls;
- requested role/profile or explicit child tool restrictions;
- a task/run/session identity and unambiguous completion/failure result;
- waiting, interruption, stop, timeout, concurrency, resume, or lifecycle telemetry;
- a way to prevent ordinary workers from recursively becoming coordinators.

## U0 decision rule

For a harmless scout, the coordinator may make a provisional choice based on visible controls and an observed trial. It should prefer facilities that make correlation and lifecycle behavior legible, but missing controls are evidence to weigh—not a mandate for a custom fixture.

If a facility cannot safely support the proposed limited task, do not delegate through it. Continue inline or explain the limitation.

## Later hardening boundary

Tool schemas and worker reports do not prove enforcement. Before workers receive privileged typed tools that mutate scoped world-import state, later implementation must decide and add the necessary authorization, tool-allowlist, lifecycle, and concurrency safeguards. U0 intentionally does not implement or prove those safeguards.

## Artifact-first quality rule

Once semantic workers produce world-import output, judge them by canonical extraction/merge/review/checkpoint artifacts and deterministic diagnostics. A persuasive completion message cannot compensate for missing, structurally invalid, incomplete, or low-quality artifacts.
