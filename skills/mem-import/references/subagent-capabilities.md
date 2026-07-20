# Subagent facility gate

Select a facility from controls actually present in the current host.

## Required evidence

A semantic worker facility must provide:

- a bounded child task with explicit model, thinking, cwd, and context;
- a host-enforced model-visible tool allowlist;
- terminal child/session identity and completed/failed/cancelled outcome;
- interruption or cancellation for stuck work;
- enough lifecycle telemetry to correlate the child with its durable assignment.

Assignment grants enforce application scope independently. A tool allowlist is not an operating-system sandbox.

## Conformance probe

Before substantive dispatch:

1. launch a harmless fresh child with an exact test allowlist;
2. call one allowed typed tool and observe normal authorization behavior;
3. verify a known forbidden tool is absent;
4. correlate the returned terminal child ID;
5. record only controls actually observed.

## Decision

Use the facility only when it enforces the role's returned `assignment.tools` array. Otherwise call `mem_import_fail` and stop the delegated import. Installation or adapter development is launcher work, not an inline import fallback.

Judge semantic workers by persisted packets, transactions, reviews, and checks. Completion prose cannot replace the ledger.
