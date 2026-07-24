# Mem-import profile launch stabilization

**Date:** 2026-07-23  
**Status:** implementation-ready precursor  
**Scope:** generic `pi-herdr-subagents` launch reliability plus mem-import role prompt/profile stabilization  
**Closure decision:** defer `2026-07-23-mem-import-assignment-scoped-tool-closures-plan.md` until this plan's acceptance evidence is reviewed

## Decision

Stabilize named-profile execution before changing mem-import's worker authorization protocol.

The immediate architecture is:

```text
service-owned role -> exact named profile
  + generated role-specific profile body
  + parent-profile child allowlist
  + fail-closed named-agent resolution
  + exact host tool telemetry
  + durable dispatch/effect gates
= reliable bounded semantic launch
```

This is a reliability precursor, not a replacement authorization design. Continue using grant-v1 assignments during this work. Do not introduce cwd-bound worker closures, assignment workspaces, semantic-only closure schemas, authorized-launch handles, or mem-import policy inside either generic subagent executor.

After focused negative tests and one complete tiny import, reassess whether the remaining security goals justify the deferred closure plan or a smaller grant-hardening plan.

## Why this precedes closure work

The named-profile import failures were caused by profile selection and lifecycle affordances before they were caused by model capability or context size.

Observed behavior:

- an extraction coordinator passed `agent: "tiny-extraction"`;
- a proposal coordinator passed `agent: "proposer"` for initial workers and later `agent: "worker"` for a retry;
- a finalization coordinator passed `agent: "reviewer"` while using a display name beginning with `mem-import-reviewer`;
- exact `mem-import-extractor`, `mem-import-proposer`, and `mem-import-merger` launches worked when their complete keys were placed explicitly in the immediate task;
- unknown explicit agent keys silently fell through to bare unrestricted launches because `loadAgentDefaults()` returned `null` and launch continued without profile tools;
- the valid package-bundled `reviewer` profile exposed `read` and `bash`, so it was a plausible but incorrect match for assignment role `reviewer`;
- proposal coordinators called `subagent_done` while saying they were waiting for descendants, requiring repeated resumes;
- proposal effects could persist without completed exact-profile dispatch receipts and still contribute to merge readiness;
- the shared `/skill:mem-import` message arrived after critical first-turn launch decisions, and autonomous workers often completed before it arrived at all.

The first-request sizes were modest (roughly 4.2–4.7k input tokens for observed workers and 7.9–8.2k for observed coordinators). The primary prompt problem was ordering and missing exact mapping, not context-window pressure.

## Goals

1. An explicit unknown `agent` key never creates a pane or bare child.
2. A named parent profile can declare the exact named child profiles it may launch.
3. A mem-import coordinator cannot launch package-bundled `reviewer`, `worker`, or another unrelated profile.
4. Every assignment result identifies its exact service-derived mem-import worker profile.
5. Coordinator and worker role instructions are present before the first model decision.
6. Child profiles no longer invoke the monolithic `mem-import` skill.
7. Static role guidance is concise, generated, and tested from one maintained source.
8. Coordinator completion cannot silently abandon active descendants.
9. Proposal/merge readiness excludes semantic effects without valid completed dispatch evidence.
10. One tiny four-phase import finalizes successfully using exact named profiles, or fails at a precise newly identified gate without contaminating later phases.
11. The result produces enough evidence to choose between resuming cwd closures and retaining a simpler grant-based design.

## Non-goals

- Do not implement assignment-scoped cwd closures.
- Do not remove worker grants or authority fields from schemas.
- Do not add authorized-launch handles, launch tokens, or mem-import-specific executor APIs.
- Do not prevent all generic bare subagent launches globally.
- Do not add OS sandboxing or same-user filesystem defenses.
- Do not run Alice or another book-sized import.
- Do not combine commits across the `pi-herdr-subagents` and `memchat` repositories.
- Do not rely on a stronger model or higher thinking level as the correctness fix.

## Repository boundaries

### Generic executor

Repository:

```text
/home/squiddity/projects/pi-herdr-subagents
```

Starting revision observed during planning:

```text
a1d9512 feat: preserve verified subagent profiles on resume
```

Keep changes generic. The extension may understand named profiles, child-profile policies, active descendants, and host telemetry. It must not read mem-import assignments or validate mem-import grants.

### Application

Repository:

