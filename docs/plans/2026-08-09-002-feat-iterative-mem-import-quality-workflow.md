---
title: "feat: Refactor mem-import into iterative shard review, repair campaigns, and bounded finalization"
type: feat
date: 2026-08-09
status: staged implementation in progress
origin: three-chapter Alice Herdr stress test
related:
  - 2026-08-09-001-feat-pi-herdr-caller-report-handoff.md
---

# Iterative mem-import quality workflow and semantic shards

> **Proposed design:** This plan records the next mem-import architecture direction. It is not runtime authority until the active skill, named profiles, tools, schemas, tests, and smoke documentation are updated. Existing finalized and failed runs remain historical evidence and must stay readable.
>
> **Implementation note (2026-08-10):** Stages 0–2 are now implemented in `5917cd2` plus follow-up hardening in `c7c12ea`: review, repair, verification, and finalization have separate profiles; v2 review modes, parent policy, frozen campaigns, verification packets, quality readiness, deferred-finalization status, and convergence controls are durable and tested. The executed `pi-herdr-subagents` `caller_report` work is integrated only as non-authoritative lifecycle guidance; it is not a semantic assignment tool or mutation authority. The full test suite passes 164/164, and the working tree is clean.
>
> **Next work:** First validate a tiny end-to-end import through all seven phases, including the parent policy checkpoint and a no-hidden-loop verification path. Then implement Stage 3 canonical change sets, model-authored impact plans, bounded semantic shards, overlap declarations, and finding reconciliation. Follow with Stage 4 quality-debt lineage, Stage 5 independent broad-audit campaigns, and Stage 7 evaluation against the tiny fixture, three-chapter Alice, a subsequent chapter update, and a bounded audit. Tune budgets and shard bounds only from recorded quality, read, cost, and elapsed-time evidence.

## Summary

Refactor mem-import quality work for maintained compendia that grow chapter by chapter, book by book, and eventually across whole series.

The current `review-finalization` coordinator combines broad review, repeated repair, post-repair review, checks, lease management, and finalization in one long-lived recursive session. Replace it with parent-visible, ledger-backed phases:

```text
extract -> propose/reconcile -> merge
  -> impact plan
  -> semantic-shard review
  -> finding reconciliation
  -> parent policy checkpoint
  -> optional bounded repair campaign
  -> scoped verification
  -> deterministic finalization
```

Quality remains model-driven. Deterministic tools own bounds, immutable state transitions, action accounting, stale-state checks, authorization, and terminal policy. No coordinator may internally loop from review back into another open-ended repair campaign.

## Product direction

A maintained compendium is never permanently “done.” New work may:

- add new entities, places, objects, facts, and style evidence;
- extend recurring identities and relationships;
- revise chronology or narrative summaries;
- reveal conflicts, retcons, aliases, or mistaken earlier interpretations;
- increase the value of previously deferred quality work.

Therefore:

- each ingest iteration must be correct, provenance-rich, accounted, and coherent over its impact surface;
- optional enrichment may remain as visible quality debt;
- broad reviews occur periodically as explicit maintenance work;
- repairs are selectable campaigns, not hidden automatic loops;
- finalizing one ingest run means the iteration is valid, not that the entire series compendium is perfect.

## Stress-test evidence

A recovered three-chapter Alice import established that extraction, proposal waves, canonical merge, exact named profiles, lifecycle receipts, and usage sidecars can work at moderate scale:

- 3 normalized chapter units;
- 109 extraction candidates;
- 11 proposals;
- 99 initial canonical artifacts;
- all proposals consumed and candidates accounted.

The monolithic review/finalization phase then failed to converge:

- canon advanced from revision 3 to revision 18;
- artifacts increased from 99 to 105;
- 8 reviewer assignments;
- 6 repairer assignments;
- 15 repair transactions;
- 5 completed reviews became stale;
- no current review remained when stopped;
- 1,128 bounded evidence-read calls;
- reviewers performed 766 individual canonical artifact reads;
- the coordinator ran about 162 minutes and consumed more than 10 million total/cache tokens in its own recorded session;
- large model requests also experienced mid-stream WebSocket provider failures.

The semantic progression was understandable but non-convergent:

