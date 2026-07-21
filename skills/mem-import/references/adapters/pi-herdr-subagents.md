# Adapter: pi-herdr-subagents

Load this reference only when the active catalog exposes the Herdr `subagent` facility.

## Dispatch profile

- Pass the assignment bootstrap in the child task.
- Set `tools` to the comma-separated `assignment.tools` array exactly. Herdr converts it to the child Pi `--tools` allowlist.
- Set an explicit authenticated `model`, `thinking`, and repository `cwd` on every semantic launch.
- Use fresh/lineage context for bounded roles; avoid full conversation forks unless the task genuinely needs parent history.
- Use the returned host child/session ID for `mem_import_record_dispatch`.
- Treat the automatic terminal steer as lifecycle completion; use interruption/resume facilities for recovery.

For the current acceptance profile:

- coordinator: `openrouter/deepseek/deepseek-v4-pro`, `high`;
- workers: `openrouter/deepseek/deepseek-v4-flash`, `high`.

These are installation test choices, not portable mem-import requirements.

## Local acceptance workspace

Keep disposable configuration under `<repo>/.memchat-agent-testing/.pi/settings.json` with the repository package loaded as `../..`. Launch the long-lived coordinator from `<repo>/.memchat-agent-testing/`, so output roots are `output/<run>` or absolute repository-contained paths.

The coordinator profile contains coordinator mem-import tools plus `subagent` and adapter-owned subagent lifecycle controls; it excludes shell, generic file reads, and generic mutation. The launcher must preload the applicable workflow and role guidance. During acceptance and corpus runs, ordinary subagents are reserved for assigned semantic roles; source and ledger access occurs through typed mem-import tools.

When acceptance is required, the supervising launcher materializes independent tracked-fixture probes and launches each semantic child directly from its live assignment. Do not launch an acceptance coordinator. Require one named production-tool call, validate the automatic terminal result plus `mem_import_effect_inventory`, persist the sanitized receipt, and only then launch the separate corpus coordinator.

Worker profiles contain only `assignment.tools` plus adapter-owned lifecycle controls. Extra installed extensions may exist, but the active `--tools` allowlist is the model-visible boundary.

## Supervised launcher

A stronger launcher may supervise a cheaper coordinator and workers without becoming a semantic worker. It may inspect native host lifecycle state and durable mem-import status, then steer the coordinator when a child stalls, terminates without an effect, repeats malformed calls, or the coordinator waits despite having no active children. It must not author extraction, proposal, merge, review, or repair effects inline.

Treat host lifecycle as authoritative: once the facility reports a child terminal, record its actual outcome and inspect the ledger. Retry through a fresh assignment when the expected effect is absent. Supervision messages must not include grants or broaden worker tools.

## Conformance gate

Before substantive work, run the required independent role probes. Each probe:

1. receives the exact fixture-backed body for one named production tool;
2. calls that production tool exactly once and does not retry;
3. has no shell, generic write, recursive coordinator, or unrelated mem-import tool active;
4. returns a correlatable terminal child ID;
5. records requested and observed tools equal to `assignment.tools`;
6. produces exactly one expected durable effect discoverable through `mem_import_effect_inventory`.

Model-visible allowlisting is not an operating-system sandbox. Report only the controls actually observed.
