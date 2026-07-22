# Known adapter profile: pi-subagents

Load this reference only when the installed extension and active catalog expose its subagent facility.

Mem-import requires one facility to support the full two-level topology: the parent launches the coordinator, and that coordinator launches exact-assignment workers. Inspect the installed version and actual tool schema; never infer compatibility from the package or profile name.

Accept this facility only when it provides:

- fresh bounded coordinator and worker contexts;
- explicit model, thinking, cwd, and tool profiles;
- a coordinator profile that includes mem-import coordinator tools and recursive subagent launch;
- worker profiles whose model-visible tools equal `assignment.tools`;
- host child/session IDs, terminal outcomes, interruption, and resume or fresh-retry behavior at both levels.

Run the [subagent installation gate](../subagent-capabilities.md) and focused [acceptance probes](../acceptance.md). If either level is unavailable or broader than policy permits, stop before import. Do not pin or install a replacement dependency, create a CLI host, switch to inline execution, or develop an adapter during the run.

A raw assignment grant may need to travel in the worker bootstrap because a generic tool API has no transcript-secret channel. Keep it out of durable artifacts and receipts; treat this as an application authorization boundary, not a credential vault.
