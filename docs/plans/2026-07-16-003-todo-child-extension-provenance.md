---
title: "todo: preserve parent extension policy in delegated child agents"
date: 2026-07-16
status: concluded; Herdr child tool allowlist confirmed, extension isolation remains a non-blocking future validation
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

## Disposition — 2026-07-16

The active `pi-herdr-subagents` Pi launch path resolves the child tools from the explicit spawn `tools` argument (or the selected agent definition), passes them as Pi's `--tools` allowlist, and adds only the documented `caller_ping` and `subagent_done` lifecycle controls. Pi 0.70+ applies that allowlist to built-in, extension, and custom tools. A worker must therefore receive an explicit minimal `tools` list; omitting it deliberately leaves the child unrestricted. This is sufficient for the current mem-import worker policy when combined with durable assignment grants.

Accordingly, the generic coordinator capability assessment now requires an observable, enforceable role-specific child-tool allowlist. The current Herdr adapter is provisionally acceptable for the bounded U1/U1a worker roles, and recursive-spawn tools should be omitted from their allowlists.

This result does **not** prove that ambient extensions are suppressed or that the child is OS-sandboxed. The observed inherited extension set is non-blocking for the current worker policy because the callable surface is restricted and grants authorize import mutations independently. If stronger extension isolation becomes necessary, create a new adapter-hardening task to test an account-level sentinel extension and an explicit extension-mode/entry policy; do not imply that tool filtering alone supplies that guarantee.

## Non-goals

- Do not change the active Frankenstein run.
- Do not make mem-import depend on Herdr or its subagent package.
- Do not replace durable assignment-grant checks with adapter policy.
