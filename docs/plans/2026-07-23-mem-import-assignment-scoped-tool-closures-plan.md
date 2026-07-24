# Mem-import assignment-scoped tool closures

**Date:** 2026-07-23  
**Status:** deferred pending profile-launch stabilization and tiny-import evidence  
**Risk:** critical authorization change; comprehensive deterministic and cross-process tests required

> **Deferral (2026-07-23):** Execute [Mem-import profile launch stabilization](2026-07-23-mem-import-profile-launch-stabilization-plan.md) first. The observed failures were dominated by ambiguous profile selection, fail-open unknown profile keys, late child skill delivery, and premature coordinator completion. After its focused acceptance, explicitly choose whether to resume this cwd-closure design or author a smaller grant-hardening plan. Do not begin the implementation phases below merely because this document remains implementation-ready in detail.

## Decision

Replace model-supplied worker authority (`outputRoot`, `runId`, `taskId`, and `grant`) with assignment-scoped tool invokers selected from the worker session's canonical cwd.

The authorization boundary is:

```text
named profile
  -> static role-specific tool allowlist
assignment cwd
  -> selects one durable assignment workspace
mem-import tool closure
  -> binds each operation to that assignment
canonical ledger checks
  -> enforce scope, lifecycle, idempotency, and concurrency
subagent extension
  -> generic process execution only
```

Do not add authorized-launch handles, opaque launch tokens, or mem-import assignment policy to `pi-herdr-subagents` or `pi-subagents`. The executors may resolve a named profile, cwd, extension entry, context, model, and exact tool allowlist; mem-import owns all application authorization.

A generic launcher may still create an irrelevant process. That process has no import authority unless its installed tools resolve a valid live assignment from its canonical cwd. Preventing duplicate process creation is not an authorization requirement in this design.

## Why this is the next step

The named-profile experiment established both sides of the boundary:

- correctly selected profiles enforce their static tool sets;
- an exact `mem-import-extractor` completed a real one-unit assignment with exact dispatch and durable effect evidence;
- generic launching can still create an unassigned child, including a correctly selected exact proposer profile;
- the current worker grant prevents that unassigned child from using mem-import state, but the model must repeatedly carry raw authority fields in every tool call.

The closure design retains tool-level authorization while removing authority-bearing arguments from model-visible schemas. It also keeps the subagent implementations generic, like the legacy host-driven world-import runner.

## Current implementation findings

### Tool extension

`extensions/mem-import-tools.ts` currently:

- constructs one module-level mem-import service graph;
- registers the complete coordinator and worker catalog;
- spreads `outputRoot`, `runId`, `taskId`, and `grant` into every worker schema;
- does not use the tool execution context's `ctx.cwd`;
- can inspect the exact active tool names through `pi.getActiveTools()`.

Pi passes `ctx` as the fifth tool `execute()` argument, and the local SDK supports `pi.getActiveTools()`. A JavaScript closure cannot cross a subprocess boundary, so each child extension instance must reconstruct its immutable binding from canonical cwd and durable state. No module-global mutable `currentAssignment` is allowed because extension/resource-loader instances may be shared in SDK processes.

### Service

`src/mem-import/service.ts` already provides most enforcement needed after binding:

- canonical role allowlists in `MEM_IMPORT_ROLE_TOOLS`;
- role capabilities and unit/candidate/proposal/checkpoint/action scope;
- expiry, revocation, supersession, and retry lineage;
- terminal-state mutation rejection;
- cross-process mutation locks;
- merge fences, read-set CAS, and no-op rejection;
- durable effects and dispatch diagnostics.

The missing pieces are assignment workspace materialization, cwd resolution, closure-bound worker schemas, role/profile/tool equivalence checks, stable one-shot effect slots, and binding-aware dispatch/effect evidence.

### Profiles and adapters

- Named worker profiles already derive exact semantic tools from `MEM_IMPORT_ROLE_TOOLS`.
- Worker spawning and generic filesystem/shell tools are denied.
- Dynamic assignment cwd must be supplied per launch, not pinned in profile frontmatter.
- Herdr can pass an explicit trusted extension and report profile/cwd/tool telemetry.
- The pi-subagents fixture currently uses a repository-relative extension path. That path will not resolve after switching the child cwd to an assignment workspace; closure mode therefore needs a workspace-relative bridge to the trusted extension.

