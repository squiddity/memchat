# Subagent facility capabilities

Assess facilities actually exposed in the current tool catalog. An extension name alone is not evidence, and no particular extension is required.

## Capabilities needed by a planned import

Choose a facility that can provide:

1. **Parent → coordinator launch:** explicit task/context, model, thinking, cwd, coordinator tools, lifecycle outcome, and a usable child identity.
2. **Coordinator → worker launch:** a narrow worker tool profile derived from `assignment.tools`, plus enough completion information to correlate the child with its durable effect.
3. **Recovery controls only when needed:** interruption, cancellation, or resume suitable for the planned run.

Prefer facilities with host-observed active/denied tool telemetry, extension provenance, and profile-preserving resume. These improve confidence but are not universal prerequisites when the planned import does not require them and the facility otherwise demonstrates narrow tool activation and lifecycle correlation.

Assignment grants and durable services enforce application scope independently. Model-visible tool restrictions and explicit extension modes are not operating-system sandboxes.

## Brief validation

Use a matching cached [facility recipe](facility-recipes.md), or run the disposable [brief acceptance probe](acceptance.md). Test only capabilities the planned run needs. One launch, at most one nested launch, and optionally one read/status tool call should normally be enough.

Do not run semantic stages, exhaustive role probes, checks, finalization, or a book import to validate a facility.

## Decision

Proceed with one selected facility and reuse its working invocation shape at both levels. During the corpus run, every semantic child remains assignment-bound and every durable effect needs an accurate dispatch/lifecycle receipt.

If the facility broadens tools, cannot expose required mem-import tools, loses child identity, or cannot support required recovery, stop before import and give concrete setup guidance. Do not develop an adapter during the run.
