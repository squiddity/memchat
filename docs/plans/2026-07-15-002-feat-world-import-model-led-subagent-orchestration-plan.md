---
title: "feat: Move world-import to model-led subagent orchestration with typed tools"
type: feat
date: 2026-07-15
origin: conversation and subagent-extension research
status: decision-ready; implementation not started
---

# feat: Move world-import to model-led subagent orchestration with typed tools

## Goal Capsule

Evolve `world-import` from a separate TypeScript program that hard-codes semantic session sequencing into a **thin, model-led orchestration workflow**:

- the main/parent agent reads one world-import coordinator skill;
- deterministic world-import operations are exposed as typed tools instead of being invoked through `bash`;
- the parent inspects durable source, extraction, merge, review, and diagnostic artifacts and decides what to do next;
- the parent may launch individual workers, parallel fleets, chains, or a facility-native dynamic graph when the available subagent system supports them;
- worker roles receive only the tools appropriate to their role;
- deterministic contracts reject invalid operations and finalization refuses incomplete output;
- model choice, thinking level, worker topology, escalation, repeated review, and repair strategy remain visible experimental variables;
- the existing standalone CLI becomes a small host for the same skill and tools while preserving output artifact parity.

This plan is self-contained so a new session can resume design or implementation without replaying the originating discussion.

## Decision Summary

### Confirmed decisions

1. **Use a thin, model-owned coordinator skill as the primary control plane.** Do not replace the current runner with a single opaque `run_world_import_dag` tool.
2. **Move helper access from shell commands to typed tools.** Existing deterministic TypeScript functions remain the implementation source of truth; the command router can remain as a human/CLI adapter.
3. **Let the parent choose the orchestration shape.** The skill documents required subagent capabilities and available adapter profiles. The parent may use single launches, parallel calls, chains, dynamic fanout, or a model-authored DAG when that is the best fit.
4. **Use durable world-import artifacts as authoritative handoffs.** Subagent prose and chain `{previous}` values may be useful receipts or summaries but must not be the only handoff state.
5. **Enforce local validity and final completeness, not one rigid stage order.** Tools reject impossible/unsafe operations; diagnostics describe incomplete drafts; a final gate refuses success while structural/accounting blockers remain.
6. **Constrain workers with tool allowlists.** Extraction workers, reviewers, mergers, and repairers receive different typed tools; `bash` and generic write tools can be absent.
7. **Use hybrid review.** Deterministic review remains code; semantic review is performed inline by the parent or by constrained reviewer subagents.
8. **Require an existing compatible subagent facility.** If none is available, fail with concrete setup guidance. Do not ask the model to create a new worker extension during an import.
9. **Support model tiering as a first-class experiment.** Parent and workers may use different models/thinking levels, and actual resolved runtime and usage should be audited.
10. **Shrink the standalone CLI.** It should configure and host the workflow, not duplicate stage sequencing.
11. **Preserve artifact parity, not exact runner behavior.** Existing output layouts, semantic stage contracts, readiness checks, and audit intent remain stable; invocation/session mechanics may change.
12. **Hold off on building a custom SDK subagent wrapper.** First evaluate `pi-subagents` as the Herdr-free/CLI worker facility. Retain an adapter boundary so an SDK implementation can be added later if needed.
13. **Authorize every worker through a durable cross-process assignment grant.** A worker may use typed tools only for its assigned run, role, units/artifacts/actions, and validity window; typed tools validate the grant independently in every child process.
14. **Give the CLI a non-semantic lifecycle supervisor.** The host waits for authoritative finalized/failed/cancelled state, worker completion, and bounded coordinator continuation without choosing semantic stages.
15. **Enforce one global merge writer with a lease and revision check.** Atomic file replacement alone is insufficient to prevent lost updates from concurrent merger/repair processes.
16. **Require trusted adapter profiles or executable conformance probes.** Tool descriptions alone cannot prove allowlist enforcement, recursion prevention, correlation, or cancellation behavior.

### Important terminology

This design is best described as **dynamic artifact-driven orchestration**.

A dependency graph will exist and may be explicitly recorded, but “DAG” does not mean TypeScript owns the semantic pipeline. The main model may author or revise the graph itself, incrementally or in one facility-native chain call.

## Relationship to Earlier Plans

This plan preserves the semantic and artifact principles from:

- `docs/plans/2026-06-24-001-feat-model-only-world-import-plan.md`
- `docs/plans/2026-07-02-001-feat-world-import-staged-session-orchestration-plan.md`
- `docs/plans/2026-07-05-001-feat-world-import-helper-tooling-plan.md`
- `docs/plans/2026-07-07-001-feat-world-import-staged-review-plan.md`
- `docs/plans/2026-07-15-001-feat-world-import-invocation-audit-plan.md`

It changes one major control-plane decision from the staged orchestration plan:

- **Previously:** TypeScript runner code chose `extract → merge → readiness → review → repair → final eval` session order.
- **Now:** the parent agent chooses worker topology and sequencing after inspecting durable state. Typed tools and deterministic gates enforce contracts, while the standalone runner becomes a host rather than the semantic scheduler.

The previous runner remains useful as a source of tested readiness, repair verification, audit, and failure-handling behavior. Those responsibilities should be retained in shared deterministic services, not discarded.

## Current Implementation Baseline

### What exists today

- `src/world-import-cli.ts` parses CLI options and calls `runWorldImportSkill(...)`.
- `src/world-import/model-runner.ts` creates hermetic embedded Pi sessions and hard-codes staged orchestration.
- The runner loads `skills/world-import/SKILL.md` and invokes it with stage hints.
- The embedded import agent receives ordinary Pi tools, especially `bash`.
- The skill invokes deterministic helpers through `npm run world-import-helper -- ...` or the installed helper binary.
- `src/world-import/command-router.ts` maps shell commands to deterministic TypeScript operations.
- `src/world-import/helper-tools.ts`, `normalize.ts`, `staging.ts`, `emit.ts`, and `eval.ts` implement deterministic normalization, persistence, emission, lint, coverage, review bundles, and evaluation.
- `src/world-import/model-runner.ts` currently owns extract/merge sessions, merge-readiness checkpoints, bounded recovery, post-merge review, repair verification, final eval, and the import-run audit lifecycle.
- Intermediate/final reviewer sessions in `src/world-import/eval.ts` use generated prompts and no tools; they do not invoke `skills/world-review/SKILL.md`.

### Corrections to the shorthand description

