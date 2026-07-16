---
title: "todo: preserve parent extension policy in delegated child agents"
date: 2026-07-16
status: deferred until the Frankenstein managed-agent run completes
---

# Child extension provenance follow-up

## Context

The Frankenstein U1 extraction run is using a managed Herdr main agent with an explicit, narrow extension set: the mem-import development tools plus the selected subagent facility. Its delegated workers appear to receive the requested narrow **tool** allowlist, but may also discover ambient account-level `~/.pi` extensions.

Tool filtering alone is not an isolation guarantee: an extension that is not exposed as a callable tool can still run lifecycle hooks, register commands/providers, alter prompts, intercept tool results, or otherwise create side effects. Durable mem-import assignment grants still protect scoped import artifacts, but do not constrain arbitrary ambient extension behavior.

## Adapter-agnostic requirement

Add this to the generic subagent capability/assessment contract:

```text
child extensions ⊆ parent's explicitly effective extension set
child tools ⊆ parent's exposed tools
child tools = requested allowlist ∩ parent tools
```

A facility must make the child extension/resource policy observable. A child must not silently gain an ambient extension that was absent from the parent’s declared/effective set when the parent requests isolation.

The requirement is about extension provenance and tool exposure, not a claim that extension filtering creates a general OS sandbox. Provider credentials/auth may remain host-managed where required; the extension policy must be explicit.

## Follow-up after the run

1. Inspect the managed coordinator and child panes/session data to establish whether children actually loaded account-level extensions, which ones, and whether they had observable side effects.
2. Update `skills/mem-import/references/subagent-capabilities.md` and `workflow.md` with the generic requirement and assessment questions.
3. Update only the relevant adapter profile (currently `references/adapters/pi-herdr-subagents.md`) with observed behavior and exact invocation/provisioning details. Do not hard-code Herdr behavior into the generic workflow.
4. In the Herdr child-spawn implementation, support propagating a parent’s resolved extension mode and approved extension entries to descendants. For an explicitly isolated parent, suppress ambient extension discovery and replay only the approved child extension set. Omit recursive spawning support when the child tool allowlist excludes it.
5. Add a conformance test with an account-level sentinel extension. Prove that it does not load in an explicitly isolated child, while an explicitly approved development extension does load and its requested tool subset remains callable.
6. Record any remaining limitation as an adapter observation. Do not claim enforcement merely from tool schemas or worker prose.

## Non-goals

- Do not change the active Frankenstein run.
- Do not make mem-import depend on Herdr or its subagent package.
- Do not replace durable assignment-grant checks with adapter policy.
