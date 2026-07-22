# Mem-import subagent hardening handoff — superseded historical record

> **Status: superseded.** This file records the July 22 runtime-hardening work and two rejected coordinator-driven acceptance attempts. It is not an acceptance contract or current next-step list.
>
> - Installation acceptance authority: [Mem-import Acceptance Simplification and Runtime Safety](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md) and `skills/mem-import/references/acceptance-ladder.md`.
> - Real-import efficiency/evaluation authority: [Mem-import Efficiency and Quality Parity](2026-07-21-001-fix-mem-import-efficiency-parity-plan.md).
> - Current weekly authority map: [Mem-import weekly plan consolidation](2026-07-22-mem-import-weekly-consolidation.md).

## Runtime hardening delivered

Repository `/home/squiddity/projects/pi-herdr-subagents`, branch `feat/explicit-extension-mode`:

- commit `a1d9512 feat: preserve verified subagent profiles on resume`;
- host-HMAC-attested, session-bound, prompt/grant/credential-free launch profile sidecars;
- profile-preserving `subagent_resume` for model, thinking, cwd, config root, named-agent identity, exact tools, deny policy, and explicit extension entries;
- fail-closed handling for malformed or untrusted profiles;
- isolated-unverified legacy resume fallback with no ambient extensions;
- safe bounded regular-file reads and serialized-size limits;
- host-observed active and denied tool telemetry;
- exact/mismatch/unrestricted/unverified completion evidence;
- deny-drift and active-denied-tool detection;
- telemetry capture at `before_agent_start` after startup handlers;
- explicit clearing of null/false child identity and auto-exit environment state.

Validation: 198/198 tests passed, lint reported zero findings, and `git diff --check` passed.

Repository `/home/squiddity/projects/memchat`, branch `feat/world-import-model-led-subagents-u0`:

- `aad7773 feat: require attested mem-import subagent profiles`;
- `046126a docs: require idle waits for mem-import workers`.

These changes strengthen host evidence. They do not authorize a model coordinator to run installation acceptance.

## Rejected runs

Neither run below is acceptance evidence:

1. `.memchat-agent-testing/output/deepseek-flash-pro-acceptance-retry/`
   - one extractor launch had a narrow allowlist;
   - unrestricted helper children participated;
   - raw resume lost the original tool restriction;
   - coordinator-authored `observedTools` was not host authority.
2. `.memchat-agent-testing/output/deepseek-flash-pro-attested-acceptance/`
   - a long-lived DeepSeek Pro coordinator was incorrectly asked to execute semantic stages;
   - it launched a self-waking loop of unassigned Pro wait/no-op children;
   - proposal/merge work was duplicated and reviewer transport failed;
   - the run was interrupted and all runaway panes were closed.

The second incident reinforced an already-decided boundary: acceptance must not be a miniature import. Normal subagent completion is push-delivered; real corpus coordinators end their turn and wait at rest after dispatch.

## Correct disposition

Do not retry either coordinator-driven design. The existing command is focused acceptance for the **Pi SDK adapter only**:

```bash
npm run acceptance:mem-import -- \
  --model <provider/model-id> \
  --thinking high \
  --all-roles
```

It independently materializes each tracked fixture, permits one specified production-tool call, validates SDK host/durable evidence, and stops. Its receipt does not accept `pi-herdr-subagents`. That adapter still requires an equivalent focused host adapter with exact extension/profile/resume telemetry; until it exists, stop rather than substituting an SDK receipt or a model coordinator.

Host-profile and resume conformance are disposable checks, never semantic stage orchestration. Alice and complete import runs are separate evaluation work.
