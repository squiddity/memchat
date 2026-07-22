# Installation acceptance probes

Use these focused probes for a new installation or whenever the effective adapter/profile fingerprint lacks a current accepted receipt. They test exact role allowlists, production-tool transport, authorization, durable effect correlation, and host lifecycle identity. They do **not** run a semantic import pipeline.

Tracked semantic inputs live under `fixtures/mem-import/acceptance/v1/`. A deterministic materializer creates one fresh disposable run per probe, seeds only that probe's prerequisites, issues one live assignment, and resolves runtime IDs, hashes, grants, and read controls. Fixture files never contain runtime authority.

The parent verifies the installed facility and launches the corpus coordinator through `subagent`; that coordinator owns the focused role probes and then continues the requested import. Do not disclose the requested corpus input or destination to probe workers. The supported interactive topology is documented in [the pi-herdr-subagents adapter](adapters/pi-herdr-subagents.md).

## Required facility topology

Before fixture probes, assess the live installation described by [the subagent installation gate](subagent-capabilities.md). Acceptance requires evidence that:

- the current coordinator was launched by the parent through `subagent` with `extensionMode: "explicit"` and only the trusted mem-import extension entry;
- the host reports a valid attested launch profile and active/denied tool telemetry for the coordinator;
- it can launch an exact-allowlist assigned worker through the same inherited explicit runtime;
- `subagent_resume` reapplies the original coordinator/worker model, thinking, cwd, config root, extension runtime, deny policy, and tool allowlist;
- initial and resumed completions report `profileStatus: verified` and `toolProfile.status: exact`;
- both levels expose correlatable host identities and terminal lifecycle outcomes;
- no unassigned, unrestricted, or documentation/helper child is launched.

A worker-only adapter test, a launch command, the tools widget alone, or coordinator-authored `observedTools` is partial evidence. None can accept an installation without host-derived exact profile telemetry for both levels.

## Fast path: accepted profile

A cached receipt may skip probes only when deterministic status inspection reports `accepted` for the exact effective fingerprint. The fingerprint includes:

- mem-import protocol and tool-schema version;
- installed subagent extension and host runtime identity/version;
- explicit extension mode and trusted absolute extension-entry hashes;
- coordinator attested-profile hash, active/denied-tool hashes, model ID, and thinking setting;
- exact worker role allowlist, host-observed active/denied-tool hashes, model ID, and thinking setting;
- resume-profile preservation probe version/result;
- acceptance fixture version/content hash;
- package or source revision.

Missing, failed, partial, expired, unreadable, or mismatched evidence is not acceptance. Run only the missing or stale role probes. Per-run grants, assignments, dispatch receipts, and checks remain mandatory after cached acceptance.

## Execution rules

For each probe:

1. Materialize a fresh independent probe root from the tracked fixture.
2. For normalization, call the coordinator-owned production normalize tool once.
3. For a semantic role, launch a worker through `subagent` from the returned live assignment; never launch helper children.
4. Set semantic worker tools exactly to `assignment.tools`, inherit explicit extension mode, and provide the exact fixture-backed call body. The facility may add only its documented lifecycle controls.
5. Require host completion evidence with an attested profile, `profileStatus: verified`, `toolProfile.status: exact`, exact active and denied tool sets, expected model/thinking, and terminal identity. Reject unrestricted/unverified/mismatched evidence even when the target effect exists.
6. Require exactly one target production-tool call, then terminal worker completion. Do not retry inside the child.
7. Record semantic `observedTools` only after removing documented lifecycle controls from the host-observed exact set; never copy the assignment into observed evidence.
8. Validate the durable effect through `mem_import_effect_inventory`; do not trust child prose or the model-authored dispatch record alone.
9. Persist the sanitized probe receipt. A failed probe receives a fresh root and worker assignment if retried.

A semantic child prompt is intentionally mechanical: call the named production tool exactly once with the supplied JSON body, then stop. Semantic creativity is evaluated separately.

## Required probes

### Resume preservation