1. initial review requested identity expansion, narrative surfaces, chronology, and central traversal;
2. repairs created and linked new narrative surfaces;
3. later full reviews treated those surfaces as creating new reciprocal traversal obligations;
4. every mutation invalidated the prior review;
5. each fresh review discovered another bounded set of improvements.

This is a workflow-boundary failure, not proof that model review or repair should be removed.

## Core decisions

### D1. Split review, repair, verification, and finalization

Create fresh parent-launched coordinators:

- `mem-import-coordinator-review`
- `mem-import-coordinator-repair`
- `mem-import-coordinator-verify`
- `mem-import-coordinator-finalize`

The parent regains control after every durable checkpoint. No one coordinator dispatches both unrestricted reviewers and repeated repairers.

### D2. Use semantic impact shards

Review scope is model-authored around coherent meaning, then deterministically bounded. A shard is not inherently a chapter, category, or fixed artifact count.

Examples:

- Alice identity continuity across Chapters I–IV;
- the White Rabbit pursuit chain;
- Chapter III shore gathering and Caucus-race;
- size-change chronology;
- Pool of Tears setting/event relationships;
- one location system across a book;
- one relationship or retcon across a series.

### D3. Separate initial review from verification

An initial review may propose repair actions. Verification receives exact approved actions and changed scope, then judges only whether those actions are satisfied, partially satisfied, regressed, or impossible.

Verification cannot silently become another broad review.

### D4. Freeze each repair campaign

After parent policy selection, freeze:

- approved action IDs;
- semantic acceptance criteria;
- artifact and dependency scope;
- whether artifact creation is allowed;
- baseline revision/hash;
- budgets.

A repairer cannot expand that surface. A verifier cannot replace completed actions with semantically equivalent new IDs.

### D5. Persist quality debt

Non-blocking findings remain durable across iterations. Later content may add evidence, raise priority, supersede, resolve, or reopen them through explicit lineage.

### D6. Broad reviews are separate maintenance work

Run broad audits by policy, not after every ingest. Audit findings enter a reconciled backlog. They do not immediately trigger an automatic full repair loop.

### D7. Live reporting is transparency only

When `pi-herdr-subagents` gains `caller_report`, coordinators may report progress, budget, and checkpoint status. Reports are non-authoritative. Parent decisions remain typed durable artifacts.

## Quality gates

### Per-ingest correctness gate

Always require:

- normalized source and accepted extraction packets;
- exact proposal-stage disposition coverage;
- complete canonical candidate accounting;
- no blocking identity conflict;
- provenance resolvability;
- no broken declared links;
- coherent updates to materially affected recurring identities;
- no contradiction or regression introduced by new content;
- current verification for approved blocking repairs;
- deterministic checks without errors.

### Deferred enrichment

May remain visible without blocking an ingest:

- optional reciprocal links;
- additional narrative surfaces not explicitly required by policy;
- stylistic expansion;
- broader related-edge density;
- secondary identity detail not needed for accurate retrieval;
- improvements outside the current impact surface.

### Periodic broad-audit gate

May evaluate:

- principal identity continuity across books;
- long chronology and arc coherence;
- relationship development;
- location/world systems;
- retcons and conflicts;
- synopsis, timeline, and guide surfaces;
- terminology and style consistency;
- retrieval/traversal quality;
- deferred finding backlog.

A broad audit is allowed to produce substantial quality debt. Repair remains parent-selected.

## Role hierarchy

```text
Human/user
└── Root import parent
    ├── Extraction coordinator
    │   └── Extractors
    ├── Proposal/reconciliation coordinator
    │   ├── Proposers
    │   └── Identity reconcilers
    ├── Merge coordinator
    │   └── Merger
    ├── Impact/review coordinator
    │   └── Semantic-shard reviewers
    ├── Finding reconciliation coordinator
    │   └── Finding reconciler(s)
    ├── Parent policy checkpoint
    ├── Repair coordinator
    │   └── Repairer(s)
    ├── Verification coordinator
    │   └── Verification reviewers
    └── Finalization coordinator
```

Decision rights:

- workers own bounded semantic judgment;
- coordinators own bounded dispatch, retries, effect verification, and shard accounting;
- the root parent owns phase transitions, budget, repair approval, defer/fail/finalize policy, and user escalation;
- deterministic tools own scope validation, immutable transitions, accounting, staleness, and terminal readiness.

## Semantic shards across scales

