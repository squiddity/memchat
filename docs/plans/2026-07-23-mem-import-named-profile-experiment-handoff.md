# Mem-import named-profile experiment handoff

> **Historical/non-product record — superseded:** This plan is retained for traceability only. It is not runtime authority, an installation contract, or a current implementation instruction; consult the active product sources linked from [`docs/plans/README.md`](README.md).


## Current state

Repository: `/home/squiddity/projects/memchat`  
Branch: `feat/world-import-model-led-subagents-u0`

Pushed commits:

- `debb55f` — four artifact-led coordinator phases;
- `ff828c6` — immutable identity-aware cluster planning.

Validation passed:

- `npm run test:mem-import` — 49/49;
- `npm run build`;
- `git diff --check`.

## Implemented architecture

Four fresh coordinator sessions execute sequentially:

1. extraction;
2. proposal/reconciliation;
3. merge;
4. review/finalization.

Each reconstructs inputs and validates outputs from durable typed artifacts, never prior coordinator prose.

Identity planning uses:

- flattened snapshot-bound candidate inventory;
- immutable cluster-plan artifacts;
- model-authored `identity` and `coherent` clusters;
- plan-derived proposer, reconciler, and merger scopes;
- reconciliation dependencies;
- ledger-derived merge readiness.

## Tiny live import result

A Glass Tower import using `pi-herdr-subagents` failed before normalization because the extraction coordinator launched an unassigned setup/helper child. The assignment ledger remained empty.

The run was durably failed with:

```text
unassigned-helper-dispatch
```

This demonstrated:

```text
child tool allowlist != authorization to launch a particular child
```

Do not resume or continue that failed import.

## Subagent-extension design conclusion

Comparisons covered:

- `/home/squiddity/projects/pi-herdr-subagents`;
- `nicobailon/pi-subagents`;
- current mem-import assignment and dispatch contracts.

The likely long-term authorization model is:

```text
immutable named profile
+ live assignment or phase authority
+ audience-bound, expiring, one-use handle
= one authorized launch
```

Before implementing handles, run a smaller experiment with ten project-defined named profiles.

## Immediate decision

Do **not** remove the larger feature-branch changes from `pi-herdr-subagents` yet.

First author and test named profiles using the current branch. This will identify which recursion and extension-loading behavior is actually required. Branch cleanup or rebasing onto main should follow the experiment and use its evidence.

## Profiles to create

Four coordinators:

```text
mem-import-coordinator-extraction
mem-import-coordinator-proposal
mem-import-coordinator-merge
mem-import-coordinator-finalize
```

Six workers:

```text
mem-import-extractor
mem-import-proposer
mem-import-reconciler
mem-import-merger
mem-import-reviewer
mem-import-repairer
```

Use the same runtime names for both adapters where possible.

## Profile policy

### Coordinators

- phase-specific coordinator tools only;
- mem-import skill;
- launcher access;
- fresh or lineage-only context;
- `autoExit: false`;
- no generic filesystem or shell tools unless genuinely required.

### Workers

- tools exactly equal the corresponding `MEM_IMPORT_ROLE_TOOLS`;
- mem-import extension loaded;
- spawning disabled;
- no launcher, resume, shell, or filesystem tools beyond the role contract;
- `autoExit: true`;
- fresh context.

The exact worker tool sets are defined in:

```text
src/mem-import/service.ts
MEM_IMPORT_ROLE_TOOLS
```

## Adapter differences

### pi-herdr-subagents

Project agents live under:

```text
.pi/agents/*.md
```

Relevant frontmatter:

```yaml
name:
description:
model:
thinking:
tools:
skills:
session-mode:
spawning:
deny-tools:
auto-exit:
interactive:
cwd:
```

The current feature branch supports recursive completion, non-auto-exit coordinators, explicit extension loading/inheritance, and profile telemetry.

Named profiles alone do not guarantee mem-import extension loading unless explicit entries or ambient package loading remain configured.

### pi-subagents

It also discovers project agents under `.pi/agents/**/*.md`.

Its profile format supports:

```yaml
name:
description:
tools:
extensions:
subagentOnlyExtensions:
model:
thinking:
systemPromptMode:
inheritProjectContext:
inheritSkills:
skills:
defaultContext:
maxSubagentDepth:
```

Recursion occurs only when resolved tools explicitly contain `subagent`.

It has a typed delegation API, but profiles are mutable or shadowable and do not enforce live assignment authorization.

## Deterministic tests to add

Verify:

1. all ten profiles exist;
2. runtime names are stable;
3. every worker's tools exactly equal `MEM_IMPORT_ROLE_TOOLS`;
4. worker profiles deny spawning;
5. coordinator profiles contain only their phase tools plus launcher and lifecycle needs;
6. coordinators are non-auto-exit and workers auto-exit;
7. profiles use fresh or lineage-only context;
8. required mem-import extension entries are present;
9. no worker receives generic `subagent`, resume, shell, or unrelated coordinator tools;
10. profiles contain no grants, prompts, credentials, run IDs, or source payloads.

Prefer one shared declarative profile manifest plus adapter-specific renderings if that avoids duplicating tool lists.

## Recursive experiment after preparation

Do not begin another full import yet.

Run an extraction-only test:

1. launch the named extraction coordinator;
2. coordinator normalizes and creates a real extractor assignment;
3. coordinator launches only `mem-import-extractor`;
4. verify exact profile, completion, dispatch receipt, and extraction effect;
5. ensure push-delivered completion reaches the coordinator.

Also run a negative test that asks or induces the coordinator to launch an unassigned helper or unrelated named profile.

The expected current limitation is that generic launcher access may still allow it. If it does, proceed to profile-bound authorized handles.

## Gaps named profiles do not solve

- launch without a live assignment;
- arbitrary task or prompt;
- wrong named profile;
- replay or double-spawn;
- revocation between assignment and launch;
- per-call model, cwd, or extension overrides;
- host-authoritative receipt correlation;
- phase-attempt replay or earlier-phase resume;
- profile shadowing and drift.

## Likely authorized-launch follow-up

If the experiment confirms the gap, define a host-neutral `Authorized Launch v1` contract:

```ts
{
  version: 1,
  requestId,
  authorization: {
    issuer,
    handle,
  },
}
```

The handle references an immutable profile and dynamic assignment authority. The model supplies no launch overrides.

Both extensions can implement this through their existing executors; they do not need to share registry implementation.

## Relevant files

```text
src/mem-import/service.ts
extensions/mem-import-tools.ts
skills/mem-import/SKILL.md
skills/mem-import/references/adapters/pi-herdr-subagents.md
skills/mem-import/references/adapters/pi-subagents.md
src/mem-import-acceptance-fixture.test.ts
src/mem-import-tools.test.ts
docs/plans/2026-07-21-001-fix-mem-import-efficiency-parity-plan.md
docs/plans/2026-07-22-mem-import-weekly-consolidation.md
```

External repositories:

```text
/home/squiddity/projects/pi-herdr-subagents
/tmp/pi-subagents-review
```

## Next-agent instruction

Implement only the profile fixtures and deterministic tests first. Do not clean up `pi-herdr-subagents`, add handles, run Alice, or begin another corpus import until profile preparation is reviewed and green.