- Helpers are currently **commands used through bash**, not attached typed tools.
- The runner loads the main world-import skill; review sessions are generated model prompts rather than a skill chain.
- Normalization occurs before extraction and should remain deterministic.
- The staged extract pass is currently one embedded session handling all source units, not a fleet of per-unit subagents.

## Product and Research Motivation

The project is not optimizing only for deterministic throughput. It is also an experiment in model quality and workflow effectiveness.

Desired comparisons include:

- flagship coordinator with inexpensive extraction workers;
- inexpensive coordinator with strong extraction or merge workers;
- strong reviewer supervising cheaper producers;
- homogeneous versus heterogeneous model fleets;
- targeted escalation after artifact inspection versus fixed model allocation;
- one-pass versus repeated review;
- parent inline review versus delegated reviewer lenses;
- serial versus parallel extraction;
- facility-native chain/DAG execution versus incremental parent launches.

A hard-coded pipeline would hide or eliminate several of these experimental variables. A completely unconstrained workflow would make outputs difficult to validate, resume, and compare. The chosen design keeps **semantic and orchestration judgment model-owned above a deterministic contract kernel**.

## Target Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ Parent Pi agent or other capable harness                      │
│                                                               │
│  reads world-import coordinator skill                         │
│  inspects durable artifacts                                   │
│  chooses models, workers, fanout, chains, reviews, repairs     │
└──────────────────────────────┬────────────────────────────────┘
                               │ typed tool calls + subagents
┌──────────────────────────────▼────────────────────────────────┐
│ World-import typed tools                                      │
│                                                               │
│  normalization/source reads/extraction submission              │
│  merge authoring/review submission/emission/lint/finalization  │
│  local preconditions, path/run scoping, atomic persistence     │
└──────────────────────────────┬────────────────────────────────┘
                               │ shared TypeScript functions
┌──────────────────────────────▼────────────────────────────────┐
│ Existing deterministic world-import core                      │
│                                                               │
│  normalize · staging · emit · lint · coverage · audit · eval   │
└──────────────────────────────┬────────────────────────────────┘
                               │ durable handoff
