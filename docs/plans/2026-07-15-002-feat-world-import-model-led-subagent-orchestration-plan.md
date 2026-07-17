---
title: "feat: Move world-import to model-led subagent orchestration with typed tools"
type: feat
date: 2026-07-15
origin: conversation and subagent-extension research
status: in progress; U0/U1/U1a implemented; U2b now has bounded read/proposal/batch/compendium foundations, but identity/conflict, dispatch enforcement, review/repair, and stress gates remain; U3 blocked on U2b
---

# feat: Introduce mem-import model-led subagent orchestration alongside legacy world-import

## Progress Update — 2026-07-16

U0 and the U1 extraction vertical slice are implemented: the `mem-import` coordinator/extractor skill guidance, typed normalization and bounded-read tools, durable cross-process extractor grants, extraction submission, revocation/expiry checks, and deterministic tests are present. The full test suite passed after this work.

Two manual Herdr U1 runs over the same 30-unit *Frankenstein* corpus are retained under the ignored test workspace, each run with a different worker model:

- `.memchat-agent-testing/output/frankenstein-full`: 30/30 extraction packets, 234 candidates, and 354 provenance refs; 31 assignments with one revoked retry.
- `.memchat-agent-testing/output/frankenstein-deepseek-v4`: 30/30 extraction packets, 315 candidates, and 374 provenance refs; 32 assignments with two revoked retries.

Both runs have complete per-unit extraction coverage, non-empty candidate packets, unit-local source/anchor provenance, hashed rather than raw durable grants, and revoked assignments for their recorded retries. They demonstrate the U1 artifact handoff and grant mechanics, but do **not** complete U1 acceptance: a direct artifact check found non-literal provenance quotes in 139/354 and 121/374 refs respectively. Examples include copied anchor display markers, typography substitutions, and ellipsized excerpts. The current submit validator verifies envelope shape and source/unit/anchor scope, not quote text. The run records also do not yet persist resolved worker model, adapter, or lifecycle identity; directory names are not an audit contract.

U1a below closed these correctness/audit gaps. Its deterministic tests, retained-run reinspection, and a fresh tiered model run are recorded in the following update.

## Progress Update — 2026-07-16 (U1a complete)

U1a is implemented and validated. Extraction validation now requires every provenance quote to be a literal contiguous excerpt of the cited normalized block range (canonical multi-block join: `\n\n`); it rejects rendered anchor labels, ellipses, typography substitutions, and unrelated text. Bounded source reads use a monotonic continuation cursor even within an oversized block. Live extractor assignments cannot overlap; revocation, explicit supersession, fresh retry IDs, and stale-submit protection are durable. Run/task records retain sanitized parent/worker model and thinking, adapter/profile, lifecycle, retry/supersession links, and per-packet hashes without raw grants.

The full TypeScript suite passed (`npm test`: 105 tests), as did `npm run build` and the focused mem-import test suite.

The two retained U1 Frankenstein bundles were reinspected with the new literal-quote rule:

- `.memchat-agent-testing/output/frankenstein-full`: 234/354 valid refs and 120 invalid refs (primarily 111 ellipsized quotes).
- `.memchat-agent-testing/output/frankenstein-deepseek-v4`: 255/374 valid refs and 119 invalid refs (59 ellipsized and 57 other non-literal source mismatches, plus minor marker/typography cases).

A fresh tiered extraction then completed with `openrouter/deepseek/deepseek-v4-pro` (coordinator, high thinking) and `openrouter/deepseek/deepseek-v4-flash` (workers, medium thinking): 30/30 submitted assignments, 490 candidates, and 570/570 literal provenance refs. All 30 assignments carry sanitized model/thinking, adapter/profile, and submitted lifecycle evidence; there were no retries, supersessions, or failures. Its durable audit is at `.memchat-agent-testing/.memchat-agent-testing/output/frankenstein-u1a-deepseek-tiered/stages/orchestration/u1a-quote-integrity-audit.json`. The nested path is retained as historical run evidence; coordinator guidance now requires an absolute output root or an `output/<run-name>` root relative to the test workspace.

## Progress Update — 2026-07-17 (U2 Alice post-mortem; U2b required)

The first full tiered Alice merge exposed two production blockers that deterministic unit tests did not catch. Extraction completed for all 13 normalized units with 108 candidates, but no canonical merge revision was persisted.

First, the coordinator correctly tried two ordinary `subagent` merger workers, then improperly changed facilities after provider-stream failures. Later merge attempts, including `merge-005`, were launched with `herdr_agent_start`. That tool creates a managed Herdr agent suitable for an isolated orchestrator; it is not the ordinary semantic-worker `subagent` facility required by this workflow. The fallback violated the run's fail-closed delegation gate and produced incompatible lifecycle behavior: ordinary subagent interruption/result handling could not control the managed agent. A model-authored adapter label in assignment audit did not prove which facility actually launched the worker.

Second, U2 replaced the legacy path's proven persist-first 5–12 artifact batch workflow with one complete-snapshot `mem_merge_write` call under a five-minute lease. The `merge-005` session acquired a lease and began two complete-snapshot tool calls, but both assistant turns were interrupted before tool execution. The first partial tool argument had only 18 artifacts and no candidate dispositions; the second had one artifact and no dispositions. Neither reached authorization or persistence. This was not a service-side rejection. It demonstrated that all-or-nothing model generation, lease heartbeats, and durable progress are incompatible at realistic merge sizes. The current unfiltered extraction read, complete merge read/write, full-snapshot revision receipts, and one-run-per-output-root layout will scale worse for large books and incremental multi-book series.

U2's authorization, fencing, CAS, immutable review binding, and finalization safety remain useful. U2b below replaces the monolithic semantic merge surface before U3 proceeds.

## Progress Update — U2b bounded transaction and compendium foundations

The first U2b implementation slices are complete and committed. They deliberately establish bounded durable handoffs before identity/review semantics, rather than attempting another monolithic model merge:

- `2055326` adds cursor-paginated extraction inventories, bounded candidate pages, scoped immutable shard proposals, and proposal-author grants.
- `28ef120`, `41533fd`, and `5a9533c` add bounded proposal-backed canonical batches, delta receipts, canonical inventory/artifact reads, and per-artifact read-set validation. An unrelated intervening canonical revision can rebase only when every declared read-set hash still matches; changed dependencies fail stale.
- `ed40636`, `2fdde78`, and `4b3f2c1` add persistent compendium/run records, isolated work roots, duplicate-source detection, shared canonical state/leases/receipts, and deterministic source/extraction projection with `stages/source-locator.json` for cross-run provenance lookup.
- `0fc1243` adds a deterministic two-work integration test covering normalize → extract → propose → shared batch → projection → checks → finalization → emitted Markdown. The full suite passed with 115 tests, plus TypeScript build and `git diff --check`.

This is service-level integration evidence, not the U2b facility gate: it does **not** launch ordinary semantic subagents or prove host-issued dispatch/lifecycle correlation. The complete-snapshot APIs remain legacy comparison surfaces; substantive coordinator guidance now uses bounded inventories and batch writes.

