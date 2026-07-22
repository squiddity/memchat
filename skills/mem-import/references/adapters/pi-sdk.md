# Optional maintainer conformance: Pi SDK

This repository adapter runs fixture-backed production-tool conformance through authenticated in-memory Pi SDK sessions. It is useful when changing tool schemas, authorization, fixtures, or acceptance-service code. It is **not** normal mem-import preflight and does not certify another installed subagent facility.

## Contract

`PiSdkAcceptanceHostAdapter` in `src/mem-import/pi-sdk-acceptance-adapter.ts`:

- builds every launch from the live prepared assignment;
- creates an in-memory child session, so the prompt and assignment grant are not written to a session transcript;
- activates exactly `assignment.tools` and no builtin tools;
- records the child session ID as the opaque host task ID;
- derives observed tools from the child agent runtime;
- derives target call count and failure state from Pi tool lifecycle events;
- returns native lifecycle evidence to the focused acceptance runner.

The runner records the dispatch, validates the durable effect inventory, releases a repairer lease in `finally`, and persists only a sanitized conformance receipt.

## Optional maintainer command

Run core conformance probes:

```bash
npm run conformance:mem-import -- \
  --model <provider/model-id> \
  --thinking high
```

Include conditional reconciler and repairer probes when validating all fixture/tool routes:

```bash
npm run conformance:mem-import -- \
  --model <provider/model-id> \
  --thinking high \
  --all-roles
```

Optional `--state-root` and `--disposable-root` arguments select local conformance state and disposable probe roots. Runtime authority remains confined to in-memory child prompts and disposable run ledgers; it is never copied into conformance receipts or tracked fixtures.

## Boundaries

This suite proves only its SDK transport and tracked production-tool routes. Do not require a comparable programmatic adapter for every subagent extension and do not combine its receipt with brief facility acceptance.

The adapter does not run a coordinator, make semantic decisions, chain roles, retry within a child, broaden assignment tools, or treat worker prose as evidence. Failed conformance probes restart from a fresh disposable root.