## Requirements

### Assignment and binding

1. Every new semantic assignment materializes exactly one canonical private worker workspace.
2. The assignment record stores canonical workspace cwd and immutable binding metadata.
3. Worker tools derive assignment identity only from canonical `ctx.cwd`.
4. Worker-visible schemas omit `outputRoot`, `runId`, `taskId`, `grant`, and `coordinatorGrant`.
5. Closure-mode assignments contain no worker bearer token or token hash.
6. Every call reopens the run, assignment, workspace marker, lifecycle state, and relevant effect state.
7. Repo cwd, output-root cwd, workspace-parent cwd, copied markers, malformed workspaces, and another role's tool profile fail closed.
8. Revoked, superseded, expired, and terminal assignments cannot perform semantic reads or mutations.
9. Exact lease release is the sole cleanup exception and may release only the lease already owned by that assignment.
10. Tool name, assignment role, expected named profile, expected semantic tools, active semantic tools, tool schema version, and extension protocol must agree.
11. Only an explicit adapter-neutral lifecycle set, initially `caller_ping` and `subagent_done`, may accompany semantic tools.
12. Existing scope checks continue to cover units, candidates, proposals, identities, plans, checkpoints, and actions.

### Duplicate workers and effects

13. Multiple processes in the same legitimate assignment cwd may read the same bounded scope.
14. Duplicate processes gain no additional authority.
15. Singleton outputs use stable effect slots and exact-content idempotency.
16. Extraction is one-shot per assigned unit.
17. Proposal, identity, and review output is one-shot per assignment.
18. Same-content repetition returns the existing receipt; conflicting content fails.
19. Singleton authorization and effect-slot checks occur inside the existing cross-process mutation critical section.
20. Merger and repairer assignments remain bounded multi-transaction roles; existing proposal scope, read sets, fences, revisions, action scope, and no-op checks determine winners.

### Profiles and evidence

21. Worker profiles remain static, credential-free role allowlists.
22. Assignment results return a credential-free launch descriptor containing profile, canonical cwd, extension bridge, task context, model/thinking settings, and exact semantic tools.
23. Neither subagent extension receives or validates a mem-import assignment object, grant, or launch token.
24. Runtime authorization checks the exact active semantic tool set before each operation.
25. Dispatch evidence records host-resolved profile, canonical cwd, extension provenance, model/thinking, active tools, child identity, and outcome.
26. Effects record service-derived binding and tool metadata rather than model-authored claims.
27. Final checks reject effects whose binding, role, tool schema, or completed host profile evidence does not match the assignment.

### Migration and process safety

28. No mutable global assignment selector is permitted.
29. Every invocation routes by its execution context cwd so shared SDK loaders cannot cross-bind sessions.
30. Grant-v1 and closure-v1 assignments cannot mix in one run.
31. Existing v1 records remain readable for status, diagnostics, and historical inspection.
32. The closure worker provider exposes no legacy raw-grant schema.
33. Active v1 runs must finish with a pinned pre-upgrade checkout or restart under a fresh closure-mode run; no silent authority conversion is allowed.

## Target protocol

### Run gate

Extend `MemImportRunRecord`:

```ts
authorizationMode?: "grant-v1" | "cwd-closure-v1";
```

Rules:

- new closure-mode runs write `cwd-closure-v1`;
- absent mode parses as historical `grant-v1`;
- assignment creation verifies the run mode;
- a run cannot contain both assignment protocols;
- read-only status remains available for both modes.

### Assignment v2

Add a versioned union instead of weakening the v1 parser:

```ts
type MemImportAssignmentRecordV2 = {
  version: 2;
  kind: "mem-import-assignment";
  runId: string;
  taskId: string;
  role: AssignmentRole;
  outputRoot: string;

  allowedUnitIds: string[];
  allowedCandidateIds?: string[];
  allowedProposalHashes?: string[];
  allowedIdentityProposalHashes?: string[];
  allowedCheckpointIds?: string[];
  allowedActionIds?: string[];
  planHash?: string;
  clusterId?: string;
  reconciliationSetId?: string;
  capabilities: MemImportCapability[];

  binding: {
    mode: "cwd-closure-v1";
    workspaceCwd: string;
    profile: string;
    semanticTools: string[];
    semanticToolsHash: string;
    toolSchemaVersion: string;
    extensionProtocol: string;
    immutableBindingHash: string;
  };

  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  supersededAt?: string;
  supersededByTaskId?: string;
  supersedesTaskIds?: string[];
  retriesTaskId?: string;
  lifecycleOutcome: LifecycleOutcome;
  audit?: MemImportAssignmentAudit;
};
```