Semantic sharding is adaptive.

| Update scale | Typical review shards |
|---|---|
| Sparse chapter | local narrative plus one or two affected identities |
| Dense chapter | several scene, identity, chronology, relationship, and location shards |
| Whole book | major character arcs, event sequences, important settings, relationships, narrative surfaces |
| New series volume | recurring identity/relationship shards plus book-local arcs and retcon checks |
| Broad series audit | principal identities, chronology regions, world systems, retcons, retrieval domains |

### Chapter-by-chapter example

A new Chapter IV might produce:

```text
Shard A — Chapter IV local narrative completeness
Shard B — Alice continuity across Chapters I–IV
Shard C — White Rabbit continuity across Chapters I, II, and IV
Shard D — size-change chronology and possible contradiction
Shard E — new location and participating events
```

The chapter is the source boundary, not necessarily the semantic boundary.

Rules:

- do not force one chapter into one shard;
- sparse related updates may share a shard;
- dense chapters split by coherent scene/identity/event concerns;
- recurring identity shards span older works when new evidence materially affects them;
- minor artifacts may require only deterministic provenance/link checks;
- shards may overlap when one artifact participates in multiple concerns;
- overlap must be declared and reconciled, not treated as duplicate accounting failure.

### Bounding shards

The model chooses semantic membership. Tools enforce practical limits such as:

- maximum artifacts;
- maximum source units;
- maximum source characters/evidence references;
- maximum changed dependencies;
- maximum expected findings;
- model context estimate or fixed read allowance.

When a coherent identity exceeds one worker bound, use an explicit hierarchy:

```text
Alice identity
  -> early-volume continuity shard
  -> middle-volume continuity shard
  -> late-volume continuity shard
  -> bounded cross-shard identity synthesis/reconciliation
```

Do not split solely by equal counts when that destroys semantic coherence.

## Durable protocol

### 1. Canonical change set

Every merge or repair transaction already records canonical effects. Add a compact review-oriented delta projection:

```ts
type CanonicalChangeSet = {
  version: 1;
  runId: string;
  baselineRevision: number;
  reviewRevision: number;
  baselineContentHash: string | null;
  reviewContentHash: string;
  createdArtifactIds: string[];
  updatedArtifactIds: string[];
  deletedArtifactIds: string[];
  matchedIdentityIds: string[];
  changedRelationshipIds: string[];
  sourceUnitIds: string[];
  conflictIds: string[];
  touchedFindingIds: string[];
};
```

This is deterministic transaction accounting, not semantic impact selection.

### 2. Review impact plan

Add a model-authored plan bound to the exact canonical change set:

```ts
type ReviewImpactPlan = {
  version: 1;
  kind: "mem-import-review-plan";
  id: string;
  mode: "ingest" | "broad-audit";
  baselineRevision: number;
  reviewRevision: number;
  reviewContentHash: string;
  changeSetHash: string;
  shards: Array<{
    id: string;
    kind:
      | "source-local"
      | "identity-continuity"
      | "relationship"
      | "chronology"
      | "location-system"
      | "conflict-retcon"
      | "narrative-surface"
      | "retrieval-traversal"
      | "style"
      | "other";
    artifactIds: string[];
    sourceUnitIds: string[];
    dependencyArtifactIds?: string[];
    priorFindingIds?: string[];
    priority: "blocking" | "material" | "enrichment";
    rationale: string;
  }>;
  budgets: ReviewBudget;
  rationale: string;
};
```

Unlike proposal cluster plans, artifact membership need not be an exact partition. Validation requires:

- all IDs exist at the bound revision;
- overlap is explicit and bounded;
- every material changed artifact is represented or given a model-authored exclusion rationale;
- prior findings touched by the delta are represented or explicitly unchanged;
- shard count and scope fit the budget;
- stale revision/hash fails closed.

Deterministic code does not decide semantic shard membership.

### 3. Shard review packet

A reviewer assignment names exactly one plan hash and shard ID.

```ts
type ShardReviewPacket = {
  version: 2;
  kind: "mem-import-review";
  mode: "initial-shard";
  reviewPlanHash: string;
  shardId: string;
  reviewedRevision: number;
  reviewedContentHash: string;
  findings: ReviewFindingV2[];
  readSet: CanonicalReadSet;
  rationale: string;
};
```