┌──────────────────────────────▼────────────────────────────────┐
│ sources/ · stages/extraction/ · stages/merge/ · checkpoints/   │
│ world/ · stages/review.json · stages/import-run.json           │
└───────────────────────────────────────────────────────────────┘
```

### Host surfaces

1. **Interactive Pi/Herdr host**
   - parent agent uses an installed compatible subagent extension;
   - `pi-herdr-subagents` was available in the authoring environment, not guaranteed by this repository;
   - independent worker panes remain visible and interruptible.

2. **Ordinary Pi host without Herdr**
   - `pi-subagents` is the leading candidate;
   - parent may run workers foreground or async and use `subagent_wait` when a skill must complete in one turn.

3. **Standalone memchat CLI host**
   - creates a hermetic coordinator Pi session;
   - loads the same coordinator skill and typed tools;
   - supplies a compatible worker facility;
   - remains alive until world-import reaches a terminal finalized/failed state;
   - streams events and cancellation;
   - contains no semantic stage sequence.

4. **Future harness adapters**
   - any harness may be used if its subagent facility satisfies the capability contract;
   - adapter-specific invocation guidance belongs in a skill reference, not in semantic world-import instructions.

## Model-Owned Workflow, Graphs, and Chains

### What is intentionally not being built

Do not make the primary interface:

```text
world_import_run_dag({ input, output, modelPolicy })
```

where TypeScript internally decides every extraction, merge, review, and repair step. That would recreate the current runner behind a different tool name and reduce the main model to a launcher.

### What is allowed and encouraged

The main agent may choose any of these:

- launch one extraction worker and inspect it;
- launch multiple independent workers;
- use a facility-native parallel task call;
- submit a facility-native chain for a known bounded segment;
- use dynamic fanout when one stage produces a structured unit/task list;
- append steps to a running chain if supported;
- author an entire DAG when the source and plan are sufficiently understood;
- avoid a chain and proceed incrementally when artifact quality is uncertain;
- inline review or repair in the parent session;
- repeat or supersede earlier worker output.

The skill should teach decision rules, not forbid capable orchestration primitives.

### Guardrail for facility-native chains/DAGs

A chain or graph is acceptable when:

- the **main model authored or deliberately selected it**;
- dependencies are grounded in world-import artifacts;
- semantic handoffs remain persisted under the output root;
- worker permissions remain role-specific;
- the parent can inspect results and add/repeat/revise steps;
- final success still requires world-import deterministic finalization.

Facility-native `{previous}` output may summarize a prior result, but merge/review workers must be directed to read the authoritative extraction/merge/checkpoint artifacts rather than trusting only transferred prose.

### Example adaptive run

```text
1. Parent calls deterministic normalize.
2. Parent inspects manifest and identifies 24 body units.
3. Parent launches four inexpensive extraction workers, six units each.
4. Parent receives completions and checks extraction/accounting status.
5. Unit 7 is sparse and unit 11 contains ambiguous identity evidence.
6. Parent reads those stage artifacts itself.
7. Parent launches a strong focused extractor for unit 7 and a continuity reviewer for unit 11.
8. Parent launches one global merger after sufficient extraction coverage.
9. Parent emits/lints and inspects merge artifacts.
10. Parent reviews synopsis inline, then launches provenance and omission reviewers in parallel.
11. Parent chooses one repair worker for accepted actions.
12. Parent re-runs deterministic readiness and finalization.
```

The same parent could instead express steps 3–7 as a dynamic facility-native chain if the available extension supports it and the model judges that appropriate.

## Subagent Capability Contract

### Required capabilities

A compatible worker facility must provide enough control for the parent to:

1. launch an isolated child agent;
2. provide a concrete task and role instructions/profile;
3. choose or recommend a model;
4. choose or recommend a thinking level, directly or through model/profile syntax;
5. select a working directory;
6. restrict the child to an explicit tool set or a named role with an explicit allowlist;
7. receive an unambiguous completion or failure result;
8. launch multiple independent workers;
9. identify each launch well enough to associate it with a world-import task/artifact;
10. prevent ordinary workers from recursively becoming orchestrators.

### Strongly preferred capabilities

- foreground and background execution;
- bounded concurrency;
- hard timeout;
- turn/tool budgets;
- interrupt and hard stop;
- session resume;
- machine-readable lifecycle state;
- resolved model/thinking information;
- token, cache, cost, duration, and model-attempt telemetry;
- structured result submission;
- child-to-parent clarification/progress messages;
- package-distributed role profiles.

### Capability discovery behavior

At workflow start, the parent should inspect its available tools and select an adapter profile.

- If a known compatible facility/version is present, follow its trusted profile and run any profile-required startup probe.
- If an unknown third facility is present, schema/documentation inspection may identify a candidate, but security-critical claims must be demonstrated by an executable conformance probe before use.
- A conformance probe should prove fresh isolation, exact role-tool visibility, missing-tool failure, no recursive spawning, launch/result correlation, and completion/failure behavior with harmless fixture tools.
- If a facility cannot prove the required controls, do not use it for a privileged import worker even if its description claims support.
- If no compatible facility exists, stop before semantic import work and tell the user what is missing.
- Do not create, install, or code a subagent extension during the import unless the user separately requests a setup task.

The skill must not assume the tool is always named `subagent`; it should describe the contract, include known profiles, and distinguish trusted/probed enforcement from model inference.

## Known Adapter Profile: `pi-herdr-subagents` 0.1.5

Research commit: [`d654eae75ff347ccb618113f2af85f3040d9ade9`](https://github.com/0xRichardH/pi-herdr-subagents/tree/d654eae75ff347ccb618113f2af85f3040d9ade9).

### Strengths

- dedicated visible Herdr pane/session per worker;
- fresh standalone, lineage-only, or forked context;
- per-spawn `systemPrompt`, model, thinking, skills, tools, and cwd;
- Pi `--tools` allowlist applies to built-in, extension, and custom tools;
- multiple calls run concurrently;
- async completion/failure is automatically steered to the parent;
- turn interruption and session resume;
- user can inspect or take over a worker pane.

The direct spawn schema exposes the role/model/thinking/tools/cwd controls needed by the thin workflow ([source](https://github.com/0xRichardH/pi-herdr-subagents/blob/d654eae75ff347ccb618113f2af85f3040d9ade9/pi-extension/subagents/index.ts#L120-L168)). Its allowlist explicitly applies to custom tools ([source](https://github.com/0xRichardH/pi-herdr-subagents/blob/d654eae75ff347ccb618113f2af85f3040d9ade9/pi-extension/subagents/index.ts#L789-L813)).

### Limitations

- Herdr is mandatory;
- async only; no dedicated wait tool for a one-turn headless coordinator;
- parent session must be persisted;
- interruption cancels the active turn but does not forcibly terminate the session;
- no per-spawn hard timeout;
- completion does not aggregate token/cost telemetry;
- launch has an ID, but completion primarily correlates through name/task/session path;
- third-party world-import role profiles are not package resources in the same way as `pi-subagents` package agents.

### Expected world-import use

The parent can specify each worker's exact allowlist per spawn, e.g. extractor tools only, with no bash or generic write. Use `standalone` or `lineage-only`, not a full fork, unless parent conversation history is intentionally needed.

## Known Adapter Profile: `pi-subagents` 0.34.0

Research commit: [`8d2c05e51ce58923dea504b4530dc2643cb25c54`](https://github.com/nicobailon/pi-subagents/tree/8d2c05e51ce58923dea504b4530dc2643cb25c54).

### Strengths

- Herdr-free child Pi processes;
- fresh or forked context;
- foreground and async modes;
- native single, parallel, chain, static parallel-group, and dynamic-fanout shapes;
- bounded concurrency;
- hard runtime timeout plus turn and tool budgets;
- interrupt, stop, status, resume, and supervisor messaging;
- stable run IDs and machine-readable lifecycle artifacts;
- token/cost/model-attempt/duration telemetry;
- structured output support for chain steps;
- `subagent_wait` for non-interactive/single-turn completion;
- strict child tool allowlists with missing-provider validation;
- `subagentOnlyExtensions` for child-only typed tools;
- package-distributed agent profiles through `pi-subagents.agents` or `pi.subagents.agents`;
- versioned in-process event-bus RPC for extension integration.

The execution schema exposes context, async mode, concurrency, timeout, turn/tool budgets, cwd, and model control ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/extension/schemas.ts#L256-L294)). Child results and aggregate details include run IDs, usage, model attempts, timeout state, sessions, artifacts, total usage, and total cost ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/shared/types.ts#L483-L563)).

### Tool/profile implications

- Normal execution calls do not provide the same arbitrary per-spawn tool-list field as Herdr.
- Tool access is defined by the selected agent profile/settings.
- This is compatible with world-import if memchat packages named profiles such as extractor, merger, reviewer, and repairer.
- A profile's `tools` field is a strict allowlist; extension providers must be loaded normally or through `subagentOnlyExtensions`.
- Missing requested tools fail before the first model turn with actionable guidance ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/runs/shared/tool-availability.ts#L14-L55)).
- Installed packages can expose their own agent directories ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/README.md#L624-L636)).

### CLI implications

- `subagent_wait` is explicitly designed to keep a run-to-completion skill or non-interactive `pi -p` invocation alive while async workers finish ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/README.md#L594-L598)).
- Fresh-context workers do not require a persisted parent; forked workers do.
- The extension launches child Pi CLI processes rather than in-process SDK sessions ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/runs/shared/pi-spawn.ts#L134-L152)).
- The standalone host must therefore ensure children see the same hermetic auth, models, package resources, and world-import typed tools.
- Current package peers are wildcard, but its direct/dev Pi baseline is 0.74 while memchat's current lockfile resolves Pi 0.80.6; compatibility must be tested, not assumed ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/package.json#L55-L80)).

### Extension RPC

`pi-subagents` offers process-local v1 RPC methods `ping`, `status`, `spawn`, `interrupt`, and `stop`; RPC spawning is async-only and uses the same executor/validation ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/extension/rpc.ts#L14-L40), [source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/extension/rpc.ts#L170-L213)).

The coordinator model should normally call the subagent tool itself. A world-import extension may use RPC for capability probing, audit/status ingestion, or cancellation without taking semantic orchestration away from the model.

## Third-Party/Unknown Adapter Profile

The skill should not reject a capable third extension merely because it is not one of the two known profiles.

A generic selection procedure:

1. Identify candidate worker/delegation tools from the active tool catalog.
2. Compare their schema/documentation to the required capability contract only as preliminary discovery.
3. Run an adapter conformance fixture using harmless custom tools and a disposable run root.
4. Prove whether tool restrictions are per spawn, per role, and actually enforced in the child.
5. Prove completion mode, worker/result correlation, failure reporting, cancellation, and recursion prevention.
6. Determine model/thinking and cwd controls and verify the resolved runtime is observable when required.
7. Promote the adapter/version to a trusted profile only after the probe passes; record the probe/profile identity in the import audit.
8. Fail before work if required controls are absent or cannot be verified.

The parent may use any chain, DAG, or parallel feature supplied by a trusted/probed adapter when it remains the author of the workflow and artifact/finalization rules are preserved.

## Typed World-Import Tool Design

### Design principles

1. **Call deterministic TypeScript functions directly.** Avoid spawning the existing helper CLI from tool implementations.
2. **Keep the command router.** It remains useful for humans, tests, emergency repair, and compatibility.
3. **Use role-separable tool names.** A single omnibus action tool would make worker allowlists too broad.
4. **Bind tools to an active run/output root.** Do not let workers freely target arbitrary filesystem paths.
5. **Validate assignments.** An extraction worker should submit only units assigned to its world-import task/run capability.
6. **Return concise structured results.** Large source or diagnostics should remain bounded and browseable.
7. **Preserve model ownership.** Tools validate structure and persistence, not identity, canon, synopsis quality, or disposition wisdom.
8. **Make operations idempotent/resumable where practical.** Existing atomic stage writes and artifact upserts are a strong base.

### Cross-process assignment grants

This is a prerequisite for worker-facing tools, not a later detail.

`world_import_begin` should create a run identity. Before dispatch, the coordinator issues a high-entropy bearer grant and persists only its hash plus an assignment record under a deterministic orchestration path such as:

```text
stages/orchestration/assignments/<task-id>.json
```

The assignment record should bind:

- run ID and canonical output root identity;
- task ID and role;
- allowed units/artifact IDs/checkpoint action IDs;
- allowed world-import tool capability classes;
- issued/expiry timestamps and revocation/completion status;
- coordinator/parent task identity;
- token hash, never the raw token;
- optional adapter worker/session/run identity after launch.

The raw grant is delivered in the worker task/bootstrap context and supplied to typed tool calls. Every child tool process independently loads the assignment record, hashes/validates the grant, checks role/resource scope and expiry/revocation, and rejects forged or out-of-scope work. This works across `pi-subagents` subprocesses and Herdr sessions without shared extension memory. The grant is an application authorization boundary, not an OS sandbox; general shell/read tools must still be absent.

Coordinator-only tools use a separate coordinator authority. Grants must be redacted from transcripts/audits where practical, revocable after interruption, and rotated for retries or superseding workers.

### Proposed conceptual tool families

Names are provisional; contracts matter more than exact spelling.

#### Coordinator/run tools

- `world_import_begin`
- `world_import_normalize`
- `world_import_status`
- `world_import_inspect_manifest`
- `world_import_validate`
- `world_import_finalize`

Responsibilities:

- establish run identity and scoped output root;
- normalize input deterministically;
- report current artifact/checkpoint/accounting state;
- refuse final success while hard diagnostics remain;
- update the authoritative import audit.

#### Source-reading tools

- `world_source_list_units`
- `world_source_read_unit`
- `world_source_read_slice`
- `world_source_find_text`
- `world_source_suggest_refs`
- `world_source_resolve_ref`
- `world_source_quote_ref`

These wrap current deterministic source/provenance helpers and never mutate semantic world state.

#### Extraction tools

- `world_extraction_status`
- `world_extraction_read`
- `world_extraction_validate`
- `world_extraction_submit`

`submit` should verify:

- normalization exists;
- assigned unit exists;
- source/unit IDs match the manifest;
- anchors are local and valid;
- candidate envelope shape is valid;
- the caller/run assignment permits the unit;
- write is atomic.

It must not judge candidate semantics.

#### Merge tools

- `world_merge_read_candidates`
- `world_merge_read_existing`
- `world_merge_validate_artifact`
- `world_merge_write_artifact`
- `world_merge_write_artifacts`
- `world_merge_patch`
- `world_merge_accounting`

These wrap current artifact validation/upsert/patch behavior. Merge writing must use a cross-process single-writer lease for every fresh or maintained import because identity and cross-linking are global.

A merger/repairer must acquire a lease bound to its assignment grant. Lease acquisition should use an atomic filesystem primitive such as exclusive directory/file creation, persist owner/task/expiry/heartbeat metadata, and support explicit release plus conservative stale-owner recovery. Every merge mutation also supplies the expected merge revision/hash; stale compare-and-swap writes fail rather than overwriting newer state. Atomic JSON replacement remains necessary for file integrity but is not the concurrency control mechanism.

#### Deterministic check tools

- `world_check_coverage`
- `world_check_emit`
- `world_check_lint`
- `world_check_provenance`
- `world_check_readiness`
- `world_check_repair_summary`
- `world_check_final_eval`

These report facts/heuristics and may write deterministic checkpoint artifacts, but do not perform semantic repair.

#### Semantic review tools

- `world_review_read_bundle`
- `world_review_read_artifact`
- `world_review_read_extraction`
- `world_review_read_diagnostics`
- `world_review_submit`

`submit` is an append-only/schema-validated review/checkpoint output. A reviewer is therefore **world-state read-only**, even though it may persist its own review packet.

### Invalid versus incomplete state

#### Hard error examples

- extraction before normalization;
- unknown/unassigned unit;
- cross-unit or nonexistent anchor;
- write outside active run/output root;
- malformed candidate/artifact/review packet;
- repair references nonexistent checkpoint/action;
- reviewer invokes world mutation tool;
- duplicate/unsafe concurrent global merge writer;
- finalization with error-level readiness/lint/accounting failures.

#### Diagnostic/warning examples

- merge draft exists before all extraction is complete;
- only some body units are represented;
- optional plot surface is missing;
- provenance is sparse but structurally valid;
- candidate disposition reason appears weak;
- draft emission is incomplete;
- additional semantic review may be valuable.

This distinction preserves model experimentation. Tools reject impossible/unsafe state, not every noncanonical ordering.

## Worker Roles and Tool Boundaries

### Normalizer

- deterministic tool, not normally a subagent;
- parent calls it before source-dependent work.

### Extractor

Allow:

- assigned unit/source reads;
- source search and reference resolution;
- extraction status/read for assigned scope;
- extraction validation/submission.

Deny:

- bash;
- generic filesystem writes;
- merge mutation;
- review submission;
- subagent spawning.

### Merger

Allow:

- normalized/extraction/existing-world reads;
- targeted source reference helpers;
- artifact validation/upsert/patch;
- coverage, emit, lint, readiness inspection as appropriate.

Deny:

- arbitrary shell/filesystem mutation;
- subagent spawning;
- reviewer checkpoint impersonation.

Use one global merge writer at a time unless future contracts safely partition it.

### Semantic reviewer

Allow:

- source/extraction/merge/emitted-world reads;
- deterministic diagnostics;
- schema-validated `world_review_submit`.

Deny:

- bash;
- merge/artifact mutation;
- repair tools;
- subagent spawning.

### Repairer

Allow only the reads and writes required by specified checkpoint actions. A repair invocation must cite checkpoint ID/action IDs and remain bounded.

### Parent coordinator

The parent requires broad read/status/finalization access and subagent tools. Whether it also receives direct semantic mutation tools should remain configurable:

- allowing them enables flagship inline repair/merge work;
- withholding them improves role separation and experimental attribution.

No final decision is required before the first typed-tool slice; both policies can be supported through active-tool selection.

## Review Architecture

### Deterministic review remains code

Keep or strengthen:

- stage/schema validation;
- source and anchor resolution;
- candidate accounting;
- source coverage;
- link/frontmatter/index integrity;
- readiness;
- provenance-density risk signals;
- structural repair verification;
- final output summary.

### Semantic review is model work

The parent chooses among:

- inspect and review inline;
- launch one general reviewer;
- launch multiple focused reviewers in parallel;
- use a facility-native reviewer chain;
- repeat review after repair;
- skip optional review only when policy/user configuration permits.

Useful reviewer lenses include:

- identity/continuity and maintained-world conflicts;
- plot/synopsis/timeline/scene reconstruction;
- omission/candidate disposition quality;
- provenance support quality;
- object/prop coverage;
- style/tone/voice usefulness;
- retrieval usefulness and standalone artifact detail.

Reviewer findings are recommendations. The parent decides which repairs are worth doing. Deterministic finalization remains authoritative for structural success, not semantic excellence.

## Artifact and Handoff Contract

### Existing paths to preserve

```text
<output>/
  sources/manifest.json
  sources/normalized/<unit>.json
  stages/extraction/<unit>.json
  stages/merge/merged-candidates.json
  stages/checkpoints/*.json
  stages/review.json
  stages/import-run.json
  world/**/*.md
