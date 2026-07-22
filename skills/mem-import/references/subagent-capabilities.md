# Subagent facility capabilities

Assess the current tool catalog; an extension name alone is not evidence, and no extension is required.

## Capabilities needed by a planned import

Choose a facility that can provide:

1. **Parent → phase coordinator:** four sequential fresh contexts with explicit phase/run scope, model, thinking, cwd, coordinator tools, lifecycle outcome, and usable child identity.
2. **Phase coordinator → worker:** enforced `assignment.tools` plus completion evidence that correlates the child with its durable effect.
3. **Recovery when needed:** interruption, cancellation, or exact-profile resume of the current phase only; otherwise a fresh replacement for that same phase.

Prefer host-observed active/denied tool telemetry, extension provenance, and profile-preserving resume, but do not make unavailable adapter-specific evidence universal.

Assignment grants and durable services enforce application scope independently. Model-visible tool restrictions and explicit extension modes are not operating-system sandboxes.

## Decision

Use a matching [facility recipe](facility-recipes.md) or [brief acceptance](acceptance.md), then use one selected facility at both levels. The parent begins once, keeps authority transient, and launches the four fresh phases without prior coordinator prose. During corpus work, every child remains assignment-bound and every effect needs an accurate dispatch/lifecycle receipt.

If the facility broadens tools, cannot expose required mem-import tools, loses child identity, or cannot support required recovery, stop before import and give concrete setup guidance. Do not develop an adapter during the run.
