# Subagent facility capabilities

Assess the current tool catalog; an extension name alone is not evidence, and no extension is required.

## Capabilities needed by a planned import

Choose a facility that can provide:

1. **Parent → coordinator:** explicit task/context, model, thinking, cwd, coordinator tools, lifecycle outcome, and usable child identity.
2. **Coordinator → worker:** enforced `assignment.tools` plus completion evidence that correlates the child with its durable effect.
3. **Recovery when needed:** interruption, cancellation, or resume suitable for the planned run.

Prefer host-observed active/denied tool telemetry, extension provenance, and profile-preserving resume, but do not make unavailable adapter-specific evidence universal.

Assignment grants and durable services enforce application scope independently. Model-visible tool restrictions and explicit extension modes are not operating-system sandboxes.

## Decision

Use a matching [facility recipe](facility-recipes.md) or [brief acceptance](acceptance.md), then use one selected facility at both levels. During corpus work, every child remains assignment-bound and every effect needs an accurate dispatch/lifecycle receipt.

If the facility broadens tools, cannot expose required mem-import tools, loses child identity, or cannot support required recovery, stop before import and give concrete setup guidance. Do not develop an adapter during the run.