```

### Orchestration artifacts

Durable cross-process assignment records are required, although final naming may change. Other projections remain optional:

```text
stages/orchestration/
  assignments/<task-id>.json   # required worker authorization state
  capabilities.json            # optional adapter/probe projection
  decisions.jsonl              # optional parent decision projection
  workers/<task-id>.json       # optional adapter lifecycle projection
```

The exact split between orchestration files and `stages/import-run.json` should be finalized with the audit schema. Raw bearer grants must never be persisted; only hashes and redacted metadata are durable.

### Handoff rule

- Source truth lives in normalized units and manifest.
- Extractor truth lives in extraction stage packets.
- Merge truth lives in the merge stage.
- Review requests live in checkpoint/review packets.
- Emitted Markdown is a projection of merge state.
- Deterministic diagnostics and finalization determine structural completion.
- Subagent final prose is a receipt/summary, not canonical semantic state.

## Audit and Model-Evaluation Contract

Extend the existing invocation audit intent to record parent and worker activity without exposing credentials or local paths.

### Run-level fields

- coordinator host/mode;
- selected subagent adapter and adapter version/profile;
- parent requested/resolved model and thinking;
- source identity and output artifact summary;
- terminal status and failure reason;
- model-routing policy/config identity where applicable.

### Worker invocation fields

- world-import task/node ID;
- parent task/dependency IDs;
- role;
- assigned units/artifacts/checkpoint actions;
- requested and resolved model/thinking;
- allowed tools/profile identity;
- prompt/profile hash;
- start/end/duration/status;
- token/cache/cost totals when available;
- model fallback attempts when available;
- child session/run identity;
- input artifact hashes/versions;
- output artifact hashes/versions;
- superseded/retried relationship;
- concise parent-authored dispatch rationale when practical.

### Experimental comparisons enabled

- quality/cost by worker role/model;
- coordinator-versus-worker strength;
- targeted escalation effectiveness;
- reviewer lift over deterministic-only output;
- repeated review marginal value;
- chain/DAG versus incremental orchestration;
- parallel extraction throughput and consistency;
- per-model provenance/candidate-accounting reliability.

Do not store hidden thinking text or duplicate large prompts/responses. Preserve compact prompt descriptors and hashes as in the existing invocation-audit plan.

## Standalone CLI Decision

### Target responsibilities

The CLI should eventually do only:

1. parse input/output/model/auth/runtime options;
2. create/configure a hermetic coordinator Pi session;
3. load the world-import coordinator skill and typed tools;
4. expose/configure a compatible subagent facility;
5. stream coordinator/worker events and cancellation;
6. remain alive until finalization/failure;
7. print the final summary and exit status.

It should not contain extraction/merge/review sequencing.

### Non-semantic host completion supervisor

The host cannot rely solely on the coordinator remembering to call `subagent_wait` and finalize. It owns a lifecycle loop, not a semantic stage loop:

1. Start the coordinator turn and subscribe to world-import run-state plus adapter worker events.
2. Treat `finalized`, `failed`, and `cancelled` from the authoritative run ledger as terminal.
3. If the coordinator turn ends while workers remain active, keep the process alive and wait through the adapter's event/wait API.
4. When worker state changes, deliver a concise follow-up to the coordinator so the model can inspect artifacts and choose the next semantic action.
5. If no workers remain but the run is still nonterminal, issue a bounded continuation prompt asking the coordinator to continue, explicitly fail, or finalize; do not choose a stage for it.
6. Enforce idle-continuation, wall-clock, call, and cost budgets. Exhaustion records an incomplete/failed terminal state rather than pretending success.
7. On cancellation, abort the parent turn, interrupt/stop active workers through the adapter, revoke assignment grants/leases, persist cancellation, and only then exit.
8. Dispose the Pi session only after authoritative terminal state and worker cleanup.

This supervisor is deterministic lifecycle plumbing. It never decides to extract, merge, review, or repair.

### Candidate worker backend order

1. **Evaluate `pi-subagents` first.** It is Herdr-free and already supplies fresh-context workers, async/foreground execution, `subagent_wait`, timeouts, budgets, stable lifecycle artifacts, and telemetry.
2. **Use `pi-herdr-subagents` for interactive visible-pane runs when appropriate.** It is not sufficient by itself for ordinary non-Herdr CLI execution.
3. **Defer a custom SDK wrapper.** Build one only if subprocess hermeticity, dependency/version coupling, or resource discovery make `pi-subagents` unsuitable.

### `pi-subagents` compatibility spike

Before adopting it for the CLI, verify:

1. Decide and prove an explicit distribution/loading policy: pin an exact `pi-subagents` version as an optional/runtime backend dependency (or reject that approach), resolve its extension entry deterministically, and load it through the coordinator `DefaultResourceLoader` rather than relying on account-level installation. Confirm the selected policy works with the current lockfile's Pi 0.80.6 resolution.
2. Prove how the same pinned extension/package resources are visible to spawned child Pi processes; nested `pi.subagents.agents` metadata has no effect until `pi-subagents` itself is active.
3. Run a fresh-context child without a persisted parent session.
4. Make the memchat package expose world-import agent profiles through `pi.subagents.agents` or equivalent supported metadata.
5. Load world-import typed tools in the child through normal package discovery or `subagentOnlyExtensions`.
6. Confirm strict role allowlists omit bash/generic write/subagent tools.
7. Confirm missing typed tools fail before the model turn.
8. Confirm child processes resolve credentials and custom models from `.memchat/pi` or explicitly supplied environment/runtime paths.
9. Launch parallel extractor fixtures and use `subagent_wait({ all: true })` in the same coordinator prompt.
10. Confirm timeout, interrupt, hard stop, cleanup, and failure reporting.
11. Confirm stable run IDs and lifecycle artifacts are scoped to the originating coordinator session.
12. Confirm token/cost/model-attempt records can be projected into `stages/import-run.json`.
13. Confirm assignment grants can be delivered to subprocess workers and validated by child-only typed tools without shared memory.
14. Confirm the non-semantic CLI completion supervisor survives early coordinator return and reaches authoritative terminal state.
15. Confirm package version/resource loading remains compatible with the project Pi version.

### Why an SDK wrapper remains a fallback

An in-process SDK worker would naturally share:

- `AuthStorage`;
- `ModelRegistry`;
- exact resource loader configuration;
- typed tool instances;
- package root and cwd;
- event subscriptions.

But it would require us to implement worker IDs, concurrency, cancellation, timeout, usage aggregation, result persistence, cleanup, and resume. Do not take that cost until the existing Herdr-free extension has been tested.

## Proposed Package Shape

Exact paths are provisional.

```text
skills/
  world-import/                  # coordinator + semantic workflow
  world-import-extractor/        # optional narrow worker skill/profile guidance
  world-import-merger/
  world-import-reviewer/
  world-import-repairer/