**Next session:** continue U2b with immutable identity/conflict reconciliation proposals (`match`/`create`/`ambiguous`), global canonical-ID ownership, explicit aliases/retcons/conflicts, and blocking collision/accounting gates. Then add revision-bound parallel review and bounded repair batches, real ordinary-subagent dispatch/lifecycle enforcement, and the large-work/incremental-series stress matrix. Do not begin U3 yet.

## Goal Capsule

Build `mem-import` as a **thin, model-led orchestration workflow** alongside the legacy `world-import` TypeScript program that hard-codes semantic session sequencing:

- the main/parent agent reads one `mem-import` coordinator skill;
- deterministic world-import operations are exposed to `mem-import` as typed tools instead of being invoked through `bash`;
- the parent inspects durable source, extraction, merge, review, and diagnostic artifacts and decides what to do next;
- the parent may launch individual workers, parallel fleets, chains, or a facility-native dynamic graph when the available subagent system supports them;
- worker roles receive only the tools appropriate to their role;
- deterministic contracts reject invalid operations and finalization refuses incomplete output;
- model choice, thinking level, worker topology, escalation, repeated review, and repair strategy remain visible experimental variables;
- a future `mem-import-cli`, if warranted, may host the same skill and tools while preserving output artifact parity; and
- legacy `world-import` is retained only until the explicit U4 cleanup gate removes it after U3.

This plan is self-contained so a new session can resume design or implementation without replaying the originating discussion.

## Decision Summary

### Superseding cleanup decision — 2026-07-16

After U3, complete a final **U4 world-import cleanup** before merging this work to `main`. It supersedes prior compatibility/parity/retention language in this plan: do not retain aliases, dual paths, artifact projections, or deprecated type names merely to preserve `world-import` behavior.

The canonical product is `mem-import`. Its default durable surface is a self-contained compendium at `compendia/<compendium-id>/`, where the compendium root contains `sources/`, `stages/`, emitted category directories (`people/`, `places/`, `things/`, `facts/`, `style/`), `index.md`, `coverage.md`, and `log.md`. `world/`, “world library,” `world-import`, and `WorldImport*` identifiers must not survive U4 except in historical Git commits. This does not require rewriting imported source prose that itself uses the ordinary word “world.”

### Confirmed decisions

1. **Use a thin, model-owned coordinator skill as the primary control plane.** Do not replace the current runner with a single opaque `run_mem_import_dag` tool.
2. **Move helper access from shell commands to typed tools.** Existing deterministic TypeScript functions remain the implementation source of truth; the command router can remain as a human/CLI adapter.
3. **Let the parent choose the orchestration shape.** The skill documents required subagent capabilities and available adapter profiles. The parent may use single launches, parallel calls, chains, dynamic fanout, or a model-authored DAG when that is the best fit.
4. **Use durable world-import artifacts as authoritative handoffs.** Subagent prose and chain `{previous}` values may be useful receipts or summaries but must not be the only handoff state.
5. **Enforce local validity and final completeness, not one rigid stage order.** Tools reject impossible/unsafe operations; diagnostics describe incomplete drafts; a final gate refuses success while structural/accounting blockers remain.
6. **Constrain workers with tool allowlists.** Extraction workers, reviewers, mergers, and repairers receive different typed tools; `bash` and generic write tools can be absent.
7. **Use hybrid review.** Deterministic review remains code; semantic review is performed inline by the parent or by constrained reviewer subagents.
8. **Require an existing compatible subagent facility.** If none is available, fail with concrete setup guidance. Do not ask the model to create a new worker extension during an import.
9. **Support model tiering as a first-class experiment.** Parent and workers may use different models/thinking levels, and actual resolved runtime and usage should be audited.
10. **Build `mem-import` alongside legacy `world-import` only during the migration.** New skills, worker profiles, typed-tool extensions, and any future CLI use the new name; U4 removes the legacy paths after U3 rather than retaining aliases.
11. **Defer the `mem-import-cli` host decision.** The interactive `mem-import` path is host-agent-led; do not recreate the legacy hermetic embedded-Pi design by default. Decide later whether a CLI is useful and, if it is, make it a thin non-semantic host rather than a stage scheduler.
12. **Preserve artifact parity, not exact runner behavior.** Existing output layouts, semantic stage contracts, readiness checks, and audit intent remain stable; invocation/session mechanics may change.
13. **Hold off on building a custom SDK subagent wrapper or bundling `pi-subagents` into memchat.** Evaluate installed host-agent facilities first. A pinned project-local adapter remains a disposable compatibility-test setup, not the intended interactive deployment model.
14. **Authorize privileged typed-tool workers through durable cross-process assignment grants.** Before a worker can mutate extraction, merge, review, or other scoped world-import state, it must be limited to its assigned run, role, units/artifacts/actions, and validity window; typed tools validate the grant independently in every child process. This hardening is deferred from U0's fixtureless, non-mutating adapter exploration.
15. **If a future CLI is adopted, give it a non-semantic lifecycle supervisor.** The host must wait for authoritative finalized/failed/cancelled state, worker completion, and bounded coordinator continuation without choosing semantic stages.
16. **Enforce one global merge writer with a lease and revision check.** Atomic file replacement alone is insufficient to prevent lost updates from concurrent merger/repair processes.
17. **Begin adapter evaluation as a model-led, artifact/outcome-led experiment.** The strong coordinator inspects installed facilities, makes a provisional suitability judgment, and evaluates real low-risk worker outcomes and durable import artifacts before investing in formal adapter proof. Executable conformance and enforcement hardening are deferred until evidence warrants privileged worker tools or a promotion decision; tool descriptions alone remain insufficient to claim proven enforcement.

### Naming and migration boundary

`mem-import` names the new agent-driven coordinator, worker roles, typed-tool extension, and audit-facing orchestration layer. A `mem-import-cli` is only a possible later host surface. The interactive path is intentionally distinct from the legacy `world-import` runner so both paths can coexist and be compared.

For initial parity, the new path continues to consume and produce the existing world-import source, stage, checkpoint, world-output, and audit artifacts. Do **not** rename those on-disk contracts merely because the host/skill is named `mem-import`. A future expansion beyond world-source imports may revisit the artifact vocabulary; that is out of scope for this migration.

`world-import` and its CLI are temporary migration/reference implementation only through U3. U4 removes them and establishes `mem-import` compendia as the only product surface; do not silently retain aliases or repoint legacy commands.

### Important terminology

This design is best described as **dynamic artifact-driven orchestration**.

### Trust and evaluation posture

The early path deliberately trusts a strong coordinator model to inspect the installed subagent facilities, choose whether and how to use one, and critically assess worker results. It does **not** begin by building a custom adapter fixture or treating a schema claim as a formal security proof.

Worker infrastructure quality is evaluated first through observable outcomes: durable world-import artifacts, deterministic diagnostics/finalization, worker completion behavior, audit records, and the coordinator's review of whether the resulting work is useful and internally consistent. A weak, confused, or insufficiently isolated worker facility is expected to reveal itself through poor artifacts, failed work, missing correlation, or unmanageable lifecycle behavior; the coordinator may retry, escalate, change topology, stop using that facility, or fail clearly.

