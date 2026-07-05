# Interactive-shell playtesting

Use this when a human wants to try memchat in a real shell or when the agent needs to supervise a live CLI session.

For herdr-managed shell jobs, prefer a dedicated pane **below** the current pane for the live session you are monitoring. Avoid side panes for routine playtest/import job supervision.

## Agent defaults

Unless the user asks otherwise:

- launch memchat with the `interactive_shell` tool
- use `mode: "interactive"` for human-driven playtesting
- use `--memory qmd-hybrid`
- use `--memory-debug`
- create a fresh timestamped memory directory, usually under `/tmp/`
- reuse an existing memory directory only when the user wants continuity or inspection of prior memory state

Recommended launch shape from the repo root:

```ts
interactive_shell({
  command: "npm run dev -- --memory qmd-hybrid --memory-debug --memory-dir /tmp/memchat-<date>-<run>",
  cwd: "/home/alan/ai-projects/memchat",
  mode: "interactive",
  reason: "Manual memchat playtest with a fresh memory directory"
})
```

Use `hands-free` instead of `interactive` when the agent should keep working, poll output later, or send commands into the running session.

## Example hands-free launch

```ts
interactive_shell({
  command: "npm run dev -- --memory qmd-hybrid --memory-debug --memory-dir /tmp/memchat-<date>-<run>",
  cwd: "/home/alan/ai-projects/memchat",
  mode: "hands-free",
  reason: "Observe memchat TUI memory behavior",
  handsFree: { autoExitOnQuiet: false }
})
```

Follow-up examples:

```ts
interactive_shell({ sessionId: "<session-id>", outputLines: 80 })
interactive_shell({ sessionId: "<session-id>", input: "/memory status", submit: true })
interactive_shell({ sessionId: "<session-id>", input: "/memory recall brass telescope", submit: true })
interactive_shell({ sessionId: "<session-id>", kill: true })
```

## Suggested manual scenario

1. Start with a fresh memory directory.
2. Establish several fictional facts.
3. Enter accidental content and use `/memory ignore last` or `/memory ignore recent <n>`.
4. Run `/new` and verify the lifecycle message appears before the next prompt.
5. Restart memchat against the same memory directory.
6. Use `/memory status`, `/memory recall <query>`, and direct questions to check durable recall.

## Related docs

- CLI and flags: [`docs/cli.md`](./cli.md)
- backend behavior: [`docs/memory-backends.md`](./memory-backends.md)
- smoke validations: [`docs/smoke-tests.md`](./smoke-tests.md)
