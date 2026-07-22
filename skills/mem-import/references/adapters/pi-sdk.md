# Adapter: Pi SDK assignment-bound acceptance

Use this adapter for focused installation acceptance when the repository can create authenticated Pi SDK child sessions directly.

## Contract

`PiSdkAcceptanceHostAdapter` in `src/mem-import/pi-sdk-acceptance-adapter.ts`:

- builds every launch from the live prepared assignment;
- creates an in-memory child session, so the prompt and assignment grant are not written to a session transcript;
- activates exactly `assignment.tools` and no builtin tools;
- records the child session ID as the opaque host task ID;
- derives observed tools from the child agent runtime;
- derives target call count and failure state from Pi tool lifecycle events;
- returns native lifecycle evidence to the focused acceptance runner.

The runner records the dispatch, validates the durable effect inventory, releases a repairer lease in `finally`, and persists only a sanitized acceptance receipt.

## Command

Run core probes:

```bash
npm run acceptance:mem-import -- \
  --model <provider/model-id> \
  --thinking high
```

Include conditional reconciler and repairer probes before using that exact profile for those roles:

```bash
npm run acceptance:mem-import -- \
  --model <provider/model-id> \
  --thinking high \
  --all-roles
```

Optional `--state-root` and `--disposable-root` arguments select local acceptance state and disposable probe roots. Runtime authority remains confined to in-memory child prompts and disposable run ledgers; it is never copied into acceptance receipts or tracked fixtures.

## Boundaries

This adapter is a focused acceptance host, not a corpus coordinator. It does not make semantic decisions, retry within a child, broaden assignment tools, or treat worker prose as evidence. Failed probes must be retried from a fresh disposable root.
