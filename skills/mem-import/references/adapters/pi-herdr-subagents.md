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
- explicit authenticated model, thinking, repository `cwd`, fresh context, and `autoExit: false`;
- `extensionMode: "explicit"` and the absolute trusted path to `extensions/mem-import-tools.ts`;
- the requested input/output scope, without persisting coordinator authority in prompts or artifacts.

Explicit mode suppresses ambient extension discovery only; it is not an OS sandbox and does not suppress every config file or instruction. Its purpose here is deterministic extension provenance. Descendant Pi subagents inherit the explicit mode and absolute extension entry when those fields are omitted.

Treat the returned child/session ID and automatic terminal steer as the coordinator lifecycle. Use only `subagent_resume` for recovery; never run `pi --session` directly. Resume must report a host-attested verified profile and exact active/denied tools. A legacy, isolated-unverified, unrestricted, or mismatched resume is not valid corpus-run evidence; start a fresh coordinator instead.

## Worker launch

For every live assignment, the coordinator:

- passes the assignment bootstrap verbatim in the child task;
- sets `tools` to the comma-separated `assignment.tools` array exactly;
- omits `extensionMode` and `extensions` so the coordinator's explicit runtime is inherited;
- sets explicit model, thinking, repository `cwd`, and fresh/lineage context;
- launches no unassigned helper child;
- ends its turn after launch and waits at rest for push-delivered host completion evidence; it never polls, schedules an ordinary wait, or launches a wait/no-op/monitor child;
- requires `profileStatus: verified` plus `toolProfile.status: exact`;
- verifies actual tools equal `assignment.tools` plus only `caller_ping` and `subagent_done`, with exact deny telemetry and no active denied tool;
- uses the returned host child/session ID for `mem_import_record_dispatch`, recording the host-observed semantic subset rather than copying expected tools;
- inspects the durable effect before dependent work.

The widget's **available** list is the active surface; its separate **denied** list is deny policy, not the set removed by `--tools`. A large available list is failure even if many names appear under denied. The host completion profile, not the widget or coordinator prose alone, is dispatch evidence.

## Installation acceptance

Run the focused harness from [installation acceptance probes](../acceptance.md) before launching the requested corpus coordinator. Adapter conformance uses disposable sessions to verify explicit extension entries, coordinator and worker catalogs, exact active/denied tools, lifecycle identity, and resume preservation. Semantic probes remain independent and make one specified production-tool call each.

Never ask a corpus coordinator to run acceptance. Do not chain acceptance probes, continue a probe into the corpus, finalize a probe run, or use an import as acceptance evidence.

Proceed only when the exact adapter/profile receipt is current and every used role is covered. During the real import, continue to require exact host evidence for every dispatch; cached acceptance does not authorize a broader launch.

Model-visible allowlisting and explicit extension mode are not an operating-system sandbox. Report only controls actually observed.