```text
/home/squiddity/projects/memchat
```

The working tree already contains uncommitted named-profile experiment files and related acceptance changes. Review and preserve that work before editing. Do not reset or overwrite unrelated modifications.

Mem-import owns role-to-profile mapping, static role guidance, assignment output, dispatch/effect readiness, and acceptance fixtures.

## Part A — Generic `pi-herdr-subagents` stabilization

### A1. Fail closed for unresolved explicit agent names

Current behavior in `pi-extension/subagents/index.ts` treats both of these as `agentDefs === null`:

```text
agent omitted intentionally
agent supplied but not found
```

Separate the cases before any pane, sidecar, session file, or launch script is created.

Rules:

- omitted `agent` preserves the existing deliberate bare-spawn behavior;
- supplied and unresolved `agent` throws a stable error naming the unresolved key;
- project/global/package precedence remains unchanged;
- hidden/directly invokable profiles retain their documented behavior unless excluded by an active parent child-policy;
- `/subagent` and the model tool use the same resolution failure semantics.

Add a regression proving `agent: "proposer"` cannot become an unrestricted child.

### A2. Add profile-scoped child allowlists

Add one generic frontmatter field:

```yaml
allowed-child-agents: agent-a, agent-b
```

Semantics:

- omitted: preserve current unrestricted named/bare child selection subject to existing spawning policy;
- present and non-empty: every descendant `subagent` call must supply `agent`, and it must be an exact member;
- present and empty: deny child launches (equivalent in intent to `spawning: false`);
- matching is exact and case-sensitive after whitespace normalization;
- display `name` never participates;
- allowed targets must still resolve normally;
- target profile precedence remains project > global > package;
- `tools`, `skills`, or a display name cannot substitute for an allowed profile key.

Resolve this policy when launching the parent profile and preserve it in the host-attested launch profile so resume cannot broaden it. Add it to the sidecar parser, signature input, resume reconstruction, sanitized telemetry, and tests. Do not trust model-authored claims about the active parent profile.

For mem-import, expected coordinator policy is:

| Coordinator profile | Allowed child profiles |
|---|---|
| `mem-import-coordinator-extraction` | `mem-import-extractor` |
| `mem-import-coordinator-proposal` | `mem-import-proposer`, `mem-import-reconciler` |
| `mem-import-coordinator-merge` | `mem-import-merger` |
| `mem-import-coordinator-finalize` | `mem-import-reviewer`, `mem-import-repairer` |

A project-level option to hide package-bundled agents may be useful later for catalog hygiene, but it is not required for enforcement and is not part of this plan. `disable-model-invocation` must not be reinterpreted silently; its current listing-only behavior is documented and tested.

### A3. Clarify the subagent schema

Remove generic examples such as `worker`, `scout`, and `reviewer` from the model-visible `agent` field description. Replace them with guidance that:

- `agent` is an exact named-profile key;
- `name` is display-only;
- callers must copy an explicitly supplied profile key rather than infer it from a semantic role;
- supplied unknown keys fail before launch.

Keep the description generic and concise. Do not inject a complete agent catalog into the tool schema.

### A4. Prevent premature recursive completion

A non-auto-exit orchestrator must not successfully call `subagent_done` while it still owns tracked descendants that have not delivered a terminal result.

Implement a generic guard using the extension's host-owned descendant registry or equivalent lifecycle state. Requirements:

- normal completion succeeds when no tracked descendant remains in flight;
- active, starting, waiting-for-terminal-delivery, interrupted, blocked, or stalled descendants prevent ordinary completion while still tracked;
- the result names only sanitized child IDs/display names and states;
- a deliberate abort path must not strand a failed orchestrator forever;
- any force/abort mechanism must be explicit, auditable, and tested, not inferred from prose;
- terminal descendant delivery followed by coordinator completion remains push-driven and requires no polling.

Choose the smallest generic design after inspecting how `subagent-done.ts` can read the shared runtime. If a safe force path would materially expand scope, first implement rejection plus a documented coordinator cleanup sequence and cover stalled-child behavior in tests.

### A5. Correct or explicitly deprecate late skill delivery

Characterize the existing `buildPiPromptArgs()` behavior with a real or faithful integration test. A profile-declared skill must not be advertised as first-turn role guidance if `/skill:` expansion is delivered only after the artifact task begins.

Preferred generic outcome:

- profile-declared skills are expanded before the task's first model request;
- their ordering is deterministic for standalone, lineage-only, and fork launches;
- skill content is not duplicated on resume.

Mem-import must not depend on this fix: its child profiles will use generated bodies. If first-turn skill injection cannot be fixed simply and generically, document the limitation and remove claims that profile skills are pre-task instructions. Do not add mem-import-specific skill loading to the executor.

### A6. Generic tests and validation

Add or update tests for:

- omitted agent still permits an intentional bare launch;
- supplied unknown agent fails before pane/session/script creation;
- exact project/global/package precedence;
- parent allowed-child exact match succeeds;
- unrelated bundled profile is denied;
- missing `agent` is denied when an allowlist exists;
- allowlist survives signed profile resume;
- tampered allowlist sidecar fails closed;
- profile telemetry reports the effective child policy without prompts or secrets;
- `subagent_done` refuses while descendants remain tracked;
- completion succeeds after terminal child delivery;
- skill/task first-turn ordering or an explicit documented limitation.

Run:

```bash
npm test
npm run lint
```

Run only the focused Herdr integration tests needed for profile resolution, recursive lifecycle, and first-turn ordering. Use an explicit authenticated test model and the repository's documented timeout. Do not run mem-import semantics from this repository.

## Part B — Mem-import role/profile stabilization

### B1. Establish one service-owned profile map

Add one static application mapping derived from assignment role:

```ts
extractor  -> mem-import-extractor
proposer   -> mem-import-proposer
reconciler -> mem-import-reconciler
merger     -> mem-import-merger
reviewer   -> mem-import-reviewer
repairer   -> mem-import-repairer
```

Requirements:

- assignment creation and assignment briefs return the exact profile key;
- coordinators copy the returned profile; they never derive it from `role`;
- audit/profile fields use the service-derived key rather than model-authored shorthand;
- tests fail if a role/profile pair drifts;
- both named-profile adapter renderings use the same mapping;
- no profile key contains run, assignment, source, or credential data.

This is compatible with the deferred closure plan's future credential-free launch descriptor.

### B2. Replace child skill invocation with generated profile bodies

Remove `skills: mem-import` from all `pi-herdr-subagents` mem-import coordinator and worker profiles.

Maintain role guidance as source files under the mem-import skill, but generate concise profile bodies from those sources. Do not maintain ten unrelated hand-written copies.

Recommended source layout:

```text
skills/mem-import/
  SKILL.md                         # parent router only
  references/
    parent-preflight.md
    phases/
      extraction.md
      proposal-reconciliation.md
      merge.md
      review-finalization.md
    roles/
      extractor.md
      proposer.md
      reconciler.md
      merger.md
      reviewer.md
      repairer.md
    shared-ledger-contract.md
```

Exact filenames may follow existing conventions; preserving links is more important than renaming everything immediately.

Generated coordinator bodies contain only:

- exact phase identity and prohibition on other phases;
- typed startup and exit gates for that phase;
- exact allowed child profile keys;
- assignment/dispatch/effect sequence;
- push-wait and completion behavior;
- retry rules material to that phase;
- concise failure rule.

Generated worker bodies contain only:

- exact assignment role;
- bounded read/write procedure;
- role-specific semantic quality requirements;
- submit/done contract;
- stop conditions.

Do not include parent acceptance, other phases, other worker roles, facility selection, Alice guidance, or closure design in worker bodies.

Use `system-prompt: replace` only when the generated body is non-empty and tests prove the intended first-request prompt. Keep profile bodies credential-free and static.

### B3. Slim the parent skill and launch envelope

Keep `skills/mem-import/SKILL.md` as the user-facing entry point. It should route the parent to preflight/begin/four phases and route explicit phase coordinators to their phase source, without embedding every role procedure.

Parent-to-coordinator tasks should contain only dynamic run data and a short phase command:

```text
phase
outputRoot
runId
requested scope
input only for extraction when needed
transient coordinator authority
```

Do not repeat adapter manuals, exact worker role procedures, complete done criteria, or earlier coordinator prose in every task. Static instructions belong in generated profile bodies.

### B4. Make dispatch evidence part of effective readiness

The tiny run demonstrated that proposal effects without completed exact-profile dispatch receipts could still contribute to a ready plan and be merged.

Tighten deterministic gates so that:

- an extraction packet is phase-complete only with its required completed exact dispatch;
- a planned cluster is effective only when its proposal effect has a completed exact dispatch;
- a reconciliation set is effective only when its identity effect has a completed exact dispatch;
- `readyForMerge` excludes effects without valid dispatch evidence;
- merger assignment and every planned merge write recheck this gate;
- reviewer validity/finalization continue to require exact dispatch;
- a revoked assignment with an effect cannot be treated as a clean retry or silently accepted;
- status/effect inventory exposes the blocking reason without loading worker prose.

Keep the current grant-v1 authorization protocol. Do not implement stable effect slots or cwd binding in this phase unless a minimal correctness change is strictly necessary to prevent overwrite; record remaining duplicate/effect concerns for the post-acceptance decision.

### B5. Update named-profile generation and tests

Update:

```text
src/mem-import/named-profiles.ts
src/mem-import-named-profiles.test.ts
.pi/agents/mem-import-*.md
fixtures/mem-import/named-profiles/
skills/mem-import/references/adapters/pi-herdr-subagents.md
```

Tests must prove:

- all ten names remain stable;
- workers still exactly match `MEM_IMPORT_ROLE_TOOLS`;
- coordinators retain phase-specific tools only;
- coordinator `allowed-child-agents` exactly matches the service-owned map;
- workers cannot spawn;
- child profiles contain no `skills: mem-import`;
- every profile has a non-empty generated role body;
- generated bodies contain their own role/phase and exclude unrelated roles/phases;
- profile bodies and assignment results contain no grants, run IDs, source payloads, or credentials;
- adapter fixtures remain deterministic;
- the generic bundled names `reviewer`, `worker`, and `scout` do not appear as launch instructions in mem-import coordinator bodies.

For the alternate `pi-subagents` rendering, preserve its exact tool behavior. Share role-body sources where formats permit, but do not weaken one adapter to force identical frontmatter.

## Part C — Focused acceptance

### C1. Model-free checks

Before any semantic launch:

1. build the project;
2. run mem-import tests;
3. verify generated profiles and fixtures are clean;
4. verify the selected `pi-herdr-subagents` source revision contains the generic fail-closed and child-allowlist behavior;
5. inspect tool/profile catalogs without creating a run.

Commands:

```bash
npm run build
npm run test:mem-import
git diff --check
```

### C2. Negative launcher tests

Use disposable contexts, not a real corpus run, to prove:

- `agent: "proposer"` is rejected as unresolved;
- `agent: "reviewer"` is rejected by the finalize coordinator's child allowlist even though the bundled profile exists;
- omitted `agent` is rejected inside a mem-import coordinator with a child allowlist;
- `agent: "mem-import-reviewer"` resolves with the exact expected semantic tools;
- a coordinator cannot call `subagent_done` while its worker remains tracked.

No semantic write is required for these negative cases.

### C3. Extraction-only live test

Run one fresh tiny extraction:

- one normalized unit;
- one exact `mem-import-extractor` launch copied from assignment `profile`;
- one completed exact dispatch;
- one extraction effect;
- no helper or alternate profile;
- coordinator remains alive until child completion, verifies typed exit state, then completes.

Fail the run durably on any mismatch. Do not repair the adapter during the run.

### C4. Tiny four-phase import

Only after C1–C3 are green, run the existing tiny Glass Tower input through four fresh coordinators.

Acceptance requires:

- every coordinator's host profile is exact;
- every worker profile key equals the service-derived assignment profile;
- every effect has a completed exact dispatch before dependent work;
- no revoked/no-dispatch proposal contributes to merge readiness;
- no premature coordinator completion/resume is needed in the ordinary path;
- all candidates are proposed and canonically accounted once;
- no blocking conflict remains;
- one current review covers the final revision;
- deterministic checks have no errors;
- final work status is durably finalized.

Stop after the tiny import. Do not run Alice.

## Part D — Post-acceptance authorization decision

Write a short evidence note after C4. It must distinguish reliability from authorization and answer:

1. Can a correctly named but duplicate process still reuse a visible grant?
2. Can a correct profile from an unrelated cwd use copied assignment authority?
3. Can conflicting singleton effects overwrite or race?
4. Are raw worker authority fields still considered an unacceptable model-visible boundary?
5. Do dispatch and effect records establish enough binding for the project's threat model?