Each finding declares:

```ts
type ReviewFindingV2 = {
  id: string;
  fingerprint: string;
  category: string;
  severity: "info" | "warning" | "repair" | "critical";
  blocking: boolean;
  summary: string;
  artifactIds: string[];
  sourceRefs: unknown[];
  proposedAction?: {
    id: string;
    acceptanceCriteria: string[];
    artifactScope: string[];
    dependencyScope: string[];
    allowCreateArtifacts: boolean;
    rationale: string;
  };
};
```

Fingerprints aid duplicate detection but do not replace model reconciliation.

### 4. Finding reconciliation

When multiple shards overlap, a bounded finding reconciler receives exact shard review hashes and produces:

- canonical finding IDs;
- duplicate/supersession lineage;
- conflicting recommendations;
- one proposed repair action per coherent problem;
- non-actionable warnings;
- unresolved ambiguity requiring parent policy.

It cannot mutate canonical artifacts.

### 5. Parent policy decision

Add a typed parent-only tool such as `mem_import_review_policy_submit`:

```ts
type ReviewPolicyDecision = {
  version: 1;
  kind: "mem-import-review-policy";
  reviewCheckpointId: string;
  reviewedRevision: number;
  decisions: Array<{
    actionId: string;
    disposition:
      | "approve"
      | "defer"
      | "reject"
      | "split"
      | "request-second-opinion";
    rationale: string;
  }>;
  budget: RepairBudget;
  rationale: string;
};
```

The parent may ask the user before submitting policy. The durable decision, not parent prose or `caller_report`, authorizes the next campaign.

### 6. Frozen repair campaign

An approved repair campaign binds:

- checkpoint and policy hashes;
- exact action IDs;
- baseline revision/hash;
- artifact/dependency scope;
- artifact-creation permission;
- transaction and changed-artifact budgets;
- expiration;
- stale canonical dependencies.

Repairer assignments derive scope from this artifact. Repair batches cite exact actions as today, but tools also record action-level changed artifacts and claimed acceptance evidence.

### 7. Verification packet

Verification assignments name the repair campaign and exact action IDs. Tool visibility is derived from:

```text
changed artifacts
+ approved dependency scope
+ action source references
+ directly changed declared links/relationships
```

Packet:

```ts
type VerificationPacket = {
  version: 1;
  kind: "mem-import-repair-verification";
  campaignId: string;
  verifiedRevision: number;
  verifiedContentHash: string;
  actionVerdicts: Array<{
    actionId: string;
    verdict: "satisfied" | "partially-satisfied" | "regressed" | "impossible";
    evidenceRefs: unknown[];
    rationale: string;
  }>;
  criticalRegressions?: Array<{
    id: string;
    summary: string;
    artifactIds: string[];
    evidenceRefs: unknown[];
  }>;
  deferredObservations?: ReviewFindingV2[];
  readSet: CanonicalReadSet;
};
```

Verification cannot author ordinary new repair actions. A critical regression may block or consume one explicit emergency budget; unrelated observations enter quality debt.

### 8. Quality-debt record

Maintain stable findings across compendium work:

```ts
type QualityFindingRecord = {
  version: 1;
  findingId: string;
  fingerprint: string;
  status: "open" | "approved" | "deferred" | "resolved" | "rejected" | "superseded";
  severity: "warning" | "repair" | "critical";
  blocking: boolean;
  firstSeenWorkId: string;
  lastObservedWorkId: string;
  firstSeenRevision: number;
  lastObservedRevision: number;
  artifactIds: string[];
  sourceRefs: unknown[];
  actionIds: string[];
  supersededBy?: string;
  resolutionTransactionIds?: string[];
};
```

New work may add evidence or reopen only through explicit regression/new-evidence lineage.

## Convergence controls

### Review modes

- `initial-shard`: may create findings/actions inside shard scope;
- `second-opinion`: may agree, disagree, or refine specified findings only;
- `verification`: may judge approved action satisfaction only;
- `broad-audit`: may create quality debt but not trigger automatic repair.

### Monotonic action state

```text
proposed
  -> approved -> assigned -> applied -> satisfied
                                  |-> partially-satisfied
                                  |-> impossible
  -> deferred
  -> rejected
  -> superseded
```