**Seed:** a harmless exact-allowlist disposable child launched under explicit extension mode.

**Action:** let it terminate or ping, then resume only with `subagent_resume`.

**Accept when:** initial and resumed host evidence is attested and `verified`/`exact`; active tools, deny policy, model, thinking, cwd, config root, extension mode/entries, and named-agent identity are unchanged. Missing legacy profiles, raw `pi --session`, unrestricted fallback, or resume drift fail the installation.

### Normalize

**Seed:** tracked tiny HTML source only.

**Call once:** `mem_import_normalize`.

**Accept when:** the current coordinator's launched profile is exact and the normalized unit/block expectations match the fixture. This probe launches no semantic worker.

### Extractor

**Seed:** normalized two-paragraph source.

**Call once:** `mem_extraction_submit`.

**Accept when:** one extraction effect exists for the assigned task, derived provenance quotes match normalized anchors, the observed allowlist equals the extractor assignment, and host outcome is completed.

### Proposer

**Seed:** accepted extraction packet.

**Call once:** `mem_proposal_submit`.

**Accept when:** one immutable proposal effect exists, every fixture candidate has one disposition, observed tools equal the proposer assignment, and host outcome is completed.

### Merger

**Seed:** accepted proposal and empty canonical baseline.

**Call once:** `mem_merge_commit`.

**Accept when:** one merge effect exists, the compact receipt reports the expected artifacts/accounting, the proposal is consumed, observed tools equal the merger assignment, and host outcome is completed.

### Reviewer

**Seed:** canonical fixture revision.

**Call once:** `mem_review_submit`.

**Accept when:** one immutable revision-bound review effect exists with the tracked checkpoint, observed tools equal the reviewer assignment, and host outcome is completed.

## Conditional probes

Run these independently before using the corresponding profile in a maintained compendium:

### Reconciler

**Seed:** purpose-built proposal and canonical alternatives.

**Call once:** `mem_identity_submit`.

**Accept when:** one immutable identity effect preserves the fixture decisions and any declared ambiguity/conflict data.

### Repairer

**Seed:** canonical revision, selected review checkpoint/action, and a parent-preissued worker lease.

**Call once:** `mem_merge_apply_repair_batch`.

**Accept when:** one scoped repair effect creates the expected compact receipt. The parent releases the lease after child termination; lease setup and cleanup are not child semantic calls.

The version-1 tracked fixture includes both conditional probes. Receipts still mark them uncovered unless they were explicitly run for the exact role profile.

## What remains deterministic

Do not spend model turns on negative or scale cases. The matching software revision must pass deterministic tests for:

- terminal failure/finalization mutation guards;
- no-op transaction rejection;
- incomplete candidate accounting;
- stale canonical read tokens;
- weighted merge limits;
- pagination and response-size bounds;
- retry task identity and revocation;
- historical reconstruction and interruption recovery;
- tiny `normalize → extract → propose → merge → review → checks → finalize` compatibility;
- 500-unit / 5,000-candidate / 1,000-artifact inventory pressure.

## Acceptance receipt

Write sanitized receipts under:

```text
$XDG_STATE_HOME/memchat/mem-import/acceptance/<profile-fingerprint>.json
```

Use `~/.local/state` when `XDG_STATE_HOME` is unset. CI may override the root.

A receipt records the fingerprint components, explicit runtime/extension-entry hashes, host-attested coordinator and worker profile evidence, active/denied-tool hashes, resume preservation result, required and conditional probe coverage, fixture hash, target tool, sanitized child identities, durable effect kind/hash, completion time, and `partial` or `accepted` status.

It never records grants, coordinator authority, prompts, source payloads, credentials, filesystem paths, or hidden reasoning.

## Separate semantic evaluation

The three-chapter Alice excerpt is an integration/quality/performance corpus, not installation acceptance. Run it explicitly for coordinator phase behavior, semantic quality, identity consolidation, narrative surfaces, transactions, duration, and token usage. Its result neither creates nor invalidates a profile acceptance receipt.
