# Mem-import subagent hardening handoff

## Objective

Tighten mem-import acceptance so coordinator and worker launches are proven by host-derived tool telemetry, and harden `pi-herdr-subagents` so exact tool/extension profiles survive resume.

## Repository state

### memchat

- Branch: `feat/world-import-model-led-subagents-u0`
- Last pushed commit: `a5bc37b docs: simplify mem-import subagent orchestration`
- The current working tree has validated, uncommitted acceptance-hardening changes.
- Earlier DeepSeek acceptance output under `.memchat-agent-testing/output/deepseek-flash-pro-acceptance-retry/` is **not accepted evidence**. Its extractor launch script was narrow, but unrestricted documentation helpers were launched and the resumed coordinator lost its original `--tools` restriction.

Current memchat edits:

- Active skill/reference guidance now requires:
  - parent → coordinator → worker through one subagent facility;
  - `pi-herdr-subagents` `extensionMode: "explicit"` with the absolute trusted mem-import extension entry;
  - no unassigned helper/documentation children;
  - `subagent_resume`, never raw `pi --session`;
  - host-attested `profileStatus: verified` and `toolProfile.status: exact`;
  - exact host active/denied telemetry, no active denied tools;
  - resumed-profile preservation;
  - lifecycle controls removed only after host exactness is established before recording semantic `observedTools`.
- `src/mem-import/acceptance-service.ts` now requires semantic probe evidence fields:
  - `evidenceSource: "host-runtime"`
  - `profileStatus: "verified"`
  - `toolProfileStatus: "exact"`
  - `isolationMode: "explicit" | "sdk-in-memory"`
  - `auxiliaryLaunchCount: 0`
- `src/mem-import/pi-sdk-acceptance-adapter.ts` emits the SDK-isolated form.
- `src/mem-import-acceptance-fixture.test.ts` is being updated for the stricter fields and includes a guidance contract test. A malformed edit in the fake host return was already fixed. This file still needs build/test validation.

### pi-herdr-subagents

- Repository: `/home/squiddity/projects/pi-herdr-subagents`
- Branch: `feat/explicit-extension-mode`
- Commit `a1d9512 feat: preserve verified subagent profiles on resume` was pushed to `origin/feat/explicit-extension-mode`.
- Initial implementation passed tests but had security review blockers; all known findings were addressed.

Implemented runtime changes:

- Host-HMAC-attested, session-bound, prompt/grant/credential-free launch profile sidecar.
- Sidecar records effective model, thinking, cwd, named-agent identity, exact tool allowlist or unrestricted state, deny list, extension mode/absolute entries, inherited extension entries, and config root.
- `subagent_resume` verifies attestation and session binding, then reapplies tools/model/thinking/cwd/config/deny/extension profile.
- Malformed/untrusted profiles fail closed.
- Legacy/external sessions resume only with `--no-extensions` and are marked isolated-unverified.
- Safe regular-file, no-symlink, nonblocking bounded reads for session/profile/activity/key files; serialized-size limits on writes.
- Named-agent identity restored so recursive self-spawn guard survives resume.
- Host activity telemetry records actual active tools and denied tools.
- Completion reports exact/mismatch/unrestricted/unverified and checks deny drift/active denied tools.
- Explicit extension mode documentation clarifies that it suppresses ambient extension discovery only, not OS access or every config/instruction.
- Raw resume instructions replaced with `subagent_resume`.

Security review history:

1. First review found untrusted sidecar execution, missing named-agent restore, incomplete deny comparison, unsafe reads, and write/read size mismatch. Fixed.
2. Second review found telemetry captured too early and false/null environment state not explicitly cleared. Fixed by:
   - capturing telemetry at `before_agent_start`;
   - always setting/clearing `PI_SUBAGENT_AGENT` and `PI_SUBAGENT_AUTO_EXIT`.

Latest pi-herdr-subagents validation after those final fixes:

- `npm test`: 198/198 passed
- `npm run lint`: 0 warnings/errors
- `git diff --check`: passed

Latest memchat validation:

- `git diff --check`: passed
- `npm run build`: passed
- `npm run test:mem-import`: 47/47 passed

## Remaining work

1. **Review mem-import acceptance boundary**
   - Ensure successful synthetic host fixtures include `exactHostEvidence`.
   - Ensure broadened/clamped tests still fail for their intended reason.
   - Decide whether the corpus `mem_import_record_dispatch` schema also needs explicit profile-status fields, or whether host completion evidence plus stricter installation acceptance is the intended boundary. Do not claim model-supplied `observedTools` is cryptographic host proof.
2. **Inspect both diffs**
   - Confirm no prompts, grants, coordinator authority, credentials, or sensitive task text enter the new subagent sidecars/telemetry.
   - Confirm explicit-mode examples use the actual mem-import extension path/name rather than generic “memory import” wording where appropriate.
3. **Live conformance retry**
   - The first explicit-mode DeepSeek Pro/high coordinator run was interrupted and rejected after it created a self-waking loop of unassigned Pro no-op children (`please-wait`, `w3`–`w12`). It also duplicated proposer/merger work and lost the reviewer to a provider stream failure.
   - All runaway panes were closed. No output from that run is acceptance evidence.
   - Guidance now requires the coordinator to end its turn and wait at rest for push-delivered completion; wait/no-op/monitor children, polling, and ordinary scheduled waits are forbidden.
   - Retry only from a freshly loaded parent runtime and verify the coordinator actually remains idle between worker launches.
4. **Latest follow-up validation**
   - `git diff --check`, `npm run build`, and all 47 `test:mem-import` tests pass after the wait-at-rest guidance change.

## Task tracker

- #8 Harden subagent runtime: completed locally and validated.
- #9 Tighten mem-import acceptance: completed locally and validated.
- #10 Validate both repositories: in progress; automated checks pass, first live conformance was rejected, clean retry remains.