A satisfied action cannot reopen under a new ID unless a later canonical transaction or new source unit is cited as the regression/new-evidence cause.

### Budgets

Persist at phase start. Illustrative defaults, to be calibrated by evaluation:

```ts
type ReviewBudget = {
  maxShards: number;
  maxArtifactsPerShard: number;
  maxSourceUnitsPerShard: number;
  maxReviewerAssignments: number;
  maxElapsedMinutes: number;
};

type RepairBudget = {
  maxRepairEpisodes: number;
  maxRepairTransactions: number;
  maxChangedArtifacts: number;
  maxCreatedArtifacts: number;
  maxVerificationRounds: number;
  maxEmergencyRepairs: number;
  maxElapsedMinutes: number;
};
```

Suggested ingest posture:

- one initial impact review campaign;
- one parent-approved repair episode;
- one scoped verification round;
- at most one small emergency regression repair;
- optional findings deferred.

Broad audits may have more shards but still do not auto-repair.

### Progress invariant

Every repair/verification transition must reduce or terminally classify unresolved approved actions. If it does not:

- stop with `non-convergent-review`, or
- return to the parent checkpoint for explicit defer/fail policy.

Do not generate a fresh full review automatically.

### Terminal statuses

Support explicit outcomes:

- `finalized`
- `finalized-with-deferred-findings`
- `blocked-by-critical-finding`
- `non-convergent-review`
- `provider-recovery-exhausted`
- existing operational failure statuses.

Deferred findings remain visible in the compendium/run projection.

## Parent-visible phase workflow

### Ingest iteration

1. Parent begins one standalone or compendium work run.
2. Fresh extraction coordinator completes missing units.
3. Fresh proposal/reconciliation coordinator plans identity/coherent candidate clusters and proposals.
4. Fresh merge coordinator consumes proposals.
5. Fresh review coordinator creates impact plan, dispatches shard reviewers, reconciles findings, and exits at immutable review checkpoint.
6. Parent inspects typed checkpoint and persists policy.
7. If actions approved, fresh repair coordinator executes exactly one campaign and exits.
8. Fresh verification coordinator verifies exact actions and exits.
9. Parent resolves any allowed emergency/defer policy.
10. Fresh finalization coordinator runs checks and finalizes without semantic workers.

### Broad audit iteration

1. Parent begins an audit work item against the maintained compendium revision.
2. Audit planner creates bounded overlapping semantic shards.
3. Review coordinators run shard waves.
4. Finding reconciler creates a consolidated quality-debt checkpoint.
5. Parent closes the audit with defer/approve priorities.
6. Repair campaigns occur as separate future work items.

No broad audit is required to mutate canon before it can complete.

## `caller_report` integration

The companion Herdr plan adds non-authoritative reporting. When available:

### Coordinator reports

Useful passive reports:

- impact plan persisted, shard count and budget;
- review wave X/Y launched or complete;
- finding counts by severity;
- repair transaction and changed-artifact budget;
- provider retry warning;
- checkpoint ready for parent inspection.

Attention report examples:

- critical finding outside planned scope;
- repair campaign likely exceeds budget;
- progress invariant not improving;
- provider failures threaten the phase.

### Authority boundary

A report may reference:

- run ID;
- task ID;
- checkpoint ID;
- plan/shard/action ID;
- canonical revision.

It cannot:

- approve repair;
- expand assignment scope;
- change budgets;
- resolve identity;
- authorize mutation;
- replace durable review/policy/verification artifacts.

### Planned checkpoints still complete normally

Do not use live reporting to keep a monolithic coordinator alive. Review, repair, verification, and finalization remain fresh parent-launched contexts.

## Implementation stages

### Stage 0 — Characterize and preserve current behavior

Files likely include:

- `skills/mem-import/SKILL.md` and references;
- `.pi/agents/mem-import-*.md`;
- `src/mem-import/service.ts`;
- `src/mem-import/u2-service.ts`;
- `extensions/mem-import-tools.ts`;
- focused tests and fixtures.

Work:

1. Add a deterministic fixture reproducing review -> repair -> stale review accounting without model calls.
2. Preserve historical v1 review and repair record parsing.
3. Record the Alice non-convergence incident as evaluation evidence, not a golden semantic result.
4. Add metrics for review assignments, repair episodes, transactions, stale reviews, read counts, and elapsed usage.
5. Characterize current finalization gates and exact profile tool lists.

