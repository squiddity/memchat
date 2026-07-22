# Parent preflight and coordinator launch

This reference is for the parent agent only. A corpus coordinator does not run facility acceptance or launch another coordinator.

## 1. Select and briefly validate a facility

1. Inspect the available subagent tools and [facility recipes](facility-recipes.md).
2. Choose one facility able to launch the corpus coordinator and its workers.
3. Reuse a local recipe when its facility/runtime, mem-import revision, model, and needed capabilities still match; otherwise run [brief acceptance](acceptance.md).
4. Cache only the sanitized invocation. Do not run role-by-role conformance, a miniature import, or Alice.

If no available facility passes the brief probe, stop and explain the missing capability. Do not install, implement, or switch to a custom adapter during the import request.

## 2. Launch one corpus coordinator

Use the selected recipe to launch exactly one fresh bounded coordinator with:

- a bootstrap that explicitly names it as the corpus coordinator and tells it to start at section 2 of `SKILL.md`;
- the mem-import skill;
- coordinator mem-import tools, the selected subagent facility, and its lifecycle controls;
- explicit model, thinking, repository cwd, and fresh context;
- the requested input/output scope.

Use the same facility for coordinator → worker launches. Do not copy coordinator authority into its recipe or durable artifacts. The parent observes the coordinator lifecycle and follows up only for a request or necessary recovery.

The coordinator owns the corpus ledger. Acceptance is finished parent work; live worker assignments and durable effects govern the run.
