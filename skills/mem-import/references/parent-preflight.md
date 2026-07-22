# Parent preflight and coordinator launch

This reference is for the parent agent only. A corpus coordinator does not run facility acceptance or launch another coordinator.

## 1. Select and briefly validate a facility

1. Inspect the currently available subagent tools and [known facility recipes](facility-recipes.md).
2. Choose one facility that appears able to launch both the corpus coordinator and its workers.
3. Reuse a repo-local cached recipe when its observable facility/runtime, mem-import revision, model, and needed capabilities still match.
4. Otherwise run the short disposable probe in [brief acceptance](acceptance.md). Stop after confirming the launch parameters, required tool visibility, lifecycle result, and—only when needed—one nested launch or resume.
5. Cache the sanitized working invocation. Do not run role-by-role conformance, a miniature import, or Alice as preflight.

If no available facility passes the brief probe, stop and explain the missing capability. Do not install, implement, or switch to a custom adapter during the import request.

## 2. Launch one corpus coordinator

Use the selected recipe to launch a fresh bounded coordinator with:

- a bootstrap that explicitly names it as the corpus coordinator and tells it to start at section 2 of `SKILL.md`;
- the mem-import skill;
- coordinator mem-import tools, the selected subagent facility, and its lifecycle controls;
- explicit model, thinking, repository cwd, and fresh context;
- the requested input/output scope without persisting coordinator authority in prompts or artifacts.

Use the same selected facility for coordinator → worker launches. The parent observes the coordinator lifecycle and supplies follow-up only when requested or when recovery is necessary.

The coordinator owns the corpus ledger. Brief acceptance remains a completed parent concern; exact live worker assignments and durable effects govern the real run.