Exit: baseline tests green; no workflow behavior changed.

### Stage 1 — Split coordinator roles

1. Replace `mem-import-coordinator-finalize` with review, repair, verify, and finalization profiles.
2. Update allowed-child-agent restrictions so each coordinator can launch only its own worker role.
3. Make review coordinator read-only and terminal after one checkpoint.
4. Make repair coordinator require exact checkpoint/action IDs and terminal after one campaign.
5. Make verification coordinator read-only and terminal after one packet.
6. Make finalization coordinator launch no semantic workers.
7. Update parent skill to return control between phases and record every coordinator session.
8. Keep existing schemas where possible for the first split, but prohibit internal loops in profile tests.

Exit: a tiny import completes through fresh split phases; no coordinator can dispatch both reviewer and repairer.

### Stage 2 — Review v2, policy, and convergence state

1. Add review modes and v2 packet union.
2. Add finding/action acceptance criteria and fingerprints.
3. Add parent policy artifact/tool.
4. Add repair campaign artifact and budgets.
5. Add verification packet/tool.
6. Add compact `mem_import_quality_state` exposing allowed next transition, budgets, action statuses, and finalization readiness.
7. Permit deferred non-blocking findings at finalization.
8. Add non-convergence and critical-block terminal outcomes.

Exit: verification cannot create ordinary new repair actions; action set and budgets freeze.

### Stage 3 — Canonical delta and ingest impact shards

1. Add deterministic canonical change-set projection.
2. Add model-authored impact plan submission bound to revision/hash/change-set hash.
3. Add exact shard-scoped reviewer assignments.
4. Bound worker inventories/reads to assigned shard and dependencies.
5. Validate changed-artifact coverage/exclusion rationale without choosing semantic membership.
6. Add overlap declarations and duplicate candidate/finding accounting.
7. Add one finding reconciliation packet over bounded shard review sets.

Exit: chapter-scale update reviews changed semantic surfaces without full-canon scans.

### Stage 4 — Quality debt and maintained compendium work

1. Add durable finding records and status lineage.
2. Connect new work deltas to relevant open findings.
3. Prevent semantically restated findings from losing prior disposition history.
4. Expose backlog summaries by severity, age, identity, work, and shard.
5. Add parent policies for auto-defer enrichment and block critical findings.
6. Project visible quality debt into run/compendium audit Markdown without overwhelming readers.

Exit: deferred findings survive and evolve across chapter/book imports.

### Stage 5 — Broad audit campaigns

1. Add explicit audit work type or equivalent compendium work mode.
2. Add broad semantic shard planning with adaptive hierarchy.
3. Add bounded review waves and finding reconciliation.
4. Complete audits without requiring immediate canonical mutation.
5. Add policy triggers based on work count, artifact growth, hotspot identity changes, or debt thresholds.
6. Keep repair campaigns separate and parent-approved.

Exit: whole-book/series audit can finish with a prioritized backlog and no hidden repair loop.

### Stage 6 — Live transparency

After the companion Herdr implementation is proven:

1. Add `caller_report` to documented lifecycle auxiliary tools.
2. Update dispatch/profile evidence tests without adding it to semantic tool arrays.
3. Add coordinator guidance for bounded progress and attention reports.
4. Ensure no report content is persisted as import authority.
5. Add a focused parent stop-after-wave acceptance test.

Exit: parent observes progress and can intervene without undermining ledger authority.

### Stage 7 — Evaluation and tuning

1. Re-run tiny fixture for lifecycle and convergence.
2. Run three-chapter Alice from a clean maintained compendium root.
3. Add one chapter as a second compendium work item and inspect impact-shard behavior.
4. Run a bounded broad audit without repair.
5. Compare reviewer reads, model context, cost, elapsed time, revisions, and quality findings against the stress run.
6. Tune prompts, shard bounds, and budgets only from recorded evidence.

Do not run a whole series until these gates pass.

## Tool/API change sketch

Coordinator-side tools likely needed:

- `mem_import_review_change_set`
- `mem_import_review_plan_submit`
- `mem_import_review_plan_status`
- `mem_import_review_checkpoint_state`
- `mem_import_review_policy_submit`
- `mem_import_repair_campaign_state`
- `mem_import_quality_state`

