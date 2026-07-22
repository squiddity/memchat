# Adapter: Pi SDK worker-transport probes

Use this adapter for focused assignment-bound acceptance when the effective production adapter creates authenticated Pi SDK child sessions directly. Its receipt applies only to the exact `pi-sdk-assignment-bound` fingerprint; it does not accept a different installed subagent adapter.

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

This adapter proves the exact SDK profile recorded in its receipt. A `pi-herdr-subagents` installation needs equivalent host-profile evidence from that adapter; do not combine unrelated adapter evidence into one accepted fingerprint.

The adapter does not run a coordinator, make semantic decisions, chain roles, retry within a child, broaden assignment tools, or treat worker prose as evidence. Failed probes restart from a fresh disposable root.
