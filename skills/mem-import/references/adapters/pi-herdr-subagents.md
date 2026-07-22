# Adapter: pi-herdr-subagents

Load this reference only when the active catalog exposes the `subagent` tool from the installed `pi-herdr-subagents` (`subagents`) extension.

Use `subagent` for both parent → coordinator and coordinator → worker launches. Do not mix it with an alternate or inline host.

## Coordinator launch

The parent starts a fresh bounded coordinator with:

- the mem-import skill and coordinator role guidance;
- coordinator mem-import tools, `subagent`, and extension-owned lifecycle controls;
- explicit authenticated model, thinking, repository `cwd`, fresh context, and `autoExit: false`;
- `extensionMode: "explicit"` and the absolute trusted path to `extensions/mem-import-tools.ts`;
- the requested input/output scope.

Explicit mode provides deterministic extension provenance by suppressing ambient extension discovery; it is not an OS sandbox and does not suppress all configuration or instructions. Descendants inherit explicit mode and the extension entry when those fields are omitted.

Use the returned child/session ID and terminal steer as lifecycle evidence. Recover only with `subagent_resume`, never `pi --session`; require its host-attested verified profile and exact active/denied tools. Otherwise start a fresh coordinator.

## Worker launch

For every live assignment, the coordinator:

- passes the assignment bootstrap verbatim in the child task;
- sets `tools` to the comma-separated `assignment.tools` array exactly;
- omits `extensionMode` and `extensions` so the coordinator's explicit runtime is inherited;
- sets explicit model, thinking, repository `cwd`, and fresh/lineage context;
- launches no helper child, ends its turn, and waits at rest for push-delivered completion;
- requires `profileStatus: verified` and `toolProfile.status: exact`;
- verifies active tools equal `assignment.tools` plus only `caller_ping` and `subagent_done`, deny telemetry matches, and no denied tool is active;
- records the returned child/session ID and host-observed semantic tools with `mem_import_record_dispatch`;
- inspects the durable effect before dependent work.

The widget's **available** list is active; **denied** is policy, not the tools removed by `--tools`. Host completion profile is the evidence.

## Version-controlled facility recipe

This is a known recipe, not a required mem-import backend or programmatic adapter:

- facility/tool: installed `subagent`;
- coordinator: `autoExit: false`, explicit model/thinking/cwd/tools, `extensionMode: "explicit"`, trusted mem-import extension entry;
- workers: exact assignment tools, explicit model/thinking/cwd, inherited extension mode/entries;
- lifecycle additions: `caller_ping` and `subagent_done`;
- completion evidence: host child identity, terminal outcome, profile status, active/denied tool comparison;
- recovery: `subagent_interrupt` and profile-preserving `subagent_resume` when needed.

For a missing or stale recipe, follow [brief acceptance](../acceptance.md). Cache only sanitized working parameters. Real imports still require each assignment's exact profile and durable dispatch/effect evidence.

Model-visible allowlisting and explicit mode are not an OS sandbox. Report only observed controls.
