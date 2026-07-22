# Parent preflight and coordinator launch

This reference is for the parent agent only. A corpus coordinator must not load acceptance fixtures, run installation probes, or launch another coordinator.

## 1. Check installation acceptance

Before launching a corpus coordinator:

1. Confirm that the installed subagent facility and mem-import extension are available.
2. Check for a current acceptance receipt matching the exact host adapter/runtime, extension entries, model/thinking profile, role allowlists, fixture/tool schema, and source revision.
3. If evidence is missing or stale, invoke the deterministic focused harness in [installation acceptance](acceptance.md). The harness—not a model coordinator—materializes independent fixtures and permits exactly one specified production-tool call per probe.
4. Stop on failed, partial, unrestricted, unverified, or mismatched evidence. Do not replace the harness with an acceptance coordinator, miniature import, or Alice run.

If the parent cannot invoke an accepted harness, stop and give concrete setup guidance. A prior import, extension-name assertion, tools widget, or output directory is not acceptance evidence.

## 2. Launch one corpus coordinator

After acceptance, launch a fresh bounded coordinator with:

- a bootstrap that explicitly names it as the corpus coordinator and tells it to start at section 2 of `SKILL.md`;
- the mem-import skill;
- the coordinator mem-import tools, `subagent`, and lifecycle controls;
- explicit model, thinking, repository cwd, and fresh context;
- the requested input/output scope without persisting coordinator authority in prompts or artifacts.

For `pi-herdr-subagents`, use `extensionMode: "explicit"`, pass the absolute trusted `extensions/mem-import-tools.ts` entry, and set `autoExit: false`. Use the installed subagent facility for this launch; do not substitute another agent-hosting path.

The parent validates the coordinator's host lifecycle/profile evidence. The coordinator owns the corpus ledger and launches only assignment-bound semantic workers. Acceptance remains a completed parent concern and is not repeated inside the coordinator.