Do not include `tokenHash`. Immutable scope, profile, tools, workspace, issuance, and expiry participate in `immutableBindingHash`; mutable lifecycle projection does not.

### Workspace

```text
<outputRoot>/stages/orchestration/workspaces/<taskId>/
  assignment-binding.json
  assignment-context.md
  .mem-import/
    runtime-extension.ts
```

Properties:

- workspace and internal directories use mode `0700`;
- files use mode `0600` and atomic writes;
- workspaces remain after revoke/expiry for audit and lineage;
- task IDs remain non-reusable;
- `assignment-binding.json` contains non-secret binding identity only;
- `assignment-context.md` contains bounded, credential-free role/scope context;
- `runtime-extension.ts` is a non-secret bridge importing the canonical trusted extension by absolute file URL, solving child-cwd-relative extension loading without executor changes.

The workspace path is a selector, not a secret. Same-user filesystem tampering is outside the application threat model.

### Canonical cwd resolution

A new resolver must:

1. canonicalize `ctx.cwd` with `realpath`;
2. require the exact workspace suffix under the derived output root;
3. derive output root and task ID from the path, without scanning arbitrary runs;
4. read a bounded regular `assignment-binding.json` and reject symlinks, malformed or oversized data;
5. reopen run and assignment records;
6. verify run/task/root, assignment version, canonical path, role, profile, semantic tool hash, schema version, extension protocol, and immutable binding hash;
7. recheck lifecycle and operation-specific scope;
8. return internal bound authority and service-derived diagnostics.

A symlink alias is acceptable only when `realpath` resolves to the exact legitimate workspace. A copied marker elsewhere fails path and assignment-record comparison.

## Tool-provider design

Coordinator tools retain their current coordinator schemas. Worker definitions switch to semantic-only schemas and a common registration helper:

```ts
registerAssignmentTool(pi, {
  name: "mem_source_read_unit",
  role: "extractor",
  capability: "source:read",
  operation: "read",
  parameters: Type.Object({
    unitId: Type.String(),
    startAnchor: Type.Optional(Type.String()),
    endAnchor: Type.Optional(Type.String()),
    continuationCursor: Type.Optional(Type.String()),
    maxChars: Type.Optional(Type.Integer()),
  }),
  execute: ({ authority, params }) =>
    service.readAssignedUnit({ authority, ...params }),
});
```

The wrapper obtains trusted runtime context:

```ts
type BoundWorkerAuthority = {
  canonicalCwd: string;
  toolName: string;
  activeTools: readonly string[];
  extensionProtocol: string;
};
```

`authorizeBoundWorker()` derives run/task/role from cwd. It never accepts those values from the model.

The extension may cache immutable marker metadata keyed by canonical cwd plus binding hash, but every call must reopen lifecycle/effect state and invalidate mismatched markers. It must never store one process-wide `currentAssignment`.

### Active-tool equivalence

Before operation execution:

1. obtain `pi.getActiveTools()`;
2. split semantic mem-import tools, supported lifecycle tools, and unrelated tools;
3. require semantic tools to equal `assignment.binding.semanticTools`;
4. require the invoked tool in that set;
5. reject all unrelated active tools;
6. keep adapter-specific denied-tool telemetry separate from the application decision.

A wrong role profile normally fails by semantic tool mismatch. A same-tools alias may be runtime-equivalent but still fails final dispatch validation unless the host-resolved profile name matches the assignment.

## One-shot and transaction behavior

Introduce stable effect slots:

| Role/operation | Slot |
|---|---|
| Extractor submit | `extraction:<unitId>` |
| Proposer submit | `proposal` |
| Reconciler submit | `identity` |
| Reviewer submit | `review` |
| Merger commit | `merge:<transaction-content-hash>` |
| Repair batch | `repair:<checkpoint/action/request-hash>` |

