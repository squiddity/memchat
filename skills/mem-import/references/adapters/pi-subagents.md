# Known adapter profile: pi-subagents

Load this reference only when the installed extension and active catalog expose its subagent facility.

Use one facility for the phase-bounded topology: parent → four sequential fresh phase coordinators → exact-assignment workers. The parent calls begin once, retains coordinator authority only in live context, and passes no prior coordinator prose between phases. Inspect the installed version and live tool schema; never infer compatibility from its name.

Accept this facility only when it provides:

- fresh bounded coordinator and worker contexts;
- explicit model, thinking, cwd, and tool profiles;
- a coordinator profile that includes mem-import coordinator tools and recursive subagent launch;
- current-phase-only resume with the exact profile, or a fresh replacement context for that same phase;
- worker profiles whose semantic tools equal `assignment.tools`, apart from documented lifecycle controls;
- host child/session IDs and terminal outcomes;
- interruption, resume, or fresh retry when the planned run needs them.

Follow the [facility capability check](../subagent-capabilities.md) and [brief acceptance](../acceptance.md), then cache a sanitized local recipe. If either level is unavailable or too broad, stop before import. Do not install a replacement, switch hosts, or develop an adapter during the run.

A raw assignment grant may need to travel in the worker bootstrap because a generic tool API has no transcript-secret channel. Keep it out of durable artifacts and receipts; treat this as an application authorization boundary, not a credential vault.
