# Mem-import simplification plan

> **Status: implemented design input, no longer an acceptance authority.** The golden-path role/tool simplification remains relevant. Normal installation acceptance is the brief facility check in `skills/mem-import/references/acceptance.md`; the [July 21 focused-probe plan](2026-07-21-002-fix-mem-import-acceptance-simplification-plan.md) now documents optional maintainer conformance and runtime safety. Alice and full-import efficiency evaluation are governed by [the efficiency/parity plan](2026-07-21-001-fix-mem-import-efficiency-parity-plan.md).

## Goal

Turn the experimental import coordinator into a predictable, skill-driven pipeline that scales from one book to a series. Semantic judgment remains model-owned; deterministic tools own packet construction, authorization, bounded state, provenance transcription, concurrency, and accounting.

## Evidence

Extraction is stable because its tools expose an explicit packet schema and a narrow assignment. U2b failed after extraction because later roles had to reconstruct hidden state and repeatedly transcribe protocol fields:

- proposal and identity packets could not be read by downstream workers;
- artifact and disposition arguments were untyped;
- mergers repeated proposal artifacts instead of accepting them by reference;
- artifact read hashes required by `readSet` were not returned by reads;
- models threaded leases, fences, global revision/hash CAS, proposal hashes, read sets, operations, and accounting across calls;
- worker-visible legacy snapshot tools competed with the bounded path;
- skill references duplicated evolving tool contracts and contained stale milestone/test guidance.

## Design principles

1. **Golden path:** each role has one obvious read → decide → submit path.
2. **Semantic bodies:** models submit semantic decisions; services derive version, kind, IDs, packet hashes, quotes, baselines, and transaction controls.
3. **References, not retranscription:** downstream work reads and accepts immutable proposal artifacts by hash and ID.
4. **Opaque observations:** canonical reads return artifact hashes/read tokens directly consumable by commit.
5. **Atomic bounded commit:** one merger call acquires, fences, validates, commits, and releases internally.
6. **Complete local accounting:** every proposer assignment accounts for every assigned candidate; merge carries accepted accounting forward automatically.
7. **Optional reconciliation:** fresh-corpus merges do not require a reconciliation wave. Reconciliation is used for cross-shard or existing-canon identity questions.
8. **Exact profiles:** assignment results carry the exact host-enforced worker tool allowlist. Legacy snapshot and lifecycle tools are absent from production worker profiles.
9. **One attested subagent facility:** the parent launches the coordinator in explicit extension mode, the coordinator uses the same facility for workers, and host telemetry proves exact active/denied tools across initial and resumed sessions.
10. **Durable resumability:** a coordinator status tool reports unconsumed proposals, conflicts, accounting gaps, and canonical revision without relying on conversation history.
11. **Concise skills:** `SKILL.md` contains the run-mode branch, golden path, and completion criteria. Tool schemas are the argument authority. Role files contain purpose, exact tools, steps, durable output, done criterion, and failure response.

## Target role flow

### Extractor

Read assigned units and submit explicit provenance-anchored candidates. Existing flow remains, with packet boilerplate removed later only if evidence warrants it.

### Proposer

Read assigned extraction packets and submit:

- complete typed artifacts;
- exactly one disposition for every assigned candidate;
- concise rationale.

The service derives packet ID, input packet hashes, candidate scope, version/kind, and exact quotes.

### Reconciler (conditional)

Read assigned proposal artifacts and bounded canonical observations. Submit discriminated decisions whose subject is `{ proposalHash, artifactId }`. The service derives packet identity and baseline controls. Unrelated commits do not stale a decision when its bounded canonical observations are unchanged.

### Merger

Read immutable proposals and canonical artifacts, then call one bounded commit tool. The default operation accepts a proposal artifact by reference and optionally assigns a canonical ID. An explicit replacement artifact is available only for intentional cross-proposal synthesis. The service carries proposal dispositions, acquires/releases the lease, and records the transaction.

### Reviewer / repairer

Reviewer reads a revision-bound bounded view and submits findings. Repair remains action-scoped and uses the same atomic bounded commit mechanics.

## Implementation order

### A. Make current contracts visible

- Add exact artifact and candidate-disposition TypeBox schemas.
- Return exact role tools in assignment results/briefs.
- Return per-artifact hashes from canonical inventory and reads.
- Add bounded proposal and identity inventory/read tools.
- Remove worker registration and role guidance for complete-snapshot tools.

**Complete when:** a worker can discover every required field and every downstream immutable input without reading prose or provoking validation errors.

### B. Remove protocol transcription

- Add semantic-body proposal submission; derive envelope/input hashes and enforce complete candidate accounting.
- Add discriminated, proposal-qualified identity decisions.
- Add proposal-reference merge operations and automatic accounting carry-forward.
- Add atomic `mem_merge_commit`; remove lease/fence/global-CAS arguments from model-visible tools.

**Complete when:** proposer, reconciler, and merger happy paths each have one submit/commit call whose arguments contain semantic choices only.

### C. Contract the skills

- Rewrite `SKILL.md` around run mode, preflight, golden path, and completion/failure criteria.
- Move Herdr test setup and fixed model choices to the Herdr adapter reference.
- Make tool schemas/helper reference the single argument authority; remove duplicated JSON contracts and historical U-labels.
- Normalize role files to one short template and exact arrays returned by assignment tools.

**Complete when:** every runtime sentence changes behavior, each concept has one authority, and branch-specific detail is behind a clear context pointer.

### D. Validate scale and recovery

- Add ergonomic contract tests for model-visible schemas and proposal/identity reads.
- Add atomic-commit concurrency/interruption tests.
- Add candidate-accounting and unconsumed-proposal status tests.
- Run a fresh Alice import with early-wave inspection, then a multi-work compendium fixture.

**Complete when:** fresh Alice finalizes with no errors after one installed subagent facility launches coordinator and workers under explicit mode; every initial/resumed profile is host-attested verified/exact, no unrestricted helper launches occur, and bounded inventories/transactions remain page-safe.

## Migration

Use a clean, new-run-only protocol revision. Failed historical U2b full-run outputs remain diagnostic/evaluation evidence and are not upgraded into installation acceptance. Internal snapshot reconstruction APIs may remain for tests and history, but snapshot mutation/read tools are not exposed to semantic workers.