A closure-mode effect records task, role, slot, tool name, immutable binding hash, semantic tool hash, effect kind/hash, path, and time.

Singleton writes run under `withRunMutation()`:

1. resolve and reauthorize the bound assignment;
2. compute semantic output hash;
3. read the stable slot;
4. return the existing receipt when the hash matches;
5. reject a conflicting existing hash;
6. persist the semantic artifact atomically or content-addressed;
7. persist the effect slot;
8. update lifecycle projection.

Extraction must no longer overwrite an accepted packet from a duplicate process. Exact repeated commits for merger/repairer are idempotent, while different operations continue through existing CAS/fence/scope rules.

## Dispatch and final accounting

Add closure binding fields to dispatch evidence:

```ts
binding: {
  immutableBindingHash: string;
  requestedProfile: string;
  observedProfile: string;
  requestedCwd: string;
  observedCwd: string;
  toolSchemaVersion: string;
  extensionProtocol: string;
  extensionSourceHash?: string;
};
observedAuxiliaryTools?: string[];
```

Validation requires canonical requested/observed cwd, exact role profile, exact semantic tools, allowed lifecycle tools only, matching binding/schema/extension, and sanitized model/thinking. Dispatch records become append-only or immutable-idempotent; a later different receipt cannot overwrite prior evidence.

Effects establish application binding because the service writes them after closure authorization. Dispatch establishes host lifecycle/profile evidence, not OS isolation. Effect inventory, checks, and finalization require matching assignment binding, stable effect slot, exact completed subagent dispatch, and no conflicting effect.

## Implementation phases

### Phase 0 — Stabilize named-profile baseline

Files:

- `src/mem-import/named-profiles.ts`
- `src/mem-import-named-profiles.test.ts`
- `.pi/agents/mem-import-*.md`
- `fixtures/mem-import/named-profiles/pi-subagents/*.md`
- `skills/mem-import/references/adapters/pi-herdr-subagents.md`
- `src/mem-import-acceptance-fixture.test.ts`

Work:

1. Review and commit the existing named-profile experiment independently.
2. Preserve `MEM_IMPORT_ROLE_TOOLS` as the semantic allowlist authority.
3. Characterize exact role tools, no worker spawning/generic tools, no static cwd, and extension loading.
4. Add a characterization for pi-subagents' repository-relative extension behavior under assignment cwd.

Exit: current mem-import tests, build, and diff checks pass before protocol changes.

### Phase 1 — Assignment v2 and workspace materialization

Files:

- `src/mem-import/service.ts`
- new `src/mem-import/assignment-workspace.ts`
- `src/mem-import-tools.test.ts`
- new `src/mem-import-assignment-closure.test.ts`

Work:

1. Add run mode and v1/v2 assignment parser union.
2. Add protocol/schema/profile/tool hash constants.
3. Implement safe workspace creation, marker/context/extension bridge, canonicalization, and rollback.
4. Persist v2 assignments without grant/token hash.
5. Return profile, cwd, tools, bridge, context, model/thinking, expiry, and scope summary as launch descriptor.
6. Make closure-mode `assignmentBrief()` coordinator-authorized and credential-free.
7. Reject mixed assignment protocols.

Exit: workspace/binding hashes deterministic; corrupt/copied/wrong cwd fixtures fail; v1 status remains readable.

### Phase 2 — Cwd-bound worker provider

Files:

- `extensions/mem-import-tools.ts`
- optional new `src/mem-import/assignment-tool-provider.ts`
- `src/mem-import/service.ts`
- `src/mem-import/proposal-service.ts`
- `src/mem-import/identity-service.ts`
- `src/mem-import/u2-service.ts`

Work:

1. Replace worker authority schemas with semantic-only schemas.
2. Add `registerAssignmentTool()` and active-tool checks.
3. Pass `ctx.cwd` and `pi.getActiveTools()` through internal bound authority.
4. Implement workspace resolution and bound authorization.
5. Refactor worker entrypoints to accept internal authority.
6. Recheck lifecycle/scope in services.
7. Preserve exact lease-release cleanup exception.
8. Emit credential-free authorization diagnostics.

Exit: no worker schema exposes authority fields; valid cwd succeeds; wrong cwd/role/tools/protocol/lifecycle fails closed.

