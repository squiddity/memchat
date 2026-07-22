# Optional maintainer conformance: Pi SDK

This adapter runs optional fixture-backed production-tool conformance in authenticated, in-memory Pi SDK sessions. Use it when maintaining tool schemas, authorization, fixtures, or acceptance services—not for mem-import preflight or facility certification.

## Contract

`PiSdkAcceptanceHostAdapter` in `src/mem-import/pi-sdk-acceptance-adapter.ts`:

- builds every launch from the live prepared assignment;
- creates an in-memory child session, so the prompt and assignment grant are not written to a session transcript;
- activates exactly `assignment.tools` and no builtin tools;
- records the child session ID as the opaque host task ID;
- derives observed tools from the child agent runtime;
- derives target call count and failure state from Pi tool lifecycle events;
- returns native lifecycle evidence to the focused acceptance runner.

The runner records dispatch, validates durable effects, releases a repairer lease in `finally`, and persists only a sanitized receipt.

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

Optional `--state-root` and `--disposable-root` select local conformance and probe roots. Runtime authority stays in memory or in disposable ledgers, never receipts or tracked fixtures.

## Boundaries

The suite proves only its SDK transport and tracked tool routes. It is not a required programmatic adapter and its receipt is not brief facility acceptance.

It does not run a coordinator, make semantic decisions, chain roles, retry within a child, broaden tools, or treat worker prose as evidence. Retry failed probes from a fresh disposable root.