Then choose one follow-up explicitly:

### Resume the deferred closure plan

Choose this if cwd/session binding, raw-grant removal, duplicate-process containment, stable singleton effects, or binding-aware finalization remain requirements. Update the closure plan with evidence from this precursor; do not duplicate the generic profile work.

### Author a smaller grant-hardening plan

Choose this only if model-visible grants and lack of cwd binding are accepted. Such a plan must still cover active-tool equivalence, stable effects, duplicate races, and dispatch/effect readiness. Do not quietly claim it provides closure-equivalent authorization.

### Stop after stabilization

Choose this only if the remaining risks are explicitly accepted and documented. A successful tiny import alone is not evidence that replay or duplicate-process threats are solved.

## Implementation order and commits

Keep repository history reviewable:

1. In `memchat`, review and commit the existing named-profile experiment independently if it is still uncommitted and green.
2. In `pi-herdr-subagents`, commit fail-closed named-agent resolution.
3. In `pi-herdr-subagents`, commit child allowlists/profile preservation and lifecycle guard; keep skill-order correction separate if substantial.
4. In `memchat`, commit service-owned profile mapping and generated role bodies.
5. In `memchat`, commit dispatch-gated readiness.
6. Commit focused acceptance fixtures/docs separately from implementation.

Do not create cross-repository commits or vendor one repository into the other.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Child allowlists become application-specific | Keep field generic and profile-authored; no mem-import assignment parsing in executor. |
| Profile body guidance drifts from references | Generate from one source and snapshot-test renderings. |
| Empty/replace system prompt removes useful defaults | Test first-request behavior and include only required role invariants explicitly. |
| Skill ordering fix expands generic scope | Mem-import removes child skill dependency; document/defer generic fix if not small. |
| Premature-done guard strands failed coordinators | Define and test one explicit audited abort/cleanup path. |
| Hiding bundled agents breaks normal workflows | Do not require project-wide hiding; enforce parent child allowlists instead. |
| Dispatch-gated readiness makes existing dirty runs unmergeable | Treat them as invalid historical diagnostics; do not rewrite effects or fabricate receipts. |
| Reliability success is mistaken for authorization success | Require the Part D threat-model decision before resuming larger imports. |
| Existing uncommitted experiment work is overwritten | Review status/diff first and commit baseline separately. |

## Done criteria

- [ ] Supplied unknown agent keys fail before launch.
- [ ] Intentional bare launches still work when no parent child policy forbids them.
- [ ] Parent profile child allowlists are host-resolved, attested, resume-preserved, and enforced.
- [ ] Bundled `reviewer` cannot be launched by a mem-import finalize coordinator.
- [ ] `subagent_done` cannot ordinarily abandon tracked descendants.
- [ ] Mem-import assignments return exact service-derived profile keys.
- [ ] Child mem-import profiles no longer invoke the monolithic skill.
- [ ] All ten profiles have concise generated role/phase bodies.
- [ ] Coordinator bodies name only their exact allowed worker profiles.
- [ ] Workers receive only role-specific static guidance plus bounded assignment context.
- [ ] Proposal/reconciliation/merge readiness requires completed exact dispatch evidence.
- [ ] Generic and mem-import deterministic tests pass.
- [ ] Focused Herdr profile/lifecycle integration tests pass.
- [ ] One exact-profile extraction-only run passes.
- [ ] One tiny four-phase import reaches durable finalized status without ordinary-path resume.
- [ ] No Alice or book-sized import runs.
- [ ] A post-acceptance note explicitly chooses closure, grant hardening, or accepted residual risk.

## Fresh-session handoff

Start in:

```text
/home/squiddity/projects/memchat
```

Read, in order:

1. repository `AGENTS.md`;
2. this plan;
3. `docs/plans/2026-07-23-mem-import-assignment-scoped-tool-closures-plan.md` only for deferred-boundary context;
4. `src/mem-import/named-profiles.ts` and its tests;
5. `skills/mem-import/SKILL.md` plus only the relevant phase/role references;
6. `/home/squiddity/projects/pi-herdr-subagents/README.md` and the profile discovery/launch sections of `pi-extension/subagents/index.ts`;
7. both repositories' current status and diffs.

Begin with Part A1 and the existing named-profile baseline review. Do not implement cwd closures in the same session unless Part C has completed and the user explicitly selects that follow-up.
