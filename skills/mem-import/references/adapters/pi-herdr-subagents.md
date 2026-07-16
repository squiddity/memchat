# Known adapter profile: pi-herdr-subagents

Load this reference only when the active tool catalog or installed local documentation identifies the Herdr subagent facility.

The plan identifies this family as useful for interactive visible-pane work: it can expose a fresh/lineage/fork context choice and per-spawn task, model, thinking, skill, tool, and cwd controls, with worker panes that remain inspectable and interruptible.

## U0 use

- Inspect the actual installed tool schema; tool names and supported fields are harness/version specific.
- Dispatch one low-risk scout with a distinct task label and the narrowest available tool request.
- Prefer fresh or lineage-only context unless the parent intentionally needs shared conversation context.
- Observe task/result correlation, completion delivery, and any interruption behavior exposed by the current harness.
- Treat requests for restricted tools as unproved until later hardening tests their enforcement. If a requested control is absent, record that limitation and decide whether the scout remains harmless enough to run.

## Not part of U0

Do not create a Herdr extension, rely on a worker receipt as canonical world state, or infer that visible panes prove isolation, hard cancellation, timeout handling, or telemetry completeness. The coordinator chooses whether observed behavior is adequate for the next bounded task.