### Phase 3 — Stable effects and duplicate races

Files:

- `src/mem-import/service.ts`
- `src/mem-import/proposal-service.ts`
- `src/mem-import/identity-service.ts`
- `src/mem-import/u2-service.ts`
- closure and existing mem-import tests

Work:

1. Add stable singleton and transaction effect slots.
2. Move conflict checks under the run mutation lock.
3. Make same-content singleton repetition idempotent and conflicting content fail.
4. Prevent duplicate extraction replacement.
5. Add crash recovery for artifact-before-effect interruptions.
6. Retain merger/repairer CAS and fence behavior.

Exit: two processes produce one authoritative singleton effect; duplicate workers cannot escape scope.

### Phase 4 — Binding-aware dispatch and finalization

Files:

- `src/mem-import/service.ts`
- `src/mem-import/u2-service.ts`
- `extensions/mem-import-tools.ts`
- mem-import and acceptance tests

Work:

1. Add dispatch v2 profile/cwd/tool/extension binding fields.
2. Canonicalize host-observed cwd and separate semantic/lifecycle tools.
3. Make dispatch records append-only or immutable-idempotent.
4. Add binding metadata to effects and authorization events.
5. Update bounded inventories and diagnostics.
6. Require exact closure and host profile evidence at finalization.

Exit: missing, broadened, wrong-profile, wrong-cwd, legacy, or mismatched dispatch/effect evidence blocks closure-mode finalization.

### Phase 5 — Profiles, adapters, acceptance, and guidance

Files:

- named profile source/renderings/tests
- `src/mem-import/pi-sdk-acceptance-adapter.ts`
- acceptance materializer/service/runner
- mem-import skill and adapter references

Work:

1. Keep static worker semantic tool lists unchanged.
2. Point pi-subagents children at the workspace-relative bridge.
3. Keep Herdr trusted explicit extension inheritance and launch workers at assignment cwd.
4. Update recipes to copy only assignment-derived profile, cwd, extension, context, tools, and model/thinking.
5. Remove raw worker authority from prompts and fixture calls.
6. Require profile/cwd/tool telemetry for production closure mode.
7. Update Pi SDK acceptance to create sessions at assignment cwd and call semantic-only tools.
8. Do not change either external subagent executor.

Exit: both renderings work from assignment cwd; guidance contains neither launch handles nor raw worker grants.

### Phase 6 — Cross-process integration

Files:

- closure test suite
- acceptance and mem-import tests
- `package.json`
- `docs/smoke-tests.md` when needed

Work:

1. Load the real workspace bridge in a subprocess.
2. Race two processes on one assignment.
3. Test shared-loader multi-session isolation.
4. Run model-free SDK catalog/profile checks.
5. Run one bounded extraction-only evaluation per available adapter:
   - correct named profile and cwd;
   - wrong repo cwd;
   - wrong profile;
   - duplicate workers on one cwd.
6. Do not run a full corpus import before this gate is green.

Exit: adapters demonstrate exact profile/cwd/tool behavior or are explicitly unavailable for closure-mode imports; no executor changes required.

## Test matrix

### Workspace

- canonical workspace and private modes;
- deterministic profile/tool/schema hashes;
- duplicate task creation rejected;
- partial creation rollback;
- missing, copied, malformed, oversized, symlinked, wrong-suffix, wrong-task, and wrong-run markers rejected;
- only aliases canonicalizing to the legitimate workspace accepted;
- binding corruption detected.

### Schemas

Every worker tool omits:

```text
outputRoot
runId
taskId
grant
coordinatorGrant
```

Coordinator tools retain coordinator authority.

### Lifecycle and scope

For every role test live, revoked, superseded, expired, terminal, wrong capability, and out-of-scope operation. Lease cleanup cannot release another assignment's lease.

### Profile/tools

- correct profile succeeds;
- extractor cwd with proposer profile fails;
- missing expected tool fails;
- extra mem-import or generic tool fails;
- wrong extension protocol fails;
- wrong host profile/cwd blocks finalization;
- same-tools profile alias fails dispatch validation.

### Duplicate/concurrency