This is a staged trust decision, not a claim that model inspection proves enforcement. Formal conformance probes, strict cross-process authorization tests, and other hardening remain planned before privileged mutation tools or CLI promotion if the evidence says they are necessary. They are intentionally deferred from U0 so experimentation is led by artifact quality and actual outcomes rather than premature infrastructure construction.

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
- **Now:** the parent agent chooses worker topology and sequencing after inspecting durable state. Typed tools and deterministic gates enforce contracts. A future CLI, if chosen, is only a non-semantic host; legacy `world-import` remains available for comparison.

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
│  reads mem-import coordinator skill                           │
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

1. **Interactive Pi/Herdr host — intended initial `mem-import` surface**
   - the coordinator is the agent already running in the user's host environment and uses that host's account-level `.pi` resources and installed worker facilities;
   - `mem-import` does not create a project-local Pi installation, pin a worker package under memchat, or shield itself from the host agent's resource catalog;
   - `pi-herdr-subagents` was available in the authoring environment, not guaranteed by this repository;
   - independent worker panes remain visible and interruptible when the selected host provides them.

2. **Ordinary Pi host without Herdr**
   - the same account-level host-agent principle applies;
   - `pi-subagents` is a candidate when the host has installed and enabled it, but is not a memchat dependency;
   - parent may use the host's foreground/async/wait controls when they are actually available.

3. **Disposable compatibility-test workspace**
   - an isolated subdirectory with a project-local `.pi` and a pinned adapter may be created to inspect a version, reproduce a conflict, or run a bounded experiment;
   - it is test infrastructure only, not a deployment requirement or resource-loading policy for interactive `mem-import`.

4. **Possible future `mem-import-cli`**
   - its existence and hosting/resource policy are deferred;
   - do not assume it embeds a hermetic Pi session, bundles `pi-subagents`, or inherits legacy `.memchat/pi` behavior;
   - if pursued, it must remain non-semantic and preserve the artifact/finalization contract.

5. **Future harness adapters**
   - any harness may be used if its subagent facility satisfies the capability contract;
   - adapter-specific invocation guidance belongs in a skill reference, not in semantic world-import instructions.

## Model-Owned Workflow, Graphs, and Chains

### What is intentionally not being built

Do not make the primary interface:

```text
mem_import_run_dag({ input, output, modelPolicy })
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

At workflow start, the parent should inspect its available tools and make a model-owned adapter selection.

- Known profiles provide evidence and invocation guidance, not an automatic trust verdict.
- For an unknown third facility, inspect its schema/documentation, then make a limited, low-risk worker attempt when its apparent capabilities make that reasonable.
- Assess the facility provisionally from observed worker behavior, correlation/lifecycle signals, and—once semantic work begins—the quality and completeness of durable artifacts and deterministic diagnostics. The parent may retry, change adapter/topology/model, continue inline, or stop with setup guidance.
- Do not claim that an adapter's allowlists, isolation, recursion prevention, or cancellation semantics are formally proven merely from those observations.
- Defer executable conformance probes and strict authorization proof until privileged worker-facing mutation tools or a promotion decision justify that investment.
- If no facility appears adequate for the work the coordinator wants to delegate, do not delegate it; explain the limitation or proceed inline where the active tool policy permits.
- Do not create, install, or code a subagent extension during an import unless the user separately requests a setup task.

The skill must not assume the tool is always named `subagent`; it should describe the contract, include known profiles, and make the coordinator's provisional, evidence-based judgment explicit.

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
- If a future CLI elects to use it, its host/resource policy must be designed explicitly; it must not accidentally recreate the legacy hermetic `.memchat/pi` setup or assume that a project-local test installation is the deployment model.
- Current package peers are wildcard, but its direct/dev Pi baseline is 0.74 while memchat's current lockfile resolves Pi 0.80.6; compatibility must be tested, not assumed ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/package.json#L55-L80)).

### Extension RPC

`pi-subagents` offers process-local v1 RPC methods `ping`, `status`, `spawn`, `interrupt`, and `stop`; RPC spawning is async-only and uses the same executor/validation ([source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/extension/rpc.ts#L14-L40), [source](https://github.com/nicobailon/pi-subagents/blob/8d2c05e51ce58923dea504b4530dc2643cb25c54/src/extension/rpc.ts#L170-L213)).

The coordinator model should normally call the subagent tool itself. A world-import extension may use RPC for capability probing, audit/status ingestion, or cancellation without taking semantic orchestration away from the model.

## Third-Party/Unknown Adapter Profile

The skill should not reject a capable third extension merely because it is not one of the two known profiles.

A generic selection procedure:

1. Identify candidate worker/delegation tools from the active tool catalog.
2. Compare their schema/documentation to the capability contract as preliminary evidence.
3. Have the coordinator select a low-risk trial appropriate to the available facility and inspect its completion, correlation, and resulting evidence.
4. Judge the facility provisionally by observable behavior and, for semantic work, the quality/completeness of durable artifacts plus deterministic diagnostics—not by worker prose alone.
5. Record the adapter/version, observed limitations, and coordinator rationale in the import audit when available.
6. Change models, topology, adapter, or stop delegating if outcomes are weak or lifecycle behavior is not manageable.
7. Add executable conformance probes for exact allowlist enforcement, recursion prevention, cancellation, and authorization only when moving to privileged mutation tools or promoting the infrastructure.

The parent may use any chain, DAG, or parallel feature supplied by an adapter it judges suitable when it remains the author of the workflow and artifact/finalization rules are preserved.

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

This is a prerequisite for **privileged worker-facing typed tools**, not a later detail. It is deliberately outside U0's fixtureless, non-mutating adapter exploration; introduce and verify it before enabling extraction submission, merge mutation, review persistence, or other scoped world-state writes.

`mem_import_begin` should create a run identity. Before dispatch, the coordinator issues a high-entropy bearer grant and persists only its hash plus an assignment record under a deterministic orchestration path such as:

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

### Authorization-decision audit

Before worker-facing mutation tools are promoted beyond U1, persist sanitized authorization decisions under the run output, for example:

```text
stages/orchestration/authorization-events.jsonl
```

Record both allowed and denied privileged tool decisions with a timestamp, operation/capability, assignment/task identity, requested unit or artifact scope, allow/deny outcome, and stable safe reason code. This makes out-of-scope, revoked, expired, wrong-role, and invalid-grant attempts reviewable from durable artifacts rather than only transient worker panes or session transcripts.

Never persist raw grants, source excerpts, unbounded rejected arguments, hidden reasoning, or credentials in this ledger. The service-side authorization decision remains authoritative; the ledger is audit evidence, not an enforcement mechanism. Add conformance coverage that deliberately exercises denied scope and verifies the corresponding sanitized event.

### Candidate inclusion and saliency audit

Prioritize durable accounting of model candidate-selection decisions before adding a broad saliency policy. A worker may favor a compact, salient extraction to reduce downstream merge/review work, but that choice can silently omit minor entities, technical details, props, or local context that a user later needs. Conversely, broad extraction improves recoverability and completeness but increases duplicate/noise handling downstream.

A later extraction/audit packet must make inclusion decisions inspectable: preserve each considered candidate's compact identity, group, local evidence, and model-authored include/defer/drop decision with a reason. A dropped or deferred candidate must remain durable audit evidence rather than disappearing from accounting. Deterministic checks should report per-unit and per-group candidate totals, inclusion/defer/drop counts, reasons, and unresolved accounting gaps. The parent or a later merger/reviewer—not TypeScript—decides whether a candidate should remain merely audited, be promoted, be merged, or be omitted from final world surfaces.

Do not require every early U1 worker to enumerate hidden chain-of-thought or claim exhaustive entity detection. The goal is to audit explicit candidate decisions the worker makes, preserve their evidence, and make the resulting completeness/saliency tradeoff visible for evaluation.

### Future interactive run preferences

A future interactive coordinator may optionally ask for a small run-policy preference before dispatch, such as desired reader-facing tone (technical versus friendly) and coverage posture (broad/completeness-oriented versus compact/saliency-oriented). This is a model-led intake step, not a helper default: skip it for unattended/non-interactive runs or when the caller supplied a policy, use an explicit documented default otherwise, and persist the selected policy as compact run/audit metadata. Do not block normalization or invent a user preference when none is needed.

### Proposed conceptual tool families

Names are provisional; contracts matter more than exact spelling.

#### Coordinator/run tools

- `mem_import_begin`
- `mem_import_normalize`
- `mem_import_status`
- `mem_import_inspect_manifest`
- `mem_import_validate`
- `mem_import_finalize`

Responsibilities:

- establish run identity and scoped output root;
- normalize input deterministically;
- report current artifact/checkpoint/accounting state;
- refuse final success while hard diagnostics remain;
- update the authoritative import audit.

#### Source-reading tools

- `mem_source_list_units`
- `mem_source_read_unit`
- `mem_source_read_slice`
- `mem_source_find_text`
- `mem_source_suggest_refs`
- `mem_source_resolve_ref`
- `mem_source_quote_ref`

These wrap current deterministic source/provenance helpers and never mutate semantic world state.

#### Extraction tools

- `mem_extraction_status`
- `mem_extraction_read`
- `mem_extraction_validate`
- `mem_extraction_submit`

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

- `mem_merge_read_candidates`
- `mem_merge_read_existing`
- `mem_merge_validate_artifact`
- `mem_merge_write_artifact`
- `mem_merge_write_artifacts`
- `mem_merge_patch`
- `mem_merge_accounting`

These wrap current artifact validation/upsert/patch behavior. Merge writing must use a cross-process single-writer lease for every fresh or maintained import because identity and cross-linking are global.

A merger/repairer must acquire a lease bound to its assignment grant. Lease acquisition should use an atomic filesystem primitive such as exclusive directory/file creation, persist owner/task/expiry/heartbeat metadata, and support explicit release plus conservative stale-owner recovery. Every merge mutation also supplies the expected merge revision/hash; stale compare-and-swap writes fail rather than overwriting newer state. Atomic JSON replacement remains necessary for file integrity but is not the concurrency control mechanism.

#### Deterministic check tools

- `mem_check_coverage`
- `mem_check_emit`
- `mem_check_lint`
- `mem_check_provenance`
- `mem_check_readiness`
- `mem_check_repair_summary`
- `mem_check_final_eval`

These report facts/heuristics and may write deterministic checkpoint artifacts, but do not perform semantic repair.

#### Semantic review tools

- `mem_review_read_bundle`
- `mem_review_read_artifact`
- `mem_review_read_extraction`
- `mem_review_read_diagnostics`
- `mem_review_submit`

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
- schema-validated `mem_review_submit`.

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

Durable cross-process assignment records are required once privileged typed-tool workers are enabled, although final naming may change. They are not required for U0's non-mutating adapter exploration. Other projections remain optional:

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

## `mem-import-cli` Decision: deferred

`mem-import` is first an interactive, host-agent-led skill path. Do not carry forward the legacy `world-import` assumption that memchat creates a fully hermetic project-local Pi runtime, owns a worker extension in `node_modules`, or shields execution from account-level `.pi` resources.

A disposable project-local `.pi` installation—such as the U0 `pi-subagents` test workspace—is valid compatibility-test infrastructure. It is not evidence that memchat should package, pin, or load that adapter for normal `mem-import` use.

### Revisit only if a CLI is still needed

If the interactive path proves useful and a standalone CLI remains desirable, decide its host/resource policy at that time. Evaluate at least:

- whether the CLI should require an explicitly selected external host facility, use an account-level Pi environment, or provide another clearly documented model;
- whether it can discover and use installed adapters without colliding with other extensions that register the same worker tool name;
- whether children can access the chosen tools, auth, models, and package resources without recreating legacy `.memchat/pi` behavior by accident;
- whether its lifecycle handling can preserve authoritative terminal state, cancellation, cleanup, audit, and artifact parity without choosing semantic stages.

A future CLI, if adopted, must be a thin non-semantic host: it may manage lifecycle events, wait for workers, and report terminal state, but it must never select extraction, merge, review, or repair sequencing. Do not select `pi-subagents` as its backend, build an SDK wrapper, or define a package-loading policy until that later decision is explicitly made.

## Proposed Package Shape

Exact paths are provisional.

```text
skills/
  mem-import/                    # new coordinator + semantic workflow
  mem-import-extractor/          # optional narrow worker skill/profile guidance
  mem-import-merger/
  mem-import-reviewer/
  mem-import-repairer/