Worker assignment extensions:

```ts
role: "reviewer"
reviewMode: "initial-shard" | "second-opinion" | "verification" | "broad-audit"
reviewPlanHash?: string
shardId?: string
repairCampaignId?: string
actionIds?: string[]
```

Prefer scope derivation from immutable plan/campaign artifacts. Do not pass model-reconstructed artifact allowlists when the service can derive them.

Existing repair tools can evolve through versioned schemas rather than replacement if they can record:

- campaign binding;
- action-level operations;
- changed artifact IDs;
- artifact creation accounting;
- budget consumption;
- claimed acceptance evidence.

## Prompt changes

### Initial shard reviewer

Emphasize:

- material accuracy, continuity, retrieval, and provenance;
- inspect only assigned semantic concern;
- distinguish blocking defect from useful enrichment;
- useful traversal, not exhaustive reciprocal closure;
- explicit acceptance criteria for every proposed repair;
- prior quality debt and completed actions must be acknowledged.

### Finding reconciler

Emphasize:

- deduplicate semantically equivalent findings;
- preserve disagreement rather than forcing false consensus;
- avoid multiplying action IDs;
- classify enrichment separately;
- no canonical mutation.

### Repairer

Emphasize:

- exact approved actions only;
- no opportunistic cleanup;
- do not create artifacts unless allowed;
- stop when criteria are satisfied or impossible;
- report scoped inability instead of widening scope.

### Verification reviewer

Emphasize:

- judge exact criteria;
- do not restart broad review;
- unrelated improvements become deferred observations;
- only concrete critical regressions may block.

### Finalizer

Emphasize:

- no semantic workers;
- follow typed readiness state;
- finalize with deferred non-blocking debt when policy allows;
- never reinterpret review prose.

## Tests

### State and schema

- v1 review/repair records remain readable;
- v2 mode-specific packets reject mixed fields;
- stale revision/hash/change-set fails;
- policy can reference only checkpoint actions;
- campaign scope derives exactly from approved actions;
- budgets cannot increase after campaign start;
- verification cannot author ordinary repair actions;
- satisfied actions cannot reopen without regression/new-evidence lineage;
- deferred findings remain visible but do not block allowed finalization.

### Shards

- sparse chapter can produce one bounded shard;
- dense chapter can split across several coherent shards;
- recurring identity shard spans old and new units;
- overlaps are declared and bounded;
- material changed artifact is reviewed or explicitly excluded;
- out-of-shard reads fail;
- broad audit supports hierarchical shards;
- deterministic code never infers semantic membership.

### Coordinator profiles

- review coordinator cannot assign repairer;
- repair coordinator cannot assign reviewer;
- verification coordinator cannot mutate canon;
- finalizer has no worker assignment tools;
- no coordinator loops internally;
- parent must persist policy before repair assignment;
- exact named profiles and lifecycle telemetry remain required.

### Convergence

- one review, one repair, one verification can finalize;
- partial verification consumes only allowed retry budget;
- no-progress cycle terminates non-convergent;
- critical regression blocks or consumes one emergency budget;
- enrichment becomes debt rather than another repair loop;
- provider retries are distinct from semantic repair budgets.

### Maintained compendium

- second chapter/book work derives delta against existing canon;
- prior findings touched by new evidence are surfaced;
- untouched debt remains stable;
- duplicate source decisions remain correct;
- root-level projection updates without deleting unknown files;
- broad audit can complete without mutation.

## Evaluation metrics

Track per work item and quality campaign:

- source units and candidates;
- created/updated artifacts;
- shard count and overlap;
- reviewer/repairer assignments;
- artifact/source reads;
- findings by severity and disposition;
- duplicate/superseded findings;
- repair episodes, transactions, and changed artifacts;
- stale/current verification count;
- provider retries/failures;
- elapsed time;
- input/output/cache/reasoning tokens and cost;
- deferred debt created/resolved;
- critical defects caught in later broad audit.

Success is not merely lower cost. The iterative design must preserve or improve important identity continuity, provenance, conflict handling, and retrieval quality.

## Migration

