# Subagent installation gate

Assess the installed and enabled subagent extension from controls actually present in the current host. An extension name alone is not evidence.

## Required two-level capability

The same `subagent` facility must support both:

1. **Parent → coordinator:** launch a bounded coordinator with the mem-import skill, coordinator tools, `subagent`, lifecycle controls, explicit model/thinking/cwd/context, and a host-issued child identity.
2. **Coordinator → worker:** let that coordinator launch each assigned role with model-visible tools exactly equal to `assignment.tools` plus facility-owned lifecycle controls.

Both levels require completed/failed/cancelled outcomes, interruption or cancellation, host-attested launch profiles, host-observed active/denied tool sets, and enough lifecycle telemetry to correlate child identity with the durable run. Assignment grants enforce application scope independently; an exact tool allowlist and explicit extension mode are not an operating-system sandbox.

## Conformance probe

Before substantive work:

1. the parent verifies the `subagent` facility is installed and active;
2. the parent launches the corpus coordinator in explicit extension mode with the intended profile and no unassigned helpers;
3. before touching the corpus, that coordinator launches one harmless assigned child through its own `subagent` tool;
4. resume the disposable child through the facility's resume tool;
5. require host-attested `verified`/`exact` profile evidence, exact active/denied tools, no active denied tools, and stable profile controls for coordinator, worker, and resumed worker;
6. record only host-observed controls. A command line, widget, model-authored `observedTools`, or successful semantic effect alone is insufficient.

The same coordinator then runs any required fixture-backed role probes from [the acceptance ladder](acceptance-ladder.md) and continues the corpus import.

## Decision

Proceed only when one installed facility passes both levels and enforces every role's returned `assignment.tools`. Otherwise stop before import and give concrete setup guidance. Do not switch to an alternate agent-hosting path or adapter development during the import.

Judge semantic work by persisted packets, transactions, reviews, and checks. Completion prose cannot replace the ledger.
