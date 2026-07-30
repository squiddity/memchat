# Adapter: pi-herdr-subagents

Load this reference only when the active catalog exposes the `subagent` tool from the installed `pi-herdr-subagents` (`subagents`) extension.

Use `subagent` for both parent → phase coordinator and phase coordinator → worker launches. Do not mix it with an alternate or inline host. The mem-import extension resolves activity under the adapter's standard `~/.pi/agent/sessions` tree; controlled installations may set `MEM_IMPORT_PI_HERDR_SESSIONS_ROOT` to the equivalent sessions root.

## Phase coordinator launch

After calling begin exactly once, the parent starts four sequential fresh bounded coordinators (`extraction`, `proposal-reconciliation`, `merge`, `review-finalization`). Each launch has:

- the mem-import skill, exact phase name, small run/scope envelope, and coordinator role guidance;
- coordinator mem-import tools, `subagent`, and extension-owned lifecycle controls;
- explicit authenticated model, thinking, repository `cwd`, fresh context, and `autoExit: false`;
- `extensionMode: "explicit"` and the absolute trusted path to `extensions/mem-import-tools.ts`;
- the requested input/output scope.

The selected named profile already supplies the completion contract for coordinators and workers: put the concise informative result inside `subagent_done`, make that call the final action, and send nothing afterward. Do not duplicate, paraphrase, or split this contract across the dynamic launch task.

Explicit mode provides deterministic extension provenance by suppressing ambient extension discovery; it is not an OS sandbox and does not suppress all configuration or instructions. Descendants inherit explicit mode and the extension entry when those fields are omitted.

Never pass prior coordinator prose or copied status into the next launch. Keep coordinator authority in the live task only; do not place it in a recipe, artifact, or summary.

Use terminal `details.runningChildId`, `details.sessionId` (the sanitized session filename stem), and the terminal steer as lifecycle evidence. Record both identities with `mem_import_record_session` and `hostAdapter: "pi-herdr-subagents"` after every phase. Copy schema-v1 terminal `usage` and `usageByModel` when present, but treat it only as a live hint: finalization resolves the adapter's content-free activity sidecar by host identity, validates it, retains the latest cumulative activity sequence across profile-preserving resumes, and snapshots normalized per-session evidence before cleanup. Never sum intermediate resume snapshots or ask a model to reconstruct telemetry. Recover only the current incomplete phase with `subagent_resume`, never `pi --session`, and require its host-attested verified profile and exact active/denied tools. If preservation is unavailable, start a fresh coordinator for that same phase. Never resume a completed earlier phase.

## Worker launch

For every live assignment, the coordinator:

- passes the assignment bootstrap verbatim in the child task;
- selects the named profile with the launch call's `agent` field (for example, `agent: "mem-import-extractor"`); `name` is only a display label and never selects or verifies a profile;
- sets `tools` to the comma-separated `assignment.tools` array exactly when an explicit tool argument is required; when testing a committed named worker profile, omit the tool override and verify its host-observed profile against `assignment.tools`;
- omits `extensionMode` and `extensions` so the coordinator's explicit runtime is inherited;
- sets explicit model, thinking, repository `cwd`, and fresh/lineage context;
- launches no helper child, ends its turn, and waits at rest for push-delivered completion;
- requires `profileStatus: verified` and `toolProfile.status: exact`;
- verifies active tools equal `assignment.tools` plus only `caller_ping` and `subagent_done`, deny telemetry matches, and no denied tool is active;
- records `hostAdapter: "pi-herdr-subagents"`, the exact running-child ID, sanitized session filename stem, and host-observed semantic tools with `mem_import_record_dispatch`; terminal `details.usage` / `usageByModel` may be copied when present, but adapter sidecar retrieval is the authoritative audit path;
- inspects the durable effect before dependent work.

The widget's **available** list is active; **denied** is policy, not the tools removed by `--tools`. Host completion profile is the evidence.

## Version-controlled facility recipe

This is a known recipe, not a required mem-import backend or programmatic adapter:

- facility/tool: installed `subagent`;
- phase coordinators: four sequential fresh contexts with `autoExit: false`, exact phase/run scope, explicit model/thinking/cwd/tools, `extensionMode: "explicit"`, and the trusted mem-import extension entry;
- workers: exact assignment tools, explicit model/thinking/cwd, inherited extension mode/entries; named-profile launches must use `agent`, never display-only `name`, as the selector;
- lifecycle additions: `caller_ping` and `subagent_done`; every named coordinator and worker profile puts its informative result in `subagent_done`, calls it as the final action, and sends nothing afterward;
- completion evidence: host child identity, terminal outcome, profile status, active/denied tool comparison, and content-free cumulative usage snapshots;
- recovery: `subagent_interrupt` and profile-preserving `subagent_resume` when needed.

For a missing or stale recipe, follow [brief acceptance](../acceptance.md). Cache only sanitized working parameters. Real imports still require each assignment's exact profile and durable dispatch/effect evidence.

Model-visible allowlisting and explicit mode are not an OS sandbox. Report only observed controls.