extensions/
  world-import-tools.ts          # typed deterministic tools

agents/world-import/
  extractor.md
  merger.md
  reviewer.md
  repairer.md
```

Possible package metadata when `pi-subagents` is used:

```json
{
  "pi": {
    "extensions": ["./extensions/world-import-tools.ts"],
    "skills": ["./skills"],
    "subagents": {
      "agents": ["./agents/world-import"]
    }
  }
}
```

Do not finalize this manifest until the compatibility spike confirms how Pi core and `pi-subagents` compose package metadata.

## Skill Structure

### Coordinator skill responsibilities

- explain semantic world-import quality requirements;
- define durable artifact contracts and required final checks;
- describe typed helper tools;
- require capability discovery;
- document known adapter profiles;
- teach role/tool boundaries;
- teach artifact-driven orchestration decisions;
- permit single, parallel, chain, dynamic fanout, and parent-inline work;
- teach model tiering/escalation;
- require audit/finalization;
- fail clearly when prerequisites are absent.

### Keep adapter details separate

Suggested reference documents:

```text
skills/world-import/references/
  workflow.md
  contracts.md
  helper-tools.md
  orchestration.md
  subagent-capabilities.md
  adapters/
    pi-herdr-subagents.md
    pi-subagents.md
```

The main `SKILL.md` should stay readable. Load adapter details only after detecting a matching facility.

### Example high-level coordinator instructions

```text
- Inspect available worker/delegation tools and select a compatible adapter.
- Normalize deterministically, then inspect the complete manifest.
- Decide extraction assignments, worker models, context mode, and concurrency.
- Persist assignments before or with dispatch when supported.
- After worker completion, inspect extraction artifacts and deterministic status.
- Repeat, escalate, review, or proceed based on artifact quality.
- Choose merge/review/repair topology; facility-native chains and dynamic graphs are allowed.
- Keep world-import files authoritative; do not rely only on transferred worker prose.
- Call deterministic finalization before reporting success.
```

## Implementation Units

Implementation is not started. Sequence should preserve testability and allow early validation.

### U0. Prove subagent compatibility and foundational control contracts

- Run the `pi-subagents` CLI compatibility/loading spike above.
- Confirm the environment-specific Herdr adapter can launch a no-bash worker with a placeholder custom tool.
- Design and prove cross-process assignment-grant issuance/validation/revocation with a disposable typed tool.
- Design and prove the non-semantic CLI terminal-state supervisor against early coordinator return.
- Design and prove a cross-process merge lease plus revision/CAS primitive.
- Document executable conformance probes and trusted adapter profiles.
- Decide whether `pi-subagents` is accepted as the initial CLI backend and how it is version-pinned/loaded.

### U1. Extract typed tool definitions over existing deterministic functions

- Define run-scoped tool contracts, assignment grants, and result types.
- Begin with normalize/status/source reads/extraction submission.
- Keep command-router behavior unchanged.
- Add role-allowlist tests and missing-precondition tests.
- Do not migrate orchestration yet.

### U2. Add merge/check/review/finalization tools

- Wrap artifact validation/upsert/patch, emit, lint, coverage, readiness, provenance audit, review submission, and final eval.
- Require a valid single-writer lease and expected revision/hash for every merge mutation.
- Separate hard errors from diagnostics.
- Add output-root/run scoping, forged-grant, lease-contention, stale-writer, and atomic write tests.

### U3. Rewrite the world-import skill as a coordinator

- Remove bash/helper-command dependency from the primary path.
- Add capability discovery and known adapter references.
- Add model-led single/parallel/chain/DAG guidance.
- Add role restrictions, escalation rules, and finalization requirements.
- Preserve semantic guidance from the current skill.

### U4. Package worker role profiles

- Define extractor, merger, reviewer, and repairer prompts/tool allowlists.
- Expose package agents for `pi-subagents` if accepted.
- Define equivalent Herdr invocation guidance.
- Ensure ordinary workers cannot spawn subagents.

### U5. Add worker-aware orchestration audit

- Extend or version `stages/import-run.json`.
- Record parent and worker model/tool/task/artifact metadata.
- Ingest telemetry from adapters when available.
- Preserve compact/redacted audit policy.

### U6. Convert the standalone runner into a thin host

- Load the coordinator skill, typed tools, selected worker facility, and non-semantic completion supervisor.
- Keep the existing staged runner available as a comparison/rollback path.
- Keep streaming, debug visibility, cancellation, auth/model setup, and terminal result reporting.
- Preserve existing output paths and deterministic gates.

### U6a. Gate cutover on artifact/checkpoint/audit parity

- Run old staged and new model-led hosts against deterministic stubbed worker fixtures and small model-backed fixtures.
- Compare normalized layout, extraction/merge envelope validity, readiness/checkpoint behavior, emitted indexes/source pages, lint/accounting, audit completeness/redaction, failure/cancellation state, and CLI exit semantics.
- Normalize nondeterministic timestamps/run IDs/model prose rather than requiring byte-identical semantic output.
- Define CLI flag/default migration, legacy rollback command, and deprecation/removal criteria.
- Remove hard-coded semantic sequencing only after parity gates pass and the legacy path has a documented rollback window.

### U7. Add model-routing and orchestration eval fixtures

- Cheap extraction fleet plus strong coordinator/merger/reviewer.
- Strong workers plus weaker coordinator.
- Targeted re-extraction after sparse output.
- Parent inline review versus delegated review.
- Repeated review with bounded repair.
- Facility-native chain versus incremental dispatch.
- No-compatible-subagent failure.

### U8. Update docs and smoke tests

- `docs/world-import.md`
- `README.md`
- `docs/smoke-tests.md`
- skill references and adapter setup notes.

## Verification Contract

### Deterministic tests

- Typed tool schemas reject malformed inputs.
- Tools cannot escape bound run/output roots.
- Extraction cannot submit before normalization or for unassigned units.
- Forged, expired, revoked, cross-role, and out-of-scope assignment grants are rejected across child processes.
- Provenance helpers reject cross-unit anchors.
- Reviewer role cannot access mutation tools.
- Extractor role cannot access bash, merge, review, or subagent tools.
- Concurrent merger/repair workers cannot both hold the writer lease; stale revision/CAS writes fail without lost updates.
- Merge writes remain atomic and resumable.
- Draft/incomplete state returns diagnostics rather than being silently finalized.
- Finalization fails on error-level readiness/lint/accounting blockers.
- Existing artifact layouts and emission/lint behavior remain compatible.
- Audit records requested/resolved models and worker identities without credential/path leakage.

### Adapter tests

- Herdr profile: fresh/lineage worker, exact tool allowlist, parallel completion, interrupt, resume.
- `pi-subagents` profile: exact extension loading, package agent discovery, strict typed tools, fresh context, async wait, timeout/stop, telemetry, cleanup.
- Unknown profile: executable conformance probe before privileged work.
- Unknown/incompatible or unprovable profile: explicit failure before semantic work.
- CLI lifecycle: early coordinator return does not exit while workers/run state remain nonterminal; cancellation reaches workers and persists terminal state.

### Model-backed scenarios

- Parent identifies a weak extraction and escalates it.
- Parent chooses a native parallel or chain facility when useful.
- Parent can reject a reviewer suggestion and explain why.
- Parent can repeat semantic review after repair.
- Parent can finalize only after deterministic checks pass.
- Different model-tier configurations produce fully auditable runs.

### Smoke-test expectations

Continue to apply `docs/smoke-tests.md` after implementation changes. Long model-backed runs must use the active harness's supervised execution mechanism.

## Acceptance Criteria

1. A capable Pi parent can invoke the coordinator skill and complete an import without using bash/helper CLI commands.
2. The parent, not TypeScript, chooses worker topology and semantic sequencing.
3. The parent may use individual calls, native parallelism, chains, or dynamic DAG features when supported.
4. Extraction and reviewer workers can run with only typed role tools.
5. Absence of a compatible, trusted/probed subagent facility produces a clear setup failure before semantic work.
6. Every worker-facing tool rejects forged, expired, revoked, cross-role, and out-of-assignment grants.
7. Invalid operations fail locally with actionable errors.
8. Incomplete drafts remain inspectable, but finalization refuses hard blockers.
9. Concurrent merge writers cannot cause lost updates; lease and revision/CAS enforcement rejects stale writers.
10. Existing world-import output structure and quality gates remain available.
11. Parent and worker model assignments, actual runtimes, costs/usage when available, and artifact effects are auditable.
12. The standalone CLI contains materially less orchestration logic than the current `model-runner.ts` path.
13. Early coordinator return cannot terminate a nonterminal CLI run; the host reaches authoritative terminal state or bounded failure/cancellation.
14. Old and new hosts pass the defined artifact/checkpoint/audit/exit-semantics parity gate before cutover.
15. CLI execution works without Herdr if the explicitly loaded `pi-subagents` compatibility spike succeeds; otherwise a documented SDK-adapter follow-up is created.
16. Semantic quality remains model-owned; helper tools do not decide canon, identity, merge meaning, synopsis quality, or review correctness.

## Non-Goals

- Guarantee identical semantic output across models or orchestration facilities.
- Encode one fixed worker count or model tier policy.
- Make deterministic helpers decide entity identity or literary importance.
- Require native chain or DAG support from every subagent facility.
- Treat clean lint as proof of semantic quality.
- Permit uncontrolled parallel merge writers.
- Auto-install or live-code a subagent extension during import.
- Preserve exact current runner session order or response text.
- Build a custom SDK worker before testing `pi-subagents`.

## Risks and Mitigations

### Risk: dynamic parent omits necessary work

Mitigation: authoritative status/readiness/finalization tools detect missing extraction, coverage, accounting, emission, and lint requirements. Finalization refuses error-level gaps.

### Risk: tools accidentally encode a rigid pipeline

Mitigation: enforce only impossible/unsafe preconditions; report incomplete state as diagnostics. Permit review before merge, draft emission, re-extraction, supersession, and repeated review.

### Risk: too many typed tools overwhelm the model

Mitigation: role-specific active tool sets, concise prompt snippets, grouped naming, progressive skill references, and bounded outputs. Avoid one giant omnibus tool when it weakens privilege separation.

### Risk: parent context grows across many worker results

Mitigation: durable artifacts, concise worker receipts, file-only result modes where supported, status summaries, and model-owned compaction only when evidence shows it is needed.

### Risk: parallel workers conflict

Mitigation: assign disjoint extraction units, use atomic per-unit writes, require assignment grants, and enforce a cross-process single-writer lease plus merge revision/CAS checks.

### Risk: adapter behavior differs or overclaims enforcement

Mitigation: trusted versioned profiles, executable conformance probes for unknown adapters, artifact-authoritative handoffs, and audit the selected adapter/version/probe identity.

### Risk: coordinator returns before the CLI run is complete

Mitigation: deterministic host lifecycle supervisor waits on worker/run events, issues bounded continuation prompts without choosing semantic stages, and exits only after authoritative terminal state and cleanup.

### Risk: both known extensions register `subagent`

Mitigation: treat them as selectable alternatives initially. Use package/resource filtering or one enabled adapter per coordinator until coexistence is explicitly tested.

### Risk: `pi-subagents` subprocesses break hermetic CLI configuration

Mitigation: compatibility spike for `PI_CODING_AGENT_DIR`, auth/models, package discovery, typed tool extension paths, and Pi binary selection. Fall back to an SDK adapter only if this remains unreliable.

### Risk: model routing becomes irreproducible

Mitigation: record requested/resolved model, thinking, fallback attempts, role, tool profile, inputs/outputs, usage, and parent dispatch rationale.

### Risk: reviewer is called read-only but can write a report

Mitigation: define read-only as no world-state mutation. Permit only append-only/schema-validated review submission.

### Risk: flagship parent silently performs worker work, obscuring attribution

Mitigation: make parent mutation permissions and audit explicit. Record inline semantic mutations as parent invocations/actions.

## Open Questions

These are implementation decisions, not blockers to the architectural direction.

1. Exact typed tool names and whether closely related reads should be combined.
2. Exact assignment-grant serialization, token-delivery/redaction mechanism, expiry defaults, and coordinator authority representation; the durable cross-process grant requirement itself is decided.
3. Whether parent semantic mutation tools are enabled by default or through an experimental flag/profile.
4. Whether all task/assignment data lives under `stages/orchestration/` or part is projected into an extended import audit.
5. How extraction supersession is represented when a stronger worker replaces an earlier stage packet.
6. Which adapter is the default in interactive Pi when more than one is installed.
7. Whether `pi-subagents` telemetry is ingested directly from its lifecycle JSON or through its extension RPC/status result.
8. Whether audit schema remains version 1 with additive fields or moves to version 2.
9. How model-tier policies are supplied: CLI options, JSON policy file, skill arguments, or parent free choice with budget limits.
10. Whether semantic reviewers submit directly through a typed tool or return structured output for the parent to persist.
11. What hard runtime/cost/concurrency and idle-continuation defaults are appropriate for unattended CLI imports.
12. Exact merge-lease heartbeat, expiry, stale-owner recovery, and repair handoff policy; single-writer lease plus revision/CAS enforcement for every import is decided.
13. Exact `pi-subagents` dependency policy: optional dependency, bundled backend, or explicit install resolved by the CLI.

## Recommended Next Session

Start with **U0 only**. Do not refactor the runner before proving the worker/tool composition.

Suggested sequence:

1. Re-read this plan and `docs/world-import.md`.
2. Inspect current Pi package/version state and whether `pi-subagents` is already installed.
3. Design a minimal placeholder typed tool plus durable cross-process assignment grant; prove forged/out-of-scope calls fail.
4. Prove the environment-specific Herdr worker can receive only that tool and no bash.
5. Decide how an exact `pi-subagents` version is provided and explicitly loaded by the hermetic coordinator and child process.
6. Prove a `pi-subagents` fresh worker can discover a package-provided role and child-only tool extension under that configuration.
7. Prove `subagent_wait` plus the host completion supervisor handles early coordinator return and authoritative finalization.
8. Prove cross-process merge lease/revision primitives before exposing merge writes.
9. Record findings in this plan or a focused follow-up before implementing the full typed helper surface.

## New-Session Resume Checklist

A new planning/implementation session should know:

- We are aligned on a thin model-led coordinator, not a coded semantic DAG runner.
- The parent is explicitly allowed to choose facility-native chains, dynamic DAGs, or incremental calls.
- Typed tools and artifact/finalization contracts provide the deterministic safety boundary.
- Cross-process assignment grants are required before exposing worker-facing typed tools.
- Worker tool allowlists should remove bash and generic writes where possible.
- Every merge mutation requires a cross-process single-writer lease and expected revision/CAS check.
- The CLI needs a non-semantic completion supervisor so early coordinator return cannot abandon workers or incomplete state.
- Review is hybrid: deterministic checks plus parent or constrained semantic reviewers.
- Model tiering and orchestration topology are evaluation variables, so audit them.
- `pi-herdr-subagents` satisfies core interactive worker needs but lacks hard timeout/usage telemetry and requires Herdr/persisted parent state.
- `pi-subagents` appears to satisfy the full worker contract and is the preferred Herdr-free CLI candidate, but exact dependency/loading policy, subprocess hermeticity, and Pi-version compatibility must be proven.
- We agreed not to ask the model to build a worker extension live.
- We agreed to hold off on our own SDK worker until the `pi-subagents` spike is complete.
- No implementation changes were made during this design discussion beyond adding this plan document.

## Sources and Evidence

### Repository context

- `docs/world-import.md`
- `skills/world-import/SKILL.md`
- `skills/world-import/references/workflow.md`
- `skills/world-import/references/contracts.md`
- `skills/world-import/references/helper-tools.md`
- `src/world-import-cli.ts`
- `src/world-import/model-runner.ts`
- `src/world-import/helper-tools.ts`
- `src/world-import/command-router.ts`
- `src/world-import/eval.ts`
- `src/world-import/staging.ts`
- `src/world-import/types.ts`
- `src/world-import/run-audit.ts`

### Pi documentation

- `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/`

### External subagent research

- `pi-herdr-subagents` 0.1.5 fixed commit: <https://github.com/0xRichardH/pi-herdr-subagents/tree/d654eae75ff347ccb618113f2af85f3040d9ade9>
- `pi-subagents` 0.34.0 fixed commit: <https://github.com/nicobailon/pi-subagents/tree/8d2c05e51ce58923dea504b4530dc2643cb25c54>
- `pi-subagents` strict child tools: <https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/README.md#L769-L799>
- `pi-subagents` package agents: <https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/README.md#L624-L636>
- `pi-subagents` non-interactive wait: <https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/README.md#L594-L598>
- `pi-subagents` lifecycle/audit fields and RPC: <https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/README.md#L257-L281>