- same extraction/proposal/identity/review content is idempotent;
- conflicting singleton content produces one winner and one conflict;
- duplicate merger commits obey revision/read-set CAS;
- duplicate repairs obey fence/action/read-set scope;
- concurrent assignments never share binding state.

### Process boundaries

- fresh child succeeds with cwd plus semantic arguments only;
- model arguments cannot select another run because authority fields do not exist;
- repo cwd fails;
- another valid assignment cwd selects only that assignment;
- reload/session replacement has no stale binding;
- shared SDK loader cannot route session A through session B.

### Dispatch/audit

- immutable or append-only dispatch;
- exact binding/profile/cwd/tool/source hashes;
- broadened/missing telemetry rejected;
- effects contain service-derived binding;
- no secrets in authorization events;
- finalization rejects closure/effect/dispatch mismatch.

Run after each phase:

```bash
npm run build
npm run test:mem-import
git diff --check
```

Before promotion also run `npm test` and relevant `docs/smoke-tests.md` checks.

## Migration

1. Treat closure mode as a new assignment protocol.
2. New runs use `cwd-closure-v1` after the feature is activated.
3. Missing run mode means historical `grant-v1`.
4. Historical records remain inspectable.
5. Closure worker tools expose semantic-only schemas.
6. Never wrap a live v1 grant assignment in a v2 workspace.
7. Never mix protocols in one run.
8. Finish active v1 runs with the pinned old checkout or start a fresh closure-mode root.
9. Migrate/regenerate test fixtures only; do not rewrite production artifacts.
10. Surface the protocol boundary explicitly in status and errors.

## Risks

| Risk | Mitigation |
|---|---|
| Active tool names appear before extension registration | Register worker definitions at extension load, route by cwd at execution, and test the real SDK catalog. |
| Shared extension instance leaks assignment | No mutable current assignment; bind every call by execution cwd and hash. |
| pi-subagents relative extension fails under new cwd | Generate a workspace-relative bridge and test actual child arguments. |
| Host lacks profile/cwd telemetry | Mark facility unavailable for closure-mode production rather than weakening checks. |
| Duplicate workers conflict | Stable effect slots under run lock; same hash idempotent, different hash rejected. |
| Crash between artifact and effect | Content-addressed output and deterministic same-hash recovery. |
| Expiry/terminal state strands lease | Permit exact idempotent lease cleanup only. |
| Absolute source path appears in bridge | Treat as private non-secret configuration and audit by source hash. |
| Same-user process edits workspace | Outside threat model; this is application authorization, not OS sandboxing. |
| Named profile shadowing | Runtime tool equivalence plus host-resolved profile telemetry. |
| Upgrade breaks v1 runs | Explicit protocol gate and no mixed-mode mutation. |

## Non-goals

- No authorized-launch handles.
- No opaque launch tokens or launch nonces.
- No assignment authorization in either subagent extension.
- No mem-import-specific executor fork.
- No prevention of duplicate process creation.
- No OS sandbox or same-user filesystem defense.
- No dynamic assignment scope in named profile files.
- No coordinator closure conversion in this step.
- No full corpus import before focused closure integration passes.
- No silent migration of historical assignments.
- No shell, generic read/write, or recursive worker tools.

## Done criteria

- [ ] New assignments create canonical private workspaces.
- [ ] Closure assignments contain no worker token hash.
- [ ] Worker schemas expose no authority-bearing fields.
- [ ] Every worker call binds through canonical `ctx.cwd`.
- [ ] Wrong/unassigned cwd fails closed.
- [ ] Revoked, superseded, expired, and terminal assignments fail closed.
- [ ] Role/profile/tool/protocol mismatches fail closed.
- [ ] Singleton effects are exactly-once or content-idempotent.
- [ ] Duplicate workers cannot exceed assignment scope.
- [ ] Merger/repairer races remain CAS/fence safe.
- [ ] Effects contain service-derived binding evidence.
- [ ] Dispatches contain exact profile/cwd/tool telemetry.
- [ ] Finalization rejects closure or dispatch mismatch.
- [ ] Legacy runs remain readable without mixed-mode mutation.
- [ ] Both named-profile renderings pass deterministic tests.
- [ ] SDK and subprocess closure tests pass.
- [ ] No external subagent executor changes are required.
- [ ] Build, mem-import tests, repository tests, smoke checks, and diff checks pass.