extensions/
  mem-import-tools.ts            # typed deterministic tools over legacy services

agents/mem-import/
  extractor.md
  merger.md
  reviewer.md
  repairer.md

# Existing skills/world-import and src/world-import-cli.ts remain legacy.
```

Possible package metadata when `pi-subagents` is used:

```json
{
  "pi": {
    "extensions": ["./extensions/mem-import-tools.ts"],
    "skills": ["./skills"],
    "subagents": {
      "agents": ["./agents/mem-import"]
    }
  }
}
```

Do not finalize this manifest until the compatibility spike confirms how Pi core and `pi-subagents` compose package metadata.

## Skill Structure

### `mem-import` coordinator skill responsibilities

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
skills/mem-import/references/
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

U0 and U1 established the **agent-driven coordinator skill and constrained worker vertical slice**. Complete U1a correctness hardening before expanding the typed surface; only reconsider standalone CLI migration after the skill path is credible. TypeScript supplies deterministic capabilities and lifecycle plumbing; it must not regain semantic stage sequencing.

### U0. Explore adapter suitability through the coordinator skill

- Inspect installed `pi-subagents`, the environment-specific Herdr adapter, and any other candidate worker facilities through the coordinator's capability-discovery guidance. Do not build an adapter or custom conformance fixture in this unit.
- Add `mem-import` coordinator-skill guidance for capability discovery, provisional adapter selection, artifact-authoritative handoffs, outcome-led evaluation, and parent-owned next-action decisions. Remove bash/helper-command use from this new path, while retaining legacy `world-import` unchanged.
- Define a narrow scout role as skill/profile guidance: it must not be asked to mutate world state, recursively orchestrate, or rely on worker prose as canonical state. Where the selected adapter can enforce tool restrictions, request no `bash`, generic-write, or recursive-spawn access; record any inability to make that request as a limitation rather than pretending it is enforced.
- Demonstrate: the parent skill chooses one installed facility, dispatches one low-risk scout task using that facility's native controls, waits/receives a correlated result when supported, critically assesses the result, and chooses the next action itself. This is a provisional, model-led conclusion—not a formal proof of the adapter.
- Record observed capability, lifecycle, and outcome-quality findings before expanding to typed extraction submission, grants, merge locking, or CLI lifecycle supervision. Add the latter safeguards only when the next privileged surface warrants them.
- Do not change `world-import-cli.ts` or replace `model-runner.ts` in this unit.

### U1. Make the coordinator skill useful for a first extraction path

- Extract typed normalize/status/source-read/extraction-submission tools over current deterministic functions; keep `command-router.ts` unchanged as an adapter.
- Expand assignment grants and role allowlists so extractors can submit only assigned normalized units and their scoped extraction stage packets.
- Add a `mem-import` extractor worker profile and coordinator-skill decision guidance for single launch, parallel fanout, wait, inspection, re-extraction, and escalation. The parent still authors topology and sequencing.
- Add deterministic schema, output-root/run scope, role-allowlist, and missing-precondition tests.
- Demonstrate a parent skill completing normalization plus a small, artifact-backed extraction pass without bash helper commands. This is the first meaningful model-led import path, not a CLI cutover.

### U1a. Harden extraction provenance, pagination, and assignment exclusivity

This intermediate unit is required by the two retained U1 *Frankenstein* runs before additional model-backed extraction experiments or U2 work.

- **Quote integrity:** on extraction validation/submission, derive the selected normalized block range and require every non-empty `provenance.quote` to be a literal source excerpt from that range. Define one canonical multi-block join representation and permit a bounded excerpt within it; reject rendered `[bNNNN]` labels, ellipsized text, and typography substitutions. Keep semantic relevance and excerpt selection model-owned. Add valid single/multi-block, lightly bounded-excerpt, anchor-marker, ellipsis, typography-substitution, and absent-quote tests.
- **Pagination:** make bounded source reads monotonic even when one normalized block exceeds `maxChars`. Return an opaque continuation cursor or another deterministic offset mechanism tied to the same unit/block, and make it impossible for a worker to receive the same prefix indefinitely. Preserve local anchors as provenance identifiers, document the continuation protocol, and test a block larger than every ordinary page plus invalid/stale cursor handling.
- **Assignment overlap:** prevent two live extractor assignments from mutating the same unit. Reject an overlapping assignment until the prior assignment is explicitly revoked or superseded; ensure a revoked/superseded worker cannot win a submit race and replace the newer packet. Preserve retries as fresh task IDs and retain sanitized supersession/revocation evidence. Add concurrent/overlap, revoke-then-reassign, and stale-submit tests.
- **Audit minimum for the rerun:** persist sanitized parent/worker model and thinking, adapter/profile identity, task/run correlation, lifecycle outcome, assignment/retry/supersession relationship, and packet effect/hash. Never persist raw grants or chain-of-thought.

The legacy `world-import` path is useful comparison evidence but does not already solve these gaps. Its skill strongly directs models to call `quote-ref --as-ref`, which derives source text, but `write-extraction`/stage validation and merge lint check only quote presence/placeholder status plus source/anchor validity—not quote equality; `quote-ref --max-chars` itself intentionally emits an ellipsis. Legacy bounded reads expose ranges, not a resumable character cursor for an oversized single block. Its normal staged runner uses one extract session, so it avoids ordinary fleet overlap, but its atomic extraction writes are still last-writer-wins if concurrent writers are introduced; there is no extraction assignment lease or compare-and-swap.

### U2. Complete the coordinator-facing typed surface and worker roles

- Wrap artifact validation/upsert/patch, emit, lint, coverage, readiness, provenance audit, review submission, and final eval.
- Require a valid single-writer lease and expected revision/hash for every merge mutation; prove lease contention and stale compare-and-swap failures before enabling merger/repairer writes.
- Define merger, reviewer, and repairer prompts/tool allowlists; expose package agents for `pi-subagents` if accepted and equivalent Herdr guidance.
- Update the coordinator skill with merge/review/repair/finalization decision rules while preserving semantic guidance and allowing model-selected parallelism, chains, and DAGs.
- Separate hard errors from diagnostics and add output-root/run scoping, forged-grant, atomic-write, lease-contention, and stale-writer tests.

#### U2 canonical-contract decisions (2026-07-16)

U2 is a clean `mem-import` break, not a legacy-artifact compatibility layer. The current merge stage is the latest canonical snapshot and contains a run-global `revision`, a canonical semantic `contentHash` (computed without control metadata), and its parent hash. Every accepted mutation also writes an immutable, content-addressed revision receipt containing the exact snapshot, its extraction-input hashes, the actor/task and grant-safe audit identity, supplied checkpoint action IDs, and prior revision linkage. This makes rollback, comparison, and forensic review possible without treating an overwritable latest file as history.

The merge writer lease remains separate operational state. It is grant-bound, has a fencing generation, receives a 60-second heartbeat, expires after five minutes, is explicitly released on normal completion, and may be recovered only after expiry. Every mutation requires both the current fence and expected revision/hash, so a recovered or stale holder cannot write. Parent direct merge/repair is allowed, but it produces the same input/effect/rationale audit record as a worker mutation.

Reviewer findings are immutable task-keyed packets only, hash-bound to the reviewed merge and extraction revisions. Repair grants name explicit checkpoint/action IDs. `stages/import-run.json` becomes explicit schema v2, recording terminal/finalization state and derived/linked audit evidence. Durable authorization, merge, review, and finalization events must be credential-free and never contain hidden reasoning or raw bearer grants.

### U2b. Replace monolithic merge with delegated proposals and bounded canonical transactions

**Gate:** complete this unit before U3. Do not run another full-corpus model import against the complete-snapshot merge surface.

#### Required outcomes

1. Every semantic worker—extractor, proposal author, identity reconciler, canonical merger, reviewer, and repairer—is launched through the selected ordinary `subagent` facility with an exact role tool allowlist. `herdr_agent_start` may host a coordinator or a deliberately isolated orchestrator, but it is never a semantic-worker fallback.
2. If the selected `subagent` facility cannot launch, enforce the allowlist, resume, or complete within bounded retry policy, the coordinator records `mem_import_fail` and stops. It must not change to a managed-agent or inline semantic fallback.
3. Parallelize semantic preparation, identity analysis, and review, while retaining one logical canonical commit queue. Do not permit uncontrolled parallel canonical writers.
4. Replace complete-snapshot model writes with bounded, resumable transactions. A worker failure or interruption must preserve all earlier accepted batches.
5. Separate compendium identity from import-run identity so repeated book/edition runs can update one series compendium without recreating or rereading the entire corpus.
6. Keep entity identity, canon, conflicts, retcons, and proposal acceptance model-owned. Deterministic services validate scope, hashes, references, accounting, and atomicity only.

#### Target topology

```text
parallel source extraction
  -> parallel immutable shard proposals
  -> parallel identity/reconciliation proposals
  -> serialized bounded canonical commit queue
  -> parallel revision-bound reviewers
  -> serialized bounded repair commits
  -> deterministic checks and finalization
