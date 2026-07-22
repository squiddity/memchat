# Subagent installation gate

Assess the installed and enabled subagent extension from controls actually present in the current host. An extension name alone is not evidence.

## Required two-level capability

The same `subagent` facility must support both:

1. **Parent → coordinator:** launch a bounded coordinator with the mem-import skill, coordinator tools, `subagent`, lifecycle controls, explicit model/thinking/cwd/context, and a host-issued child identity.
2. **Coordinator → worker:** let that coordinator launch each assigned role with model-visible tools exactly equal to `assignment.tools` plus facility-owned lifecycle controls.

Both levels require completed/failed/cancelled outcomes, interruption or cancellation, host-attested launch profiles, host-observed active/denied tool sets, and enough lifecycle telemetry to correlate child identity with the durable run. Assignment grants enforce application scope independently; an exact tool allowlist and explicit extension mode are not an operating-system sandbox.

## Conformance evidence

Before substantive work, the parent or acceptance harness verifies:

1. the `subagent` facility and trusted mem-import extension entries are installed and active;
2. the intended coordinator profile contains coordinator tools, `subagent`, and lifecycle controls;
3. each worker profile can be restricted to its exact assignment tools plus lifecycle controls;
4. initial and resumed disposable profiles have host-attested `verified`/`exact` active and denied tool telemetry with no active denied tool;
5. model, thinking, cwd, config root, explicit extension entries, allowlist, deny policy, and named-agent identity survive supported resume;
6. only host-observed controls are recorded.

Use disposable host-profile sessions and the independent [acceptance probes](acceptance.md). Do not launch the requested corpus coordinator to run conformance, and do not turn conformance into a semantic pipeline. A command line, widget, model-authored `observedTools`, successful effect, or worker prose alone is insufficient.

## Decision

Proceed only when one installed facility passes both levels and enforces every role's returned `assignment.tools`. Otherwise stop before import and give concrete setup guidance. Do not switch to an alternate agent-hosting path or adapter development during the import.

Judge semantic work by persisted packets, transactions, reviews, and checks. Completion prose cannot replace the ledger.
