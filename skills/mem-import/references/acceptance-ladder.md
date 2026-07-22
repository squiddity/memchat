# Installation acceptance probes

Installation acceptance answers one question:

> Can this exact host adapter, extension set, model/thinking profile, and role tool allowlist invoke the production tools required by a real import?

It does **not** test whether a coordinator can plan or complete an import. The acceptance harness owns every probe. A corpus coordinator never runs acceptance, never receives acceptance fixture authority, and never continues from an acceptance probe into a corpus run.

## Authority and invocation

The implementation authority is:

- `scripts/run-mem-import-focused-acceptance.ts`;
- `src/mem-import/focused-acceptance-runner.ts`;
- `src/mem-import/acceptance-materializer.ts`;
- `src/mem-import/acceptance-service.ts`;
- `fixtures/mem-import/acceptance/v1/`.

Use the adapter-specific command in [Pi SDK probes](adapters/pi-sdk.md), or an equivalent host adapter that satisfies the same evidence contract. Run acceptance **before** launching the requested corpus coordinator. If the parent cannot invoke an accepted harness, stop and provide the command; do not improvise acceptance with a free-running model.

## Probe shape

Each semantic probe is independent:

1. The deterministic materializer creates a fresh disposable run.
2. It seeds only the tracked prerequisites for one target call.
3. It issues one live assignment and resolves runtime authority outside tracked fixtures.
4. The host launches one assignment-bound child with exactly `assignment.tools` plus documented lifecycle controls.
5. The child receives one mechanical instruction: call the named production tool exactly once with the supplied body, then stop.
6. The host verifies model/thinking, terminal identity, `profileStatus: verified`, `toolProfile.status: exact`, exact active/denied tools, and zero helper launches.
7. The harness validates exactly one durable effect and persists a sanitized probe receipt.

There are no model-planned dependencies between probes. A probe never normalizes for a later model, discovers stage state, launches another role, retries itself, merges a preceding probe, reviews a probe merge, runs checks, or finalizes a run. Failed probes restart from a fresh disposable root.

## Required production-tool probes

Normalization is the sole coordinator-direct probe. The harness calls `mem_import_normalize` once against the tiny tracked source, then validates normalized status and fixture unit/block expectations. It has no worker assignment, child lifecycle evidence, dispatch receipt, or semantic effect. The assignment-bound recipe above applies only to semantic role probes.

| Probe | Independently seeded state | Exactly one target call |
|---|---|---|
| Normalize | Tiny tracked HTML source | `mem_import_normalize` |
| Extractor | Normalized two-paragraph source and live assignment | `mem_extraction_submit` |
| Proposer | Accepted tracked extraction packet and live assignment | `mem_proposal_submit` |
| Merger | Accepted tracked proposal, empty baseline, and live assignment | `mem_merge_commit` |
| Reviewer | Canonical fixture revision and live assignment | `mem_review_submit` |

Run these conditional probes before using their exact role profile:

| Probe | Independently seeded state | Exactly one target call |
|---|---|---|
| Reconciler | Tracked proposal and canonical alternatives | `mem_identity_submit` |
| Repairer | Canonical revision, selected review action, preissued lease, and live assignment | `mem_merge_apply_repair_batch` |

Lease setup and cleanup are harness operations, not child semantic calls.

## Host-profile conformance

Production-tool probes must use host-derived evidence, not assignment echoes or worker prose. Accept only when:

- the intended extension entries and runtime mode are active;
- observed semantic tools exactly equal the assignment allowlist;
- only documented lifecycle controls are additional;
- deny telemetry matches and no denied tool is active;
- model and thinking match the requested profile;
- lifecycle identity and terminal outcome are host-derived;
- no unrestricted, unverified, documentation, wait, monitor, or helper child participated.

Resume preservation is a separate host conformance probe. Resume one disposable profile only through the facility's supported resume operation and verify unchanged model, thinking, cwd, config root, extension mode/entries, allowlist, deny policy, and named-agent identity. Do not combine resume testing with semantic stage progression or a corpus run.

A launch command, tools widget, model-authored `observedTools`, successful effect, or worker prose cannot substitute for host telemetry. `mismatch`, `unrestricted`, `unverified`, missing telemetry, deny drift, active denied tools, raw session resume, or helper launches fail the affected profile.

## Cache and receipt

A cached receipt is valid only for the exact fingerprint of:

- protocol, tool-schema, fixture, package/source revision;
- host adapter/runtime and extension entries;
- model and thinking setting;
- role allowlists and observed active/denied-tool hashes;
- host-profile and resume-conformance version.

Receipts live under:

```text
$XDG_STATE_HOME/memchat/mem-import/acceptance/<profile-fingerprint>.json
```

They contain sanitized profile status, probe/effect hashes, coverage, child identity, and completion time. They never contain grants, coordinator authority, prompts, source payloads, credentials, filesystem paths, or hidden reasoning.

Per-run assignments, dispatch receipts, authorization, and checks remain mandatory after acceptance. Acceptance proves capability, not future behavior.

## What acceptance excludes

Do not use installation acceptance for:

- a free-running or long-lived acceptance coordinator;
- a normalize → extract → propose → merge → review → repair pipeline;
- corpus checks or finalization;
- semantic quality, identity judgment, synopsis quality, or efficiency;
- Alice or another book-sized fixture;
- negative/scale/concurrency matrices already covered deterministically.

Cross-stage compatibility belongs to deterministic integration tests. Alice belongs to an explicitly requested semantic quality and efficiency evaluation. Neither creates nor invalidates an installation acceptance receipt.