```

The canonical authority may be a sequence of fresh strong merger subagents rather than one ever-growing chat session. Continuity must live in durable canonical artifacts, an entity registry, conflict records, proposal decisions, and revision receipts—not worker conversation history.

#### Compendium and run boundary

Adopt one persistent compendium root and run-scoped input/effect records. The exact final names land in U4, but U2b behavior must support this shape:

```text
compendia/<compendium-id>/
  sources/<work-or-edition-id>/...
  stages/runs/<run-id>/extraction/...
  stages/proposals/...
  stages/identity/...
  stages/conflicts/...
  stages/merge/...
  stages/reviews/...
  people/ places/ things/ facts/ style/
```

- `begin` creates a new run beneath an existing compendium and records its baseline canonical root/revision; it must no longer reject every existing compendium root.
- Source/work/edition content hashes provide idempotency and duplicate detection while preserving distinct provenance occurrences.
- Candidate identity is globally namespaced by run/source/unit/candidate, while canonical entity identity is scoped to the compendium or series—not to one book.
- A new book normally reads and changes only its affected canonical closure. Untouched artifacts remain referenced by the next canonical root.
- Re-importing an edition must produce an explicit no-op, replacement, or conflict decision rather than silently duplicating entities.

#### Bounded read surfaces

Replace routine whole-corpus responses with cursor-based, projection-aware reads:

- extraction inventory: counts, groups, source/work, candidate IDs, packet hashes, and bounded summaries;
- extraction packet/candidate reads filtered by run, work, unit, group, candidate IDs, or cursor;
- canonical control read returning revision/root and counts without embedding every artifact;
- canonical inventory filtered by group, work, tags, canonical IDs, changed-since revision, or cursor;
- artifact/entity reads by explicit IDs plus an optionally bounded relationship neighborhood;
- conflict/proposal/review inventory and packet reads by hash/ID.

Every list/read tool must have a deterministic maximum item/character budget and monotonic continuation cursor. No role prompt should instruct a worker to fetch “all extraction packets” or the complete canonical merge for a substantive corpus.

#### Immutable semantic proposal packets

Add grant-scoped proposal roles that cannot mutate canonical state. A shard proposal packet contains at least:

- schema version, packet ID/hash, compendium/work/run IDs, task/partition identity;
- baseline canonical revision/root;
- exact extraction packet hashes and assigned source units/candidate IDs;
- provisional artifact packets and candidate dispositions;
- provenance anchors with service-derived exact quotes;
- unresolved local references, proposed links, and dependency packet IDs;
- possible matches to existing canonical IDs, uncertainty/conflict notes, and concise auditable rationale.

Partition shard synthesis primarily by `(workId, contiguous source-order range)` so scenes and narrative causality remain local. Bound assignments by candidate count and estimated context, not only chapter count. Workers submit multiple bounded proposal packets rather than one corpus packet.

#### Identity and conflict reconciliation

Add immutable identity proposal packets. Identity workers inspect a provisional mention plus a bounded canonical neighborhood and propose `match`, `create`, or `ambiguous`, including alternatives, inspected artifact hashes, evidence refs, and cross-partition referrals.

- Known canonical entities are owned/routed by canonical ID.
- Unknown mentions may be routed by `(compendiumId, entity kind, normalized mention-family bucket)`, but the bucket is only a work queue—not a deterministic identity decision.
- Aliases, titles, renames, reincarnations, edition differences, timeline disagreements, retcons, and contradictory claims become explicit reconciliation edges or durable conflict records.
- Oversized connected components receive an identity decision first, then split into bounded artifact transactions.
- Blocking unresolved identity collisions and unaccounted candidates prevent finalization. Nonblocking ambiguity remains visible in canonical metadata and review.

#### Bounded canonical transaction contract

Replace the normal complete-snapshot write with a merger-only bounded transaction, recommended surface `mem_merge_apply_batch`. A transaction should contain roughly 5–12 coupled artifact operations and the dispositions/conflict decisions that belong with them:

- expected global parent revision/root;
- proposal packet hashes;
- exact read set of artifact/entity/conflict IDs and expected content hashes;
- artifact upserts and, when explicitly supported, deletions/tombstones;
- candidate disposition additions/replacements;
- provisional-to-canonical ID mappings;
- conflict create/resolve/defer operations;
- concise rationale.

The service deterministically applies the transaction to the current materialized manifest, validates changed packets and cross-references, derives exact provenance quotes, and creates a new canonical root. Global revision/CAS remains the final ordering guard. Per-artifact/entity read-set hashes distinguish a relevant stale decision from an unrelated intervening commit, allowing the model to rebase only affected work.

Keep merger and repair schemas distinct. A normal merger tool must not expose repair-only `checkpointId` or `actionIds`. A repair transaction tool requires its assigned checkpoint/action IDs and cannot modify unrelated artifacts.

Semantic preparation and proposal persistence happen before lease acquisition. Acquire the fenced writer lease only after the bounded transaction is ready; re-read the transaction read set under the fence, commit, and release. Tool-call generation must be small enough that routine commits do not depend on lease heartbeats.

#### Canonical storage and history

Avoid copying the complete compendium into every revision receipt:

- store immutable content-addressed artifact/entity/conflict blobs;
- store an immutable transaction receipt with parent root, operation hashes, proposal hashes, read-set hashes, actor/task/fence, accepted/rejected/deferred decisions, and resulting root;
- maintain an atomically replaced materialized latest manifest/index;
- emit deterministic complete snapshots only for periodic checkpoints, export, or final projection;
- prove that any canonical revision can be reconstructed from a checkpoint plus transactions.

History growth should be proportional to changed content and transaction metadata, not `revision count × entire compendium size`. Input dependency hashes should name the extraction/proposal packets actually used by the transaction rather than rehashing every historical extraction packet on every commit.

#### Review and repair topology

Run independent reviewer subagents in parallel against one exact canonical root:

- proposal/candidate accounting and omission;
- provenance/claim support;
- per-work narrative continuity and scene ordering;
- entity/relationship consistency;
- cross-book identity, timeline, canon, conflict, and retcon handling;
- style and reusable narrative surfaces.

Reviewers use bounded inventories and targeted reads, then submit immutable packets naming their read sets. One strong global reviewer reads deterministic inventories, unresolved conflicts, reviewer summaries, and targeted evidence—not the complete corpus. Accepted findings become bounded repair proposals and pass through the same serialized canonical commit queue. A repair invalidates only reviews whose declared read sets changed; final approval binds to the final canonical root.

#### Facility enforcement and lifecycle audit

Prompt guidance alone is insufficient. Implement the strongest evidence the installed adapter can provide:

- assignment records declare the required facility class/profile and exact tool allowlist;
- dispatch records capture the host-issued subagent task/session identity, requested and observed model/thinking, resolved tool set, lifecycle outcome, retry/resume/supersession links, and timestamps;
- finalization rejects privileged semantic effects lacking a correlated accepted subagent dispatch record;
- model-authored adapter labels are metadata, not facility attestation;
- grants, prompts, hidden reasoning, and raw credentials never enter durable audit.

Where the host cannot provide an independently correlatable dispatch receipt, record that limitation and fail the privileged production gate rather than claiming enforcement. The local Alice regression must explicitly prove that managed Herdr agents cannot satisfy semantic-worker assignments.

#### Implementation sequence

1. Freeze U3 and retain the legacy CLI as comparison evidence until U2b passes.
2. Add failing scale/delegation fixtures before replacing contracts: managed-agent fallback, interrupted partial merge, stale proposal, duplicate cross-book identity, and incremental existing-compendium begin.
3. Introduce semantic production modules for compendium/run state, bounded inventories, proposal packets, canonical manifests/blobs, transactions, and conflicts. Do not add new roadmap-numbered production filenames or identifiers.
4. Add cursor/filter read tools and remove whole-corpus reads from role guidance; retain any complete debug read as coordinator-only and explicitly non-routine.
5. Add proposal and identity worker assignments/submission tools with candidate/source scope and immutable packet hashes.
6. Add bounded merger and repair transaction tools, short lease usage, per-object read-set CAS, delta receipts, materialized latest state, and deterministic reconstruction tests.
7. Add actual subagent dispatch/lifecycle correlation and make unsupported facility/fallback behavior terminal.
8. Rewrite coordinator and role prompts to be concise, execution-first, and packet-oriented. The coordinator controls adaptive fanout/backpressure and waits for durable packets rather than prose.
9. Add parallel partitioned review plus read-set invalidation and bounded repair transactions.
10. Port emission, lint, coverage, provenance audit, and finalization to the canonical manifest/transaction model.
11. Run focused unit/concurrency/storage tests, then the full suite, then a fresh Alice import through ordinary subagents only.
12. Run the large-book and incremental-series stress matrix below before unblocking U3.

#### Stress and failure matrix

- **Large single work:** at least 500 normalized units, 5,000 extraction candidates, and 1,000 canonical artifacts; no worker tool response or mutation requires whole-corpus payloads.
- **Incremental series:** at least 10 sequential book runs in one compendium with recurring entities, aliases, renamed titles, shared places, and cross-book relationships; each run changes only the affected closure.
- **Edition repeat:** identical source hash is idempotent; a changed edition retains distinct provenance and produces explicit continuity/conflict decisions.
- **Parallel pressure:** at least 20 proposal workers may complete out of order while canonical commits remain serial and backpressured.
- **Identity collision:** two shards propose the same new person/place/thing and cannot create duplicate canonical identities without an explicit conflict or reviewed decision.
- **Stale proposal:** unrelated canonical changes permit a bounded rebase; changed read-set hashes require semantic reconsideration.
- **Interruption:** provider failure, cancellation, or malformed proposal leaves prior proposal/commit artifacts intact and resumable.
- **Lease/fence:** expiry, recovery, stale fence, and stale global CAS cannot lose accepted transactions.
- **Storage:** hundreds of small transactions demonstrate changed-content-proportional history rather than repeated full snapshots.
- **Review invalidation:** reviewers bind to exact roots/read sets; affected reviews become stale after repair while unrelated reviews remain valid.
- **Facility:** every semantic worker effect correlates to an ordinary subagent lifecycle record and exact allowlist; managed-agent and inline fallbacks fail finalization.

#### U2b acceptance gate

U2b is complete only when:

1. A fresh Alice run finalizes through ordinary subagents with no managed-agent or inline semantic fallback.
2. Merge progress is visible after the first bounded accepted transaction and survives interruption.
3. No normal merger/reviewer must load every extraction packet or the entire canonical compendium.
4. Canonical commits are serialized, fenced, CAS-checked, immutable, reconstructable, and bounded.
5. Cross-shard and cross-book identity decisions are explicit and reviewable.
6. An existing compendium accepts a new run and preserves unaffected canonical content.
7. The large-work and incremental-series fixtures pass deterministic accounting, provenance, conflict, reconstruction, storage-growth, and finalization checks.
8. The full TypeScript suite and relevant smoke tests pass.

### U3. Add worker-aware orchestration audit and skill-level evaluations

- Extend or version `stages/import-run.json` and orchestration projections with parent/worker model, tool, task, artifact, adapter-profile, redacted authorization metadata, and sanitized allow/deny authorization decisions.
- Add candidate inclusion/saliency accounting: durable include/defer/drop decisions with compact evidence/reasons plus deterministic per-unit/per-group accounting and gap diagnostics.
- Ingest adapter telemetry when available and preserve compact/redacted audit policy.
- Add model-led skill fixtures: cheap extraction fleet plus strong coordinator/merger/reviewer; strong workers plus weaker coordinator; targeted re-extraction; inline versus delegated review; bounded repeated review; facility-native chain versus incremental dispatch; and no-compatible-subagent failure.

### U4. Remove world-import and establish canonical compendia

- Gate this unit on U3 completion and execute it as the final pre-`main` migration, not as an optional compatibility task.
- Move/rewrite reusable deterministic code under `src/mem-import/`; remove `src/world-import/`, `world-import-cli`, helper commands, the old embedded model runner, old skills, old tests, old docs, and all `WorldImport*`/`world-import` identifiers.
- Replace the emitted `world/` projection with the canonical compendium-root layout at `compendia/<compendium-id>/`: source/stage evidence and rendered category/index/coverage/log Markdown live in that single compendium directory.
- Rename types, schemas, diagnostics, audit records, command/help text, paths, fixtures, and documentation so the implementation reads as a first-generation `mem-import` design. Do not preserve aliases, compatibility readers, byte-parity gates, or migration shims.
- Port only deterministic behavior that remains useful—normalization, span/provenance validation, artifact rendering, lint, coverage, checks, and audit logic—under `MemImport*` names and contracts. Retain semantic decisions in model-led skills.
- Add deletion-oriented regression checks: source/build output contains no legacy identifiers or `world/` artifact paths, the default compendia layout is emitted, and all active tools/docs reference only mem-import/compendium vocabulary.
- Remove roadmap milestone labels from the product implementation. `U0`, `U1`, `U1a`, `U2`, `U2b`, and similar labels belong only in planning/history documents—not runtime class names, variables, filenames, comments, tool descriptions, schemas, tests, active skills, or user-facing docs. In particular, replace `src/mem-import/u2-service.ts`, `MemImportU2Service`, the `u2` extension variable, `mem-import U2` comments/headings, and remaining U-number role/tool prose with semantic production names such as canonical store, merge service, extraction service, or orchestration service.
- Add a cleanup assertion equivalent to `rg -n '\bU[0-9]+[a-z]?\b|u[0-9]+-' src extensions skills docs --glob '!docs/plans/**'` and require no matches in active product code/docs; apply the same rule to production/test filenames. Historical roadmap plans may retain milestone labels.
- Delete legacy fixture output and stale plans/docs or explicitly mark historically retained documents as non-product archival material outside the active docs tree.

### U5. Revisit whether `mem-import-cli` is needed

- Do not implement a CLI by default. First evaluate whether the host-agent-led interactive path has made a separate CLI unnecessary.
- If a CLI is still desired, make an explicit host/resource-policy decision rather than inheriting legacy embedded-Pi, `.memchat/pi`, or project-local-adapter assumptions.
- Only after that decision, design any lifecycle plumbing as a thin non-semantic host: stream events, wait for authoritative terminal state, deliver bounded coordinator continuations, enforce budgets, and propagate cancellation/cleanup. It never selects an import stage.

### U5a. Conditional CLI gate

- Apply this gate only if U5 explicitly chooses to build `mem-import-cli`.
- Validate the chosen host against deterministic stubbed-worker and small model-backed compendium fixtures: normalized layout, extraction/merge envelopes, readiness/checkpoint behavior, emitted category/index/source pages, lint/accounting, audit completeness/redaction, and failure/cancellation state.
- Define CLI flag/default behavior and terminal semantics for `mem-import`; no legacy command or rollback surface is retained.

### U6. Update docs and smoke tests

- `docs/mem-import.md`
- `README.md`
- `docs/smoke-tests.md`
- coordinator/worker skill references and adapter setup notes.

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

### Adapter evaluation and later hardening

- U0: coordinator-led inspection and low-risk trials record observed tool visibility, correlation, completion, interruption/cleanup where available, and outcome quality; they do not claim formal enforcement.
- U1+: judge delegated semantic work by durable artifacts, deterministic diagnostics, and auditable lifecycle behavior. Weak outcomes are evidence to retry, escalate, alter topology, or stop delegating.
- Before privileged worker mutation tools or infrastructure promotion: add the exact conformance checks then required—e.g. Herdr fresh/lineage behavior, exact allowlists, completion/interrupt/resume; `pi-subagents` extension loading, profile discovery, strict typed tools, fresh context, wait, timeout/stop, telemetry, and cleanup; and unknown-adapter enforcement proof where applicable.
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
5. The coordinator makes an explicit, auditable suitability judgment before delegation and avoids or stops using a facility whose observed behavior or artifact outcomes are inadequate; no claim of formally proven enforcement is made before later hardening.
6. Every worker-facing tool rejects forged, expired, revoked, cross-role, and out-of-assignment grants.
7. Invalid operations fail locally with actionable errors.
8. Incomplete drafts remain inspectable, but finalization refuses hard blockers.
9. Concurrent merge writers cannot cause lost updates; lease and revision/CAS enforcement rejects stale writers.
10. Existing world-import output structure and quality gates remain available.
11. Parent and worker model assignments, actual runtimes, costs/usage when available, and artifact effects are auditable.
12. If a new CLI is explicitly chosen, it contains materially less orchestration logic than the legacy `world-import` `model-runner.ts` path.
13. If a new CLI is explicitly chosen, early coordinator return cannot terminate a nonterminal run; the host reaches authoritative terminal state or bounded failure/cancellation.
14. Legacy `world-import` and any explicitly chosen new CLI pass the defined artifact/checkpoint/audit/exit-semantics parity gate before promotion.
15. No memchat-bundled or project-local `pi-subagents` dependency is implied by the interactive `mem-import` path; any later CLI backend decision is documented separately.
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

Mitigation: let the strong coordinator inspect and trial the installed facility, judge it first by durable artifacts, deterministic diagnostics, and observable lifecycle behavior, and record the adapter/version plus observed limitations. Do not mistake this evidence for a security proof; introduce conformance probes and authorization hardening later, before privileged mutation or promotion, if evidence warrants it.

### Risk: coordinator returns before the CLI run is complete

Mitigation: deterministic host lifecycle supervisor waits on worker/run events, issues bounded continuation prompts without choosing semantic stages, and exits only after authoritative terminal state and cleanup.

### Risk: both known extensions register `subagent`

Mitigation: treat them as selectable alternatives initially. Use package/resource filtering or one enabled adapter per coordinator until coexistence is explicitly tested.

### Risk: a future CLI accidentally recreates legacy resource isolation

Mitigation: defer the CLI host/resource-policy decision. If a CLI is later selected, test its adapter discovery, extension conflicts, auth/model/tool visibility, package resources, and Pi binary selection against the chosen policy rather than assuming `.memchat/pi` or a project-local test installation.

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
12. When and how an interactive coordinator should ask optional tone and completeness-versus-saliency preferences, and how that policy is represented in durable audit metadata without blocking unattended runs.
12. Exact merge-lease heartbeat, expiry, stale-owner recovery, and repair handoff policy; single-writer lease plus revision/CAS enforcement for every import is decided.
13. Whether a `mem-import-cli` is needed at all; only if it is, its explicit host/resource policy and any adapter dependency policy.

## Recommended Next Session

Resume with **U2b only**. Do not begin U3 and do not run another full model-backed import against the complete-snapshot merge contract. Bounded reads, immutable proposal packets, serialized bounded canonical transactions, compendium/run separation, shared projection/finalization, and a deterministic two-work integration path are now implemented. Start next with immutable identity/conflict reconciliation and canonical-ID ownership, then revision-bound parallel review/repair, actual ordinary-subagent dispatch/lifecycle correlation, and the large-work/incremental-series stress matrix. Keep the legacy CLI unchanged as comparison evidence. U3 begins only after the U2b acceptance gate passes; U4 then removes legacy `world-import` vocabulary plus all roadmap milestone labels from production code, filenames, active skills, tests, and user-facing docs before merging to `main`.

## New-Session Resume Checklist

A new planning/implementation session should know:

- `mem-import` is the new thin model-led coordinator/worker path; `world-import` is a temporary reference path scheduled for complete removal in U4 after U3.
- The parent is explicitly allowed to choose facility-native chains, dynamic DAGs, or incremental calls.
- Typed tools and artifact/finalization contracts provide the deterministic safety boundary.
- U0 deliberately begins with coordinator-led, low-risk adapter trials; judge worker infrastructure by durable artifact quality, deterministic outcomes, and observable lifecycle behavior rather than assuming a schema proves trust.
- Formal conformance probes, cross-process assignment grants, and hard authorization tests are deferred until privileged worker-facing tools or promotion justify them.
- Worker tool allowlists should remove bash and generic writes where the selected adapter can enforce that request; otherwise record the limitation and let the coordinator decide whether delegation remains appropriate.
- Every merge mutation requires a cross-process single-writer lease and expected revision/CAS check.
- Interactive `mem-import` deliberately uses the already-running host agent and its account-level `.pi` resources; it does not create a memchat project-local Pi installation or bundle an adapter.
- A temporary subdirectory with project-local `.pi`/`pi-subagents` is compatibility-test infrastructure only, not an interactive deployment model.
- Whether `mem-import-cli` exists and what resources it hosts is deferred. If it is later selected, it needs a non-semantic completion supervisor so early coordinator return cannot abandon workers or incomplete state.
- Preserve existing world-import on-disk artifacts during the migration; the new name does not authorize an artifact-layout rename.
- Review is hybrid: deterministic checks plus parent or constrained semantic reviewers.
- Model tiering and orchestration topology are evaluation variables, so audit them.
- `pi-herdr-subagents` satisfies core interactive worker needs but lacks hard timeout/usage telemetry and requires Herdr/persisted parent state.
- `pi-subagents` is a candidate that an account-level host agent may already have installed. The U0 disposable test showed usable lifecycle/correlation signals plus profile/acceptance limitations; it is not a memchat dependency or chosen CLI backend.
- We agreed not to ask the model to build a worker extension live.
- We agreed to hold off on our own SDK worker and defer all CLI/backend decisions until the interactive host-agent path supplies evidence.
- The extraction slices and U2 safety kernel are implemented, but the Alice post-mortem reopened merge architecture as U2b. Preserve fencing/CAS/review binding/finalization safety while replacing complete-snapshot semantics with proposals and bounded transactions. U3 is blocked until U2b passes; U4 removes roadmap labels from all production surfaces.

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
