# Installation acceptance probes

Use these focused probes for a new installation or whenever the effective adapter/profile fingerprint lacks a current accepted receipt. They test exact role allowlists, production-tool transport, authorization, durable effect correlation, and host lifecycle identity. They do **not** run a semantic import pipeline.

Tracked semantic inputs live under `fixtures/mem-import/acceptance/v1/`. A deterministic materializer creates one fresh disposable run per probe, seeds only that probe's prerequisites, issues one live assignment, and resolves runtime IDs, hashes, grants, and read controls. Fixture files never contain runtime authority.

The launcher owns acceptance. Do not launch an acceptance coordinator. Do not disclose the requested corpus input or destination to a probe child.

## Fast path: accepted profile

A cached receipt may skip probes only when deterministic status inspection reports `accepted` for the exact effective fingerprint. The fingerprint includes:

- mem-import protocol and tool-schema version;
- exact role-allowlist hashes;
- adapter and host runtime identity/version;
- worker model ID and thinking setting;
- acceptance fixture version/content hash;
- package or source revision.

Missing, failed, partial, expired, unreadable, or mismatched evidence is not acceptance. Run only the missing or stale role probes. Per-run grants, assignments, dispatch receipts, and checks remain mandatory after cached acceptance.

## Execution rules

For each probe:

1. Materialize a fresh independent probe root from the tracked fixture.
2. For normalization, call the coordinator-owned production normalize tool once.
3. For a semantic role, launch an ordinary subagent directly from the returned live assignment.
4. Set active non-lifecycle tools exactly to `assignment.tools`.
5. Give the child the exact fixture-backed call body and named target production tool.
6. Require exactly one target tool call, then terminal child completion. Do not retry inside the child.
7. Record native host identity, outcome, requested tools, observed tools, model, and thinking.
8. Validate the durable effect through `mem_import_effect_inventory`; do not trust worker prose or inspect files.
9. Persist the sanitized probe receipt. A failed probe receives a fresh root and assignment if retried.

A semantic child prompt is intentionally mechanical: call the named production tool exactly once with the supplied JSON body, then stop. Semantic creativity is evaluated separately.

## Required probes

### Normalize

**Seed:** tracked tiny HTML source only.

**Call once:** `mem_import_normalize`.

**Accept when:** the normalized unit/block expectations match the fixture. This probe is coordinator-direct and does not launch a semantic child.

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

**Seed:** canonical revision, selected review checkpoint/action, and a launcher-preissued worker lease.

**Call once:** `mem_merge_apply_repair_batch`.

**Accept when:** one scoped repair effect creates the expected compact receipt. The launcher releases the lease after child termination; lease setup and cleanup are not child semantic calls.

Until tracked reconciler/repairer fixtures are available for the current fixture version, receipts must mark those roles uncovered rather than infer coverage from core probes.

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

Use `~/.local/state` when `XDG_STATE_HOME` is unset. CI or isolated launchers may override the root.

A receipt records the fingerprint components, required/conditional probe coverage, fixture hash, target tool, assignment/observed tool hashes, sanitized host task identity, durable effect kind/hash, completion time, and `partial` or `accepted` status.

It never records grants, coordinator authority, prompts, source payloads, credentials, filesystem paths, or hidden reasoning.

## Separate semantic evaluation

The three-chapter Alice excerpt is an integration/quality/performance corpus, not installation acceptance. Run it explicitly for coordinator phase behavior, semantic quality, identity consolidation, narrative surfaces, transactions, duration, and token usage. Its result neither creates nor invalidates a profile acceptance receipt.
