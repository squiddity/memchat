# Adapter: pi-herdr-subagents

Load this reference only when the active catalog exposes the `subagent` tool from the installed `pi-herdr-subagents` (`subagents`) extension.

## One launch facility

Use `subagent` for both levels of mem-import:

- the parent launches the coordinator;
- the coordinator launches assigned semantic workers.

Do not use an alternate or inline agent-hosting path for either level.

## Coordinator launch

The parent starts a fresh bounded coordinator with:

- the mem-import skill and coordinator role guidance;
- coordinator mem-import tools, `subagent`, and extension-owned lifecycle controls;
- explicit authenticated model, thinking, repository `cwd`, and fresh context;
- the requested input/output scope, without persisting coordinator authority in prompts or artifacts.

Treat the returned child/session ID and automatic terminal steer as the coordinator lifecycle. Use the extension's interruption/resume operations when recovery is required. A resumed coordinator reconstructs progress from typed status tools and the ledger, not parent conversation replay.

## Worker launch

For every live assignment, the coordinator:

- passes the assignment bootstrap verbatim in the child task;
- sets `tools` to the comma-separated `assignment.tools` array exactly;
- sets explicit model, thinking, repository `cwd`, and fresh/lineage context;
- uses the returned host child/session ID for `mem_import_record_dispatch`;
- treats the automatic terminal steer as final lifecycle evidence and inspects the durable effect before dependent work.

Worker profiles contain only `assignment.tools` plus extension-owned lifecycle controls. Extra installed extensions may exist, but the active tool allowlist is the model-visible boundary.

## Acceptance

The parent-launched corpus coordinator first proves the live two-level topology by launching an exact-allowlist probe child. It then runs independent tracked-fixture probes before touching the requested corpus. Each semantic probe calls one named production tool exactly once; normalization is one coordinator tool call. Validate effects through `mem_import_effect_inventory`, persist only sanitized evidence, and continue the requested corpus in the same coordinator.

For the current acceptance profile:

- coordinator: `openrouter/deepseek/deepseek-v4-pro`, `high`;
- workers: `openrouter/deepseek/deepseek-v4-flash`, `high`.

These are installation test choices, not portable mem-import requirements.

## Conformance gate

Proceed only when:

1. the extension is installed and the active parent exposes `subagent`;
2. the coordinator child exposes its accepted coordinator profile and `subagent`;
3. nested worker tools exactly equal `assignment.tools`;
4. forbidden shell, generic mutation, and unrelated mem-import tools are absent from worker profiles;
5. coordinator and worker terminal child IDs are correlatable;
6. every semantic probe produces exactly one expected durable effect.

Model-visible allowlisting is not an operating-system sandbox. Report only controls actually observed.