1. Version review and quality records; do not rewrite historical artifacts.
2. Existing active v1 review-finalization runs may finish with pinned old code or be terminally failed/recovered into an explicitly supported boundary. Do not mix v1 loops with v2 campaigns silently.
3. Keep historical effect, review, and transaction inventories readable.
4. Render new named profiles from one source and update checked-in profile tests.
5. Update `skills/mem-import/SKILL.md`, parent preflight, workflow reference, role references, adapter guidance, and smoke tests together.
6. Update final run schema projection with quality checkpoint, policy, campaign, verification, and debt summaries.
7. Do not claim current broad-review compatibility until a bounded audit evaluation passes.

## Risks

| Risk | Mitigation |
|---|---|
| Delta review misses slow cross-series drift | Periodic broad audits and hotspot triggers. |
| Shards fragment one identity | Identity-aware cross-unit shards and bounded synthesis/reconciliation. |
| Overlapping reviewers duplicate actions | Dedicated finding reconciliation and stable fingerprints. |
| Parent defers too much and quality degrades | Strict per-ingest correctness gate and visible debt thresholds. |
| Fixed budgets stop a justified repair | Parent can begin a new explicit campaign; no hidden automatic extension. |
| Verification ignores a critical regression | Narrow critical-regression escape hatch with evidence and emergency budget. |
| Deterministic code begins choosing semantic meaning | Tools validate references, bounds, accounting, and state only. |
| More phases increase orchestration overhead | Fresh contexts remain small; parent can auto-approve policy under configured rules later. |
| Broad audit still becomes monolithic | Hierarchical semantic shards and bounded finding reconciliation. |
| Reports become authority | `caller_report` remains non-authoritative and references durable IDs only. |
| Finding fingerprints collapse distinct issues | Use fingerprints as duplicate candidates; model reconciler owns semantic equivalence. |

## Non-goals

- No claim that chapter-local review alone guarantees series quality.
- No deterministic entity, relationship, retcon, or shard inference.
- No requirement to repair all enrichment findings per ingest.
- No unrestricted full-canon reviewer after every mutation.
- No hidden review/repair recursion inside one coordinator.
- No peer-to-peer semantic worker negotiation outside durable findings.
- No parent-authored artifact mutation as a substitute for assigned workers.
- No removal of provenance, identity, accounting, conflict, or dispatch gates.
- No whole-series scale run before chapter/book incremental evaluations pass.

## Acceptance gates

### Agent refactor

- [ ] Review, repair, verification, and finalization use separate fresh coordinators.
- [ ] Parent regains control after every immutable checkpoint.
- [ ] Each coordinator has one bounded role and exact child profile set.
- [ ] Finalization launches no semantic worker.

### Convergence

- [ ] Initial review and verification are different enforced modes.
- [ ] Parent policy freezes approved action set and budget.
- [ ] Repair cannot widen scope or create artifacts without permission.
- [ ] Verification cannot open unrelated repair actions.
- [ ] No-progress and budget exhaustion have explicit terminal outcomes.
- [ ] Deferred non-blocking findings can coexist with successful finalization.

### Semantic shards

- [ ] Chapter-level work creates adaptive source-local and cross-chapter impact shards.
- [ ] Shards may overlap but are bounded and reconciled.
- [ ] Recurring identities can span works without forcing full-canon review.
- [ ] Broad audit supports hierarchical book/series shards.
- [ ] Out-of-scope worker reads fail closed.

### Iteration

- [ ] New compendium work updates existing artifacts against prior canon.
- [ ] Quality debt persists across work items.
- [ ] New evidence can explicitly reopen or supersede prior findings.
- [ ] Broad audit completes independently of repair campaigns.

### Evidence

- [ ] Tiny import passes split workflow.
- [ ] Three-chapter Alice completes within configured review/repair budgets or terminates explicitly without looping.
- [ ] A subsequent chapter update reviews only its semantic impact plus declared dependencies.
- [ ] A bounded broad audit produces a reconciled backlog without automatic repair.
- [ ] Usage, read, revision, finding, and debt metrics are available for comparison.

## Recommended first implementation slice

Implement Stages 0–2 before semantic sharding:

1. split the monolithic coordinator;
2. add initial versus verification modes;
3. add parent policy and frozen repair campaign;
4. enforce one repair episode and one verification round;
5. permit deferred warnings;
6. add explicit non-convergence status.

Then rerun the tiny and three-chapter fixtures. Only after the loop is structurally impossible should the implementation add adaptive impact shards and broad-audit machinery.
