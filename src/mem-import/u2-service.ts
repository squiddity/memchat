import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { emitWorldLibrary } from "../world-import/emit.js";
import { deterministicWorldImportChecks, lintWorldImport } from "../world-import/eval.js";
import { buildCoveragePlan, provenanceAudit } from "../world-import/helper-tools.js";
import {
  importRunPath,
  mergedCandidatesPath,
  readExtractionStages,
  readManifest,
  readMergeStage,
  readNormalizedUnit,
  writeJson,
  writeMergeStage,
} from "../world-import/staging.js";
import type { MemImportRunAuditV2, StageEnvelope } from "../world-import/types.js";
import { MemImportCompendiumService, projectCompendium } from "./compendium-service.js";
import { MemImportService, type AssignmentRole, type MemImportAssignmentRecord, type MemImportCapability } from "./service.js";
import { MemImportIdentityService, type IdentityDecision, type StoredIdentityProposal } from "./identity-service.js";

const LEASE_HEARTBEAT_MS = 60_000;
const LEASE_EXPIRY_MS = 5 * 60_000;
/** Full reconstruction checkpoints bound replay cost without snapshotting every transaction. */
const TRANSACTION_CHECKPOINT_INTERVAL = 16;

type CoordinatorAuthority = { outputRoot: string; runId: string; coordinatorGrant: string };
type WorkerAuthority = { outputRoot: string; runId: string; taskId: string; grant: string };
type MergeActor = { kind: "coordinator" | "worker"; taskId: string; role?: AssignmentRole };

type MergeLease = {
  version: 1;
  kind: "mem-import-merge-lease";
  runId: string;
  owner: MergeActor;
  fence: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type MergeState = {
  stage: StageEnvelope;
  revision: number;
  contentHash: string | null;
  parentContentHash?: string;
};

export type MergeMutationReceipt = {
  revision: number;
  contentHash: string | null;
  parentContentHash: string | null;
  artifactCount: number;
  candidateDispositionCount: number;
  consumedProposalHashes: string[];
};

export function toMergeMutationReceipt(state: MergeState, consumedProposalHashes: string[]): MergeMutationReceipt {
  return {
    revision: state.revision,
    contentHash: state.contentHash,
    parentContentHash: state.parentContentHash ?? null,
    artifactCount: state.stage.artifacts?.length ?? 0,
    candidateDispositionCount: state.stage.candidateDispositions?.length ?? 0,
    consumedProposalHashes: [...new Set(consumedProposalHashes)],
  };
}

export type MergeInventoryEntry = {
  id: string;
  group: string;
  title: string;
  type?: string;
  tags?: string[];
  /** Exact hash to copy into a bounded merge read set. */
  artifactContentHash: string;
};

export type MergeInventoryResult = {
  revision: number;
  contentHash: string | null;
  totalArtifacts: number;
  entries: MergeInventoryEntry[];
  truncated: boolean;
  continuationCursor?: string;
};

export type MergeControls = {
  revision: number;
  contentHash: string | null;
  artifactCount: number;
  candidateDispositionCount: number;
  proposalCount: number;
  consumedProposalCount: number;
  unconsumedProposalCount: number;
  candidateCount: number;
  accountedCandidateCount: number;
  unaccountedCandidateCount: number;
  openConflictCount: number;
  blockingConflictCount: number;
  reviewValidity: {
    current: boolean;
    currentReviewCount: number;
    staleReviewCount: number;
    unaffectedReviewCount: number;
    unscopedReviewCount: number;
  };
};

type MergeInventoryCursor = { version: 1; revision: number; contentHash: string | null; group?: string; afterId: string };

const MAX_MERGE_PROPOSALS = 50;
const MAX_ACCEPT_CHANGES = 50;
const MAX_SYNTHESIZED_CHANGES = 12;
const MAX_TOTAL_MERGE_CHANGES = MAX_ACCEPT_CHANGES + MAX_SYNTHESIZED_CHANGES;

export type MergeLeaseResult = { fence: number; expiresAt: string; heartbeatEveryMs: number };
export type ConflictOperation =
  | { kind: "create"; conflictId: string; blocking: boolean; summary: string; identityDecisionId?: string }
  | { kind: "resolve" | "defer"; conflictId: string };

export type MergeCommitChange =
  | { kind: "accept"; proposalHash: string; artifactId: string }
  | { kind: "upsert"; artifact: unknown }
  | { kind: "delete"; artifactId: string };

export type MergeBatch = {
  proposalHashes: string[];
  /** Immutable reconciler packets accepted with this transaction. */
  identityProposalHashes?: string[];
  /** Exact hashes for artifacts inspected or replaced; null asserts an artifact was absent. */
  readSet: Array<{ artifactId: string; contentHash: string | null }>;
  operations: Array<{ kind: "upsert"; artifact: unknown } | { kind: "delete"; artifactId: string }>;
  candidateDispositions?: unknown[];
  /** Explicit model-owned conflict state changes paired with accepted reconciliation evidence. */
  conflictOperations?: ConflictOperation[];
  rationale: string;
};
type StoredTransactionOperation =
  | { kind: "upsert"; artifactRef: string }
  | { kind: "delete"; artifactId: string };

type StoredTransactionReceipt = {
  version: 1;
  kind: "mem-import-merge-transaction";
  revision: number;
  contentHash: string;
  parentContentHash: string | null;
  operations: StoredTransactionOperation[];
  candidateDispositions?: NonNullable<StageEnvelope["candidateDispositions"]>;
};

type MergeCheckpoint = {
  version: 1;
  kind: "mem-import-merge-checkpoint";
  revision: number;
  contentHash: string;
  stage: StageEnvelope;
};

export type ReviewPacket = {
  version: 1;
  kind: "mem-import-review";
  checkpointId: string;
  reviewedMergeRevision: number;
  reviewedMergeHash: string;
  findings: Array<{ id: string; severity: "info" | "warning" | "repair" | "critical"; summary: string; sourceRefs?: unknown[]; requestedActionIds?: string[] }>;
  requestedActions: Array<{ id: string; type: string; severity: "info" | "warning" | "repair" | "critical"; summary: string; rationale?: string; sourceRefs?: unknown[] }>;
  /** Exact bounded canonical artifact read set; absence is retained as legacy unscoped review evidence. */
  readSet?: Array<{ artifactId: string; contentHash: string | null }>;
  diagnostics?: Array<{ level: "info" | "warning" | "error"; message: string }>;
  metadata?: Record<string, unknown>;
};

function orchestrationDir(outputRoot: string): string { return join(outputRoot, "stages", "orchestration"); }
function leaseDir(outputRoot: string): string { return join(orchestrationDir(outputRoot), "locks", "merge-writer"); }
function leasePath(outputRoot: string): string { return join(leaseDir(outputRoot), "lease.json"); }
function fencePath(outputRoot: string): string { return join(orchestrationDir(outputRoot), "merge-fence.json"); }
function revisionPath(outputRoot: string, revision: number, contentHash: string): string { return join(outputRoot, "stages", "merge", "revisions", `${String(revision).padStart(8, "0")}-${contentHash}.json`); }
function transactionPath(outputRoot: string, revision: number, contentHash: string): string { return join(outputRoot, "stages", "merge", "transactions", `${String(revision).padStart(8, "0")}-${contentHash}.json`); }
function artifactBlobPath(outputRoot: string, contentHash: string): string { return join(outputRoot, "stages", "merge", "artifacts", `${contentHash}.json`); }
function checkpointPath(outputRoot: string, revision: number, contentHash: string): string { return join(outputRoot, "stages", "merge", "checkpoints", `${String(revision).padStart(8, "0")}-${contentHash}.json`); }
function proposalDir(outputRoot: string, runId: string): string { return join(outputRoot, "stages", "runs", runId, "proposals"); }
function eventPath(outputRoot: string, kind: string): string { return join(orchestrationDir(outputRoot), "events", `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}-${randomBytes(6).toString("hex")}.json`); }
function reviewPath(outputRoot: string, checkpointId: string, taskId: string, hash: string): string { return join(outputRoot, "stages", "reviews", checkpointId, `${taskId}-${hash}.json`); }
function identityStatePath(outputRoot: string): string { return join(outputRoot, "stages", "identity", "state.json"); }
function reviewValidityPath(outputRoot: string): string { return join(outputRoot, "stages", "reviews", "validity.json"); }

type CanonicalIdentityState = {
  version: 1;
  kind: "mem-import-identity-state";
  owners: Record<string, { proposalHash: string; decisionId: string; provisionalId: string; createdAt: string }>;
  conflicts: Record<string, { status: "open" | "deferred" | "resolved"; blocking: boolean; summary: string; identityDecisionId?: string; updatedAt: string }>;
};

function requireNonEmpty(value: string, label: string): void {
  if (!value || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function assertId(value: string, label: string): void {
  requireNonEmpty(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens`);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function semanticStage(stage: StageEnvelope): StageEnvelope {
  const { revision: _revision, contentHash: _contentHash, parentContentHash: _parentContentHash, ...semantic } = stage;
  return semantic;
}

function emptyStage(): StageEnvelope { return { version: 1, kind: "merge", artifacts: [], candidateDispositions: [], diagnostics: [] }; }

function isExpired(lease: MergeLease, now: Date): boolean {
  return new Date(lease.expiresAt).getTime() <= now.getTime();
}

function leaseOwnerEquals(left: MergeActor, right: MergeActor): boolean {
  return left.kind === right.kind && left.taskId === right.taskId && left.role === right.role;
}

export class MemImportU2Service {
  private readonly identities: MemImportIdentityService;

  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {
    this.identities = new MemImportIdentityService(base, now);
  }

  async mergeState(options: CoordinatorAuthority): Promise<MergeState> {
    const run = await this.base.authorizeCoordinator(options);
    return this.readMergeState(this.canonicalRoot(run));
  }

  async mergeControls(options: CoordinatorAuthority): Promise<MergeControls> {
    const run = await this.base.authorizeCoordinator(options);
    const canonicalRoot = this.canonicalRoot(run);
    const state = await this.readMergeState(canonicalRoot);
    const status = await this.workStatus(options);
    const reviewCounts = { current: 0, stale: 0, unaffected: 0, unscoped: 0 };
    if (existsSync(reviewValidityPath(canonicalRoot))) {
      const validity = JSON.parse(await readFile(reviewValidityPath(canonicalRoot), "utf-8")) as { entries?: Array<{ status?: unknown }> };
      for (const entry of validity.entries ?? []) {
        if (entry.status === "current" || entry.status === "stale" || entry.status === "unaffected" || entry.status === "unscoped") reviewCounts[entry.status] += 1;
      }
    }
    return {
      ...status,
      artifactCount: state.stage.artifacts?.length ?? 0,
      candidateDispositionCount: state.stage.candidateDispositions?.length ?? 0,
      reviewValidity: {
        current: reviewCounts.current > 0,
        currentReviewCount: reviewCounts.current,
        staleReviewCount: reviewCounts.stale,
        unaffectedReviewCount: reviewCounts.unaffected,
        unscopedReviewCount: reviewCounts.unscoped,
      },
    };
  }

  async readMergeForWorker(options: WorkerAuthority): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    return this.readMergeState(await this.base.canonicalRootForRun(assignment.outputRoot));
  }

  async workStatus(options: CoordinatorAuthority): Promise<{
    revision: number;
    contentHash: string | null;
    proposalCount: number;
    consumedProposalCount: number;
    unconsumedProposalCount: number;
    candidateCount: number;
    accountedCandidateCount: number;
    unaccountedCandidateCount: number;
    openConflictCount: number;
    blockingConflictCount: number;
  }> {
    const run = await this.base.authorizeCoordinator(options);
    const canonicalRoot = await this.base.canonicalRootForRun(run.outputRoot);
    const state = await this.readMergeState(canonicalRoot);
    const proposalsRoot = proposalDir(run.outputRoot, run.runId);
    const proposalHashes = new Set<string>();
    for (const file of existsSync(proposalsRoot) ? await readdir(proposalsRoot) : []) {
      if (!file.endsWith(".json")) continue;
      const packet = JSON.parse(await readFile(join(proposalsRoot, file), "utf-8")) as { contentHash?: unknown };
      if (typeof packet.contentHash === "string") proposalHashes.add(packet.contentHash);
    }
    const consumed = new Set<string>();
    const transactionsRoot = join(canonicalRoot, "stages", "merge", "transactions");
    for (const file of existsSync(transactionsRoot) ? await readdir(transactionsRoot) : []) {
      const receipt = JSON.parse(await readFile(join(transactionsRoot, file), "utf-8")) as { proposalHashes?: unknown };
      if (Array.isArray(receipt.proposalHashes)) for (const proposalHash of receipt.proposalHashes) if (typeof proposalHash === "string" && proposalHashes.has(proposalHash)) consumed.add(proposalHash);
    }
    const candidateKeys = new Set((await readExtractionStages(run.outputRoot)).flatMap((stage) => (stage.candidates ?? []).map((candidate) => `${stage.unitId}:${candidate.id}`)));
    const accountedKeys = new Set((state.stage.candidateDispositions ?? []).map((item) => `${item.unitId}:${item.candidateId}`).filter((key) => candidateKeys.has(key)));
    let openConflictCount = 0;
    let blockingConflictCount = 0;
    if (existsSync(identityStatePath(canonicalRoot))) {
      const identity = JSON.parse(await readFile(identityStatePath(canonicalRoot), "utf-8")) as CanonicalIdentityState;
      for (const conflict of Object.values(identity.conflicts ?? {})) if (conflict.status !== "resolved") {
        openConflictCount += 1;
        if (conflict.blocking) blockingConflictCount += 1;
      }
    }
    return {
      revision: state.revision,
      contentHash: state.contentHash,
      proposalCount: proposalHashes.size,
      consumedProposalCount: consumed.size,
      unconsumedProposalCount: proposalHashes.size - consumed.size,
      candidateCount: candidateKeys.size,
      accountedCandidateCount: accountedKeys.size,
      unaccountedCandidateCount: candidateKeys.size - accountedKeys.size,
      openConflictCount,
      blockingConflictCount,
    };
  }

  async mergeInventory(options: CoordinatorAuthority & { group?: string; continuationCursor?: string; maxItems?: number }): Promise<MergeInventoryResult> {
    const run = await this.base.authorizeCoordinator(options);
    return this.inventoryMerge(this.canonicalRoot(run), options);
  }

  async readMergeInventoryForWorker(options: WorkerAuthority & { group?: string; continuationCursor?: string; maxItems?: number }): Promise<MergeInventoryResult> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    return this.inventoryMerge(await this.base.canonicalRootForRun(assignment.outputRoot), options);
  }

  async readMergeArtifactForWorker(options: WorkerAuthority & { artifactId: string }): Promise<{ revision: number; contentHash: string | null; artifactContentHash: string | null; artifact?: NonNullable<StageEnvelope["artifacts"]>[number] }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    assertId(options.artifactId, "artifactId");
    const state = await this.readMergeState(await this.base.canonicalRootForRun(assignment.outputRoot));
    const artifact = state.stage.artifacts?.find((item) => item.id === options.artifactId);
    return { revision: state.revision, contentHash: state.contentHash, artifactContentHash: artifact ? hash(artifact) : null, ...(artifact ? { artifact } : {}) };
  }

  async acquireCoordinatorLease(options: CoordinatorAuthority & { taskId: string }): Promise<MergeLeaseResult> {
    const run = await this.base.authorizeCoordinator(options);
    assertId(options.taskId, "taskId");
    return this.acquireLease(this.canonicalRoot(run), run.runId, { kind: "coordinator", taskId: options.taskId });
  }

  async acquireWorkerLease(options: WorkerAuthority): Promise<MergeLeaseResult> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:lease" });
    if (assignment.role !== "merger" && assignment.role !== "repairer") throw new Error("Only merger or repairer assignments may acquire the global merge lease");
    return this.acquireLease(await this.base.canonicalRootForRun(assignment.outputRoot), assignment.runId, { kind: "worker", taskId: assignment.taskId, role: assignment.role });
  }

  async heartbeatCoordinatorLease(options: CoordinatorAuthority & { taskId: string; fence: number }): Promise<MergeLeaseResult> {
    const run = await this.base.authorizeCoordinator(options);
    return this.heartbeatLease(this.canonicalRoot(run), run.runId, { kind: "coordinator", taskId: options.taskId }, options.fence);
  }

  async heartbeatWorkerLease(options: WorkerAuthority & { fence: number }): Promise<MergeLeaseResult> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:lease" });
    return this.heartbeatLease(await this.base.canonicalRootForRun(assignment.outputRoot), assignment.runId, { kind: "worker", taskId: assignment.taskId, role: assignment.role }, options.fence);
  }

  async releaseCoordinatorLease(options: CoordinatorAuthority & { taskId: string; fence: number }): Promise<void> {
    const run = await this.base.authorizeCoordinator(options);
    await this.releaseLease(this.canonicalRoot(run), run.runId, { kind: "coordinator", taskId: options.taskId }, options.fence);
  }

  async releaseWorkerLease(options: WorkerAuthority & { fence: number }): Promise<void> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:lease" });
    await this.releaseLease(await this.base.canonicalRootForRun(assignment.outputRoot), assignment.runId, { kind: "worker", taskId: assignment.taskId, role: assignment.role }, options.fence);
  }

  async writeCoordinatorMerge(options: CoordinatorAuthority & { taskId: string; fence: number; expectedRevision: number; expectedContentHash: string | null; stage: unknown; rationale: string; checkpointId?: string; actionIds?: string[] }): Promise<MergeState> {
    const run = await this.base.authorizeCoordinator(options);
    const { outputRoot: _outputRoot, runId: _runId, coordinatorGrant: _coordinatorGrant, ...mutation } = options;
    return this.writeMerge({ outputRoot: this.canonicalRoot(run), sourceRoot: run.outputRoot, runId: run.runId, actor: { kind: "coordinator", taskId: options.taskId }, ...mutation });
  }

  async writeWorkerMerge(options: WorkerAuthority & { fence: number; expectedRevision: number; expectedContentHash: string | null; stage: unknown; rationale: string; checkpointId?: string; actionIds?: string[] }): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:write", checkpointId: options.checkpointId, actionIds: options.actionIds });
    // Complete snapshots are coordinator-only legacy comparison/admin work. Semantic
    // workers must use bounded proposal-backed batches even if a host leaks this tool.
    void assignment;
    throw new Error("Worker complete snapshot writes are disabled; use the assigned bounded batch mutation tool");
  }

  /** Apply a small proposal-backed artifact delta; normal mergers cannot use repair scope here. */
  async applyWorkerBatch(options: WorkerAuthority & { fence: number; expectedRevision: number; expectedContentHash: string | null; batch: MergeBatch }): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:write", role: "merger" });
    const canonicalRoot = await this.base.canonicalRootForRun(assignment.outputRoot);
    const sourceRoot = canonicalRoot === assignment.outputRoot ? assignment.outputRoot : (await projectCompendium(canonicalRoot), canonicalRoot);
    const batch = await this.validateBatch(assignment.outputRoot, assignment.runId, options.batch);
    const before = await this.readMergeState(canonicalRoot);
    this.assertReadSet(before.stage, batch.readSet);
    const identityPackets = await this.validateIdentityEffects(assignment.outputRoot, canonicalRoot, assignment.runId, before.stage, batch);
    const rebased = before.revision !== options.expectedRevision || before.contentHash !== options.expectedContentHash;
    const stage = this.applyBatch(before.stage, batch);
    const written = await this.writeMerge({
      outputRoot: canonicalRoot,
      sourceRoot,
      runId: assignment.runId,
      actor: { kind: "worker", taskId: assignment.taskId, role: assignment.role },
      fence: options.fence,
      expectedRevision: before.revision,
      expectedContentHash: before.contentHash,
      stage,
      rationale: batch.rationale,
      transaction: { proposalHashes: batch.proposalHashes, readSet: batch.readSet, operations: batch.operations, ...(batch.candidateDispositions?.length ? { candidateDispositions: batch.candidateDispositions } : {}), ...(batch.identityProposalHashes?.length ? { identityProposalHashes: batch.identityProposalHashes } : {}), ...(batch.conflictOperations?.length ? { conflictOperations: batch.conflictOperations } : {}), ...(rebased ? { rebasedFrom: { revision: options.expectedRevision, contentHash: options.expectedContentHash } } : {}) },
    });
    await this.applyIdentityEffects(canonicalRoot, batch, identityPackets);
    await this.base.recordWorkerEffect(assignment, { kind: "merge", path: this.relative(canonicalRoot, transactionPath(canonicalRoot, written.revision, written.contentHash!)), contentHash: written.contentHash! });
    return written;
  }

  /** Model-facing merger path. One bounded call resolves proposal references,
   * carries candidate accounting, and owns lease/CAS lifecycle internally. */
  async commitWorkerBatch(options: WorkerAuthority & {
    proposalHashes: string[];
    identityProposalHashes?: string[];
    readSet: Array<{ artifactId: string; contentHash?: string | null }>;
    changes: MergeCommitChange[];
    conflictOperations?: ConflictOperation[];
    rationale: string;
  }): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:write", role: "merger" });
    if (!Array.isArray(options.proposalHashes) || options.proposalHashes.length === 0 || options.proposalHashes.length > MAX_MERGE_PROPOSALS) throw new Error(`Merge commit proposalHashes must contain one to ${MAX_MERGE_PROPOSALS} hashes`);
    if (assignment.allowedProposalHashes?.length && options.proposalHashes.some((proposalHash) => !assignment.allowedProposalHashes!.includes(proposalHash))) throw new Error("Merge commit proposal hash is outside this merger assignment");
    if (!Array.isArray(options.changes) || options.changes.length === 0 || options.changes.length > MAX_TOTAL_MERGE_CHANGES) throw new Error(`Merge commit changes must contain one to ${MAX_TOTAL_MERGE_CHANGES} entries`);
    const acceptCount = options.changes.filter((change) => change.kind === "accept").length;
    const synthesizedCount = options.changes.length - acceptCount;
    if (acceptCount > MAX_ACCEPT_CHANGES) throw new Error(`Merge commit changes accepts exceed the ${MAX_ACCEPT_CHANGES}-entry lightweight limit`);
    if (synthesizedCount > MAX_SYNTHESIZED_CHANGES) throw new Error(`Merge commit changes upsert/delete entries exceed the ${MAX_SYNTHESIZED_CHANGES}-entry synthesis limit`);
    const proposals = new Map<string, Awaited<ReturnType<MemImportU2Service["readProposal"]>>>();
    for (const proposalHash of options.proposalHashes) proposals.set(proposalHash, await this.readProposal(assignment.outputRoot, assignment.runId, proposalHash));
    const operations: MergeBatch["operations"] = options.changes.map((change) => {
      if (change.kind !== "accept") return structuredClone(change);
      if (!options.proposalHashes.includes(change.proposalHash)) throw new Error(`Accepted proposal ${change.proposalHash} is not declared by this commit`);
      const proposal = proposals.get(change.proposalHash)!;
      const artifact = proposal.artifacts.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === change.artifactId);
      if (!artifact) throw new Error(`Proposal ${change.proposalHash} has no artifact ${change.artifactId}`);
      return { kind: "upsert", artifact: structuredClone(artifact) };
    });
    const candidateDispositions = [...proposals.values()].flatMap((proposal) => proposal.candidateDispositions ?? []);
    const batch: MergeBatch = {
      proposalHashes: options.proposalHashes,
      ...(options.identityProposalHashes?.length ? { identityProposalHashes: options.identityProposalHashes } : {}),
      readSet: options.readSet.map((item) => ({ artifactId: item.artifactId, contentHash: item.contentHash ?? null })),
      operations,
      candidateDispositions,
      ...(options.conflictOperations?.length ? { conflictOperations: options.conflictOperations } : {}),
      rationale: options.rationale,
    };
    const canonicalRoot = await this.base.canonicalRootForRun(assignment.outputRoot);
    const owner: MergeActor = { kind: "worker", taskId: assignment.taskId, role: assignment.role };
    const lease = await this.acquireLease(canonicalRoot, assignment.runId, owner);
    try {
      const current = await this.readMergeState(canonicalRoot);
      return await this.applyWorkerBatch({ ...options, fence: lease.fence, expectedRevision: current.revision, expectedContentHash: current.contentHash, batch });
    } finally {
      // The commit already authorized and captured its owner. Release directly so a
      // concurrent coordinator revocation cannot strand the lease in the cleanup path.
      await this.releaseLease(canonicalRoot, assignment.runId, owner, lease.fence);
    }
  }

  async commitWorkerBatchReceipt(options: WorkerAuthority & {
    proposalHashes: string[];
    identityProposalHashes?: string[];
    readSet: Array<{ artifactId: string; contentHash?: string | null }>;
    changes: MergeCommitChange[];
    conflictOperations?: ConflictOperation[];
    rationale: string;
  }): Promise<MergeMutationReceipt> {
    const state = await this.commitWorkerBatch(options);
    return toMergeMutationReceipt(state, options.proposalHashes);
  }

  /** Apply a repairer-only bounded transaction. Its checkpoint/action scope is authorization-enforced and retained in the receipt. */
  async applyWorkerRepairBatch(options: WorkerAuthority & { fence: number; expectedRevision: number; expectedContentHash: string | null; checkpointId: string; actionIds: string[]; batch: MergeBatch }): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:write", role: "repairer", checkpointId: options.checkpointId, actionIds: options.actionIds });
    if (!Array.isArray(options.batch.operations) || options.batch.operations.length === 0 || options.batch.operations.length > MAX_SYNTHESIZED_CHANGES) throw new Error(`Repair batch operations must contain one to ${MAX_SYNTHESIZED_CHANGES} synthesized changes`);
    const canonicalRoot = await this.base.canonicalRootForRun(assignment.outputRoot);
    const sourceRoot = canonicalRoot === assignment.outputRoot ? assignment.outputRoot : (await projectCompendium(canonicalRoot), canonicalRoot);
    const batch = await this.validateBatch(assignment.outputRoot, assignment.runId, options.batch);
    const before = await this.readMergeState(canonicalRoot);
    this.assertReadSet(before.stage, batch.readSet);
    const identityPackets = await this.validateIdentityEffects(assignment.outputRoot, canonicalRoot, assignment.runId, before.stage, batch);
    const rebased = before.revision !== options.expectedRevision || before.contentHash !== options.expectedContentHash;
    const stage = this.applyBatch(before.stage, batch);
    const written = await this.writeMerge({
      outputRoot: canonicalRoot,
      sourceRoot,
      runId: assignment.runId,
      actor: { kind: "worker", taskId: assignment.taskId, role: assignment.role },
      fence: options.fence,
      expectedRevision: before.revision,
      expectedContentHash: before.contentHash,
      stage,
      rationale: batch.rationale,
      checkpointId: options.checkpointId,
      actionIds: options.actionIds,
      transaction: { proposalHashes: batch.proposalHashes, readSet: batch.readSet, operations: batch.operations, ...(batch.candidateDispositions?.length ? { candidateDispositions: batch.candidateDispositions } : {}), ...(batch.identityProposalHashes?.length ? { identityProposalHashes: batch.identityProposalHashes } : {}), ...(batch.conflictOperations?.length ? { conflictOperations: batch.conflictOperations } : {}), ...(rebased ? { rebasedFrom: { revision: options.expectedRevision, contentHash: options.expectedContentHash } } : {}) },
    });
    await this.applyIdentityEffects(canonicalRoot, batch, identityPackets);
    await this.base.recordWorkerEffect(assignment, { kind: "repair", path: this.relative(canonicalRoot, transactionPath(canonicalRoot, written.revision, written.contentHash!)), contentHash: written.contentHash! });
    return written;
  }

  async applyWorkerRepairBatchReceipt(options: WorkerAuthority & { fence: number; expectedRevision: number; expectedContentHash: string | null; checkpointId: string; actionIds: string[]; batch: MergeBatch }): Promise<MergeMutationReceipt> {
    const state = await this.applyWorkerRepairBatch(options);
    return toMergeMutationReceipt(state, options.batch.proposalHashes);
  }

  async submitReview(options: WorkerAuthority & { packet: ReviewPacket }): Promise<{ path: string; contentHash: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "review:submit", role: "reviewer" });
    const packet = this.validateReviewPacket(options.packet);
    const canonicalRoot = await this.base.canonicalRootForRun(assignment.outputRoot);
    const state = await this.readMergeState(canonicalRoot);
    const reviewedStage = await this.readRevisionStage(canonicalRoot, packet.reviewedMergeRevision, packet.reviewedMergeHash, state);
    this.assertReviewReadSet(reviewedStage, packet.readSet);
    const extractionHash = await this.extractionHash(assignment.outputRoot);
    const immutable = {
      ...packet,
      runId: assignment.runId,
      taskId: assignment.taskId,
      reviewedExtractionHash: extractionHash,
      submittedAt: this.now().toISOString(),
    };
    const contentHash = hash(immutable);
    const path = reviewPath(assignment.outputRoot, packet.checkpointId, assignment.taskId, contentHash);
    if (existsSync(path)) throw new Error("This immutable review packet has already been submitted");
    await writeJson(path, immutable);
    await this.refreshReviewValidity(canonicalRoot, state.stage);
    await this.recordEvent(assignment.outputRoot, "review", { runId: assignment.runId, taskId: assignment.taskId, path: this.relative(assignment.outputRoot, path), contentHash, mergeRevision: packet.reviewedMergeRevision, mergeHash: packet.reviewedMergeHash });
    await this.updateAudit(assignment.outputRoot, assignment.runId, { kind: "review", path: this.relative(assignment.outputRoot, path), contentHash, at: this.now().toISOString(), taskId: assignment.taskId });
    await this.base.recordWorkerEffect(assignment, { kind: "review", path: this.relative(assignment.outputRoot, path), contentHash });
    return { path: this.relative(assignment.outputRoot, path), contentHash };
  }

  /** Persist a terminal coordinator failure when required delegation/capability gates cannot be met. */
  async fail(options: CoordinatorAuthority & { reasonCode: string; message: string }): Promise<{ auditPath: string }> {
    const run = await this.base.authorizeCoordinator(options);
    requireNonEmpty(options.reasonCode, "reasonCode");
    requireNonEmpty(options.message, "message");
    const safeReasonCode = options.reasonCode.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);
    const message = options.message.slice(0, 1000);
    await this.updateAudit(run.outputRoot, run.runId, {
      kind: "finalization",
      path: "stages/import-run.json",
      contentHash: hash({ safeReasonCode, message }),
      at: this.now().toISOString(),
    }, { status: "failed", finalizedAt: this.now().toISOString(), error: `${safeReasonCode}: ${message}` });
    await this.recordEvent(run.outputRoot, "failure", { runId: run.runId, reasonCode: safeReasonCode, message });
    return { auditPath: "stages/import-run.json" };
  }

  async checks(options: CoordinatorAuthority) {
    const run = await this.base.authorizeCoordinator(options);
    const projectionRoot = this.canonicalRoot(run);
    if (run.compendiumRoot) await projectCompendium(run.compendiumRoot);
    const checks = await this.collectChecks(projectionRoot);
    const identityDiagnostics = await this.identityDiagnostics(projectionRoot);
    const dispatchRoots = run.compendiumRoot
      ? (await new MemImportCompendiumService(this.base).inspect(run.compendiumRoot)).runs.map((item) => item.runRoot)
      : [run.outputRoot];
    const dispatchDiagnostics = (await Promise.all(dispatchRoots.map((root) => this.base.dispatchDiagnostics(root)))).flat()
      .map((item) => ({ level: "error" as const, message: `Dispatch gate (${item.taskId}): ${item.message}`, path: "stages/orchestration/dispatches" }));
    const diagnostics = [...identityDiagnostics, ...dispatchDiagnostics];
    return { ...checks, readiness: { passed: diagnostics.every((item) => item.level !== "error"), diagnostics } };
  }

  async finalize(options: CoordinatorAuthority & { taskId: string; fence: number }): Promise<{ finalized: boolean; auditPath: string; checksPath: string; errors: number; warnings: number }> {
    const run = await this.base.authorizeCoordinator(options);
    const projectionRoot = this.canonicalRoot(run);
    await this.requireLease(projectionRoot, run.runId, { kind: "coordinator", taskId: options.taskId }, options.fence);
    if (run.compendiumRoot) await projectCompendium(run.compendiumRoot);
    await emitWorldLibrary(projectionRoot);
    const checks = await this.collectChecks(projectionRoot);
    const identityDiagnostics = await this.identityDiagnostics(projectionRoot);
    const dispatchRoots = run.compendiumRoot
      ? (await new MemImportCompendiumService(this.base).inspect(run.compendiumRoot)).runs.map((item) => item.runRoot)
      : [run.outputRoot];
    const dispatchDiagnostics = (await Promise.all(dispatchRoots.map((root) => this.base.dispatchDiagnostics(root)))).flat()
      .map((item) => ({ level: "error" as const, message: `Dispatch gate (${item.taskId}): ${item.message}`, path: "stages/orchestration/dispatches" }));
    const diagnostics = [
      ...checks.lint.diagnostics,
      ...checks.coverage.recommendations,
      ...checks.coverage.unitCoverage.flatMap((unit) => unit.diagnostics),
      ...checks.provenance.diagnostics,
      ...checks.deterministic.checks.flatMap((check) => check.diagnostics ?? []),
      ...identityDiagnostics,
      ...dispatchDiagnostics,
    ];
    const errors = diagnostics.filter((item) => item.level === "error").length;
    const warnings = diagnostics.filter((item) => item.level === "warning").length;
    const state = await this.readMergeState(projectionRoot);
    if (!state.contentHash) throw new Error("Cannot finalize before a canonical merge revision exists");
    const checksPath = join(projectionRoot, "stages", "checks", `final-${String(state.revision).padStart(8, "0")}-${state.contentHash}.json`);
    await writeJson(checksPath, { version: 1, kind: "mem-import-final-checks", runId: run.runId, merge: { revision: state.revision, contentHash: state.contentHash }, createdAt: this.now().toISOString(), errors, warnings, diagnostics, checks });
    const receiptPath = this.relative(projectionRoot, this.revisionReceiptPath(projectionRoot, state.revision, state.contentHash));
    const audit = await this.updateAudit(projectionRoot, run.runId, {
      kind: "finalization",
      path: this.relative(projectionRoot, checksPath),
      contentHash: hash({ errors, warnings, state }),
      at: this.now().toISOString(),
      taskId: options.taskId,
    }, {
      status: errors === 0 ? "finalized" : "failed",
      finalizedAt: this.now().toISOString(),
      merge: { revision: state.revision, contentHash: state.contentHash, revisionReceiptPath: receiptPath },
      finalization: { passed: errors === 0, errorCount: errors, warningCount: warnings, checksPath: this.relative(projectionRoot, checksPath) },
    });
    await this.recordEvent(projectionRoot, "finalization", { runId: run.runId, taskId: options.taskId, mergeRevision: state.revision, mergeHash: state.contentHash, checksPath: this.relative(projectionRoot, checksPath), errors, warnings, status: audit.status });
    return { finalized: errors === 0, auditPath: "stages/import-run.json", checksPath: this.relative(projectionRoot, checksPath), errors, warnings };
  }

  private async writeMerge(options: { outputRoot: string; sourceRoot?: string; runId: string; actor: MergeActor; fence: number; expectedRevision: number; expectedContentHash: string | null; stage: unknown; rationale: string; checkpointId?: string; actionIds?: string[]; transaction?: Pick<MergeBatch, "proposalHashes" | "identityProposalHashes" | "readSet" | "operations" | "candidateDispositions" | "conflictOperations"> & { rebasedFrom?: { revision: number; contentHash: string | null } } }): Promise<MergeState> {
    assertId(options.actor.taskId, "taskId");
    requireNonEmpty(options.rationale, "rationale");
    await this.requireLease(options.outputRoot, options.runId, options.actor, options.fence);
    const before = await this.readMergeState(options.outputRoot);
    if (before.revision !== options.expectedRevision || before.contentHash !== options.expectedContentHash) {
      throw new Error(`Stale merge compare-and-swap: expected revision/hash ${options.expectedRevision}/${options.expectedContentHash ?? "absent"}, current is ${before.revision}/${before.contentHash ?? "absent"}`);
    }
    if (!options.stage || typeof options.stage !== "object" || Array.isArray(options.stage)) throw new Error("Merge stage must be an object");
    const submitted = semanticStage(structuredClone(options.stage as StageEnvelope));
    submitted.version = 1;
    submitted.kind = "merge";
    if (!Array.isArray(submitted.artifacts)) throw new Error("Merge stage must contain artifacts array");
    await this.deriveArtifactProvenanceQuotes(options.sourceRoot ?? options.outputRoot, submitted, options.transaction ? new Set(options.transaction.operations.map((operation) => operation.kind === "upsert" ? (operation.artifact as { id: string }).id : operation.artifactId)) : undefined);
    const contentHash = hash(submitted);
    const stage: StageEnvelope = { ...submitted, revision: before.revision + 1, contentHash, ...(before.contentHash ? { parentContentHash: before.contentHash } : {}) };
    const { validateStageEnvelope } = await import("../world-import/staging.js");
    validateStageEnvelope(stage, { requireArtifacts: true });
    await this.assertLiteralArtifactProvenance(options.sourceRoot ?? options.outputRoot, stage, options.transaction ? new Set(options.transaction.operations.map((operation) => operation.kind === "upsert" ? (operation.artifact as { id: string }).id : operation.artifactId)) : undefined);
    const extractionHash = await this.extractionHash(options.sourceRoot ?? options.outputRoot);
    const storedOperations = options.transaction
      ? await this.persistTransactionArtifacts(options.outputRoot, stage, options.transaction.operations)
      : undefined;
    const receipt = options.transaction ? {
      version: 1,
      kind: "mem-import-merge-transaction",
      runId: options.runId,
      revision: stage.revision,
      contentHash,
      parentContentHash: before.contentHash,
      extractionHash,
      actor: options.actor,
      fence: options.fence,
      rationale: options.rationale,
      proposalHashes: options.transaction.proposalHashes,
      ...(options.transaction.identityProposalHashes?.length ? { identityProposalHashes: options.transaction.identityProposalHashes } : {}),
      readSet: options.transaction.readSet,
      operations: storedOperations!,
      ...(options.transaction.candidateDispositions?.length ? { candidateDispositions: options.transaction.candidateDispositions } : {}),
      ...(options.transaction.conflictOperations?.length ? { conflictOperations: options.transaction.conflictOperations } : {}),
      ...(options.checkpointId ? { checkpointId: options.checkpointId } : {}),
      ...(options.actionIds?.length ? { actionIds: [...new Set(options.actionIds)].sort() } : {}),
      ...(options.transaction.rebasedFrom ? { rebasedFrom: options.transaction.rebasedFrom } : {}),
      createdAt: this.now().toISOString(),
    } : {
      version: 1,
      kind: "mem-import-merge-revision",
      runId: options.runId,
      revision: stage.revision,
      contentHash,
      parentContentHash: before.contentHash,
      extractionHash,
      actor: options.actor,
      fence: options.fence,
      rationale: options.rationale,
      ...(options.checkpointId ? { checkpointId: options.checkpointId } : {}),
      ...(options.actionIds?.length ? { actionIds: [...new Set(options.actionIds)].sort() } : {}),
      createdAt: this.now().toISOString(),
      stage,
    };
    const receiptFile = options.transaction ? transactionPath(options.outputRoot, stage.revision!, contentHash) : revisionPath(options.outputRoot, stage.revision!, contentHash);
    if (existsSync(receiptFile)) throw new Error("Merge revision receipt already exists; retry after reading current state");
    await writeJson(receiptFile, receipt);
    if (options.transaction && stage.revision! % TRANSACTION_CHECKPOINT_INTERVAL === 0) {
      const checkpoint: MergeCheckpoint = { version: 1, kind: "mem-import-merge-checkpoint", revision: stage.revision!, contentHash, stage };
      await writeJson(checkpointPath(options.outputRoot, stage.revision!, contentHash), checkpoint);
    }
    await writeMergeStage(options.outputRoot, stage);
    await this.refreshReviewValidity(options.outputRoot, stage);
    await this.recordEvent(options.outputRoot, "merge", { runId: options.runId, taskId: options.actor.taskId, actor: options.actor.kind, fence: options.fence, revision: stage.revision, contentHash, parentContentHash: before.contentHash, extractionHash, receiptPath: this.relative(options.outputRoot, receiptFile) });
    await this.updateAudit(options.outputRoot, options.runId, { kind: "merge", path: this.relative(options.outputRoot, receiptFile), contentHash, at: this.now().toISOString(), taskId: options.actor.taskId });
    return { stage, revision: stage.revision!, contentHash, ...(before.contentHash ? { parentContentHash: before.contentHash } : {}) };
  }

  private async acquireLease(outputRoot: string, runId: string, owner: MergeActor): Promise<MergeLeaseResult> {
    const directory = leaseDir(outputRoot);
    await mkdir(join(orchestrationDir(outputRoot), "locks"), { recursive: true, mode: 0o700 });
    let previous: MergeLease | undefined;
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      previous = await this.readLease(outputRoot);
      if (!previous || !isExpired(previous, this.now())) throw new Error("A live merge writer lease already exists; wait, release it, or recover only after expiry");
      await rm(directory, { recursive: true, force: true });
      try { await mkdir(directory, { recursive: false, mode: 0o700 }); }
      catch (retry: unknown) { if ((retry as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another coordinator recovered the expired merge lease first"); throw retry; }
    }
    const previousFence = await this.readFence(outputRoot);
    const fence = Math.max(previous?.fence ?? 0, previousFence) + 1;
    const now = this.now();
    const lease: MergeLease = { version: 1, kind: "mem-import-merge-lease", runId, owner, fence, acquiredAt: now.toISOString(), heartbeatAt: now.toISOString(), expiresAt: new Date(now.getTime() + LEASE_EXPIRY_MS).toISOString() };
    await writeJson(leasePath(outputRoot), lease);
    await writeJson(fencePath(outputRoot), { version: 1, highestFence: fence, updatedAt: now.toISOString() });
    await this.recordEvent(outputRoot, "lease", { runId, action: previous ? "recovered" : "acquired", owner, fence, expiresAt: lease.expiresAt, ...(previous ? { previousOwner: previous.owner, previousFence: previous.fence } : {}) });
    return { fence, expiresAt: lease.expiresAt, heartbeatEveryMs: LEASE_HEARTBEAT_MS };
  }

  private async heartbeatLease(outputRoot: string, runId: string, owner: MergeActor, fence: number): Promise<MergeLeaseResult> {
    await this.requireLease(outputRoot, runId, owner, fence);
    const lease = await this.readLease(outputRoot);
    if (!lease) throw new Error("Merge lease disappeared before heartbeat");
    const now = this.now();
    const next = { ...lease, heartbeatAt: now.toISOString(), expiresAt: new Date(now.getTime() + LEASE_EXPIRY_MS).toISOString() };
    await writeJson(leasePath(outputRoot), next);
    return { fence, expiresAt: next.expiresAt, heartbeatEveryMs: LEASE_HEARTBEAT_MS };
  }

  private async releaseLease(outputRoot: string, runId: string, owner: MergeActor, fence: number): Promise<void> {
    await this.requireLease(outputRoot, runId, owner, fence);
    await rm(leaseDir(outputRoot), { recursive: true, force: true });
    await this.recordEvent(outputRoot, "lease", { runId, action: "released", owner, fence });
  }

  private async requireLease(outputRoot: string, runId: string, owner: MergeActor, fence: number): Promise<void> {
    const lease = await this.readLease(outputRoot);
    if (!lease || lease.runId !== runId) throw new Error("No active merge writer lease exists for this run");
    if (isExpired(lease, this.now())) throw new Error("Merge writer lease has expired; recover it before mutation");
    if (lease.fence !== fence || !leaseOwnerEquals(lease.owner, owner)) throw new Error("Merge writer lease fence or owner does not match; stale writers are rejected");
  }

  private async readLease(outputRoot: string): Promise<MergeLease | undefined> {
    if (!existsSync(leasePath(outputRoot))) return undefined;
    const value = JSON.parse(await readFile(leasePath(outputRoot), "utf-8")) as Partial<MergeLease>;
    if (value.version !== 1 || value.kind !== "mem-import-merge-lease" || typeof value.runId !== "string" || !value.owner || typeof value.fence !== "number" || typeof value.expiresAt !== "string") throw new Error("Invalid merge lease record");
    return value as MergeLease;
  }

  private async readFence(outputRoot: string): Promise<number> {
    if (!existsSync(fencePath(outputRoot))) return 0;
    const value = JSON.parse(await readFile(fencePath(outputRoot), "utf-8")) as { highestFence?: unknown };
    return typeof value.highestFence === "number" && Number.isInteger(value.highestFence) && value.highestFence >= 0 ? value.highestFence : 0;
  }

  private async inventoryMerge(outputRoot: string, options: { group?: string; continuationCursor?: string; maxItems?: number }): Promise<MergeInventoryResult> {
    const maxItems = options.maxItems ?? 25;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    const state = await this.readMergeState(outputRoot);
    const cursor = options.continuationCursor ? this.decodeMergeInventoryCursor(options.continuationCursor) : undefined;
    if (cursor && (cursor.revision !== state.revision || cursor.contentHash !== state.contentHash || cursor.group !== options.group)) throw new Error("Stale merge inventory continuation cursor");
    const artifacts = (state.stage.artifacts ?? [])
      .filter((artifact) => !options.group || artifact.group === options.group)
      .filter((artifact) => !cursor || artifact.id > cursor.afterId)
      .sort((left, right) => left.id.localeCompare(right.id));
    const entries = artifacts.slice(0, maxItems).map((artifact) => ({
      id: artifact.id,
      group: artifact.group,
      title: artifact.title,
      artifactContentHash: hash(artifact),
      ...(artifact.type ? { type: artifact.type } : {}),
      ...(artifact.tags?.length ? { tags: artifact.tags } : {}),
    }));
    const truncated = artifacts.length > entries.length;
    const last = entries.at(-1);
    return {
      revision: state.revision,
      contentHash: state.contentHash,
      totalArtifacts: artifacts.length,
      entries,
      truncated,
      ...(truncated && last ? { continuationCursor: this.encodeMergeInventoryCursor({ version: 1, revision: state.revision, contentHash: state.contentHash, ...(options.group ? { group: options.group } : {}), afterId: last.id }) } : {}),
    };
  }

  private encodeMergeInventoryCursor(cursor: MergeInventoryCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
  }

  private decodeMergeInventoryCursor(value: string): MergeInventoryCursor {
    let cursor: Partial<MergeInventoryCursor>;
    try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<MergeInventoryCursor>; }
    catch { throw new Error("Invalid merge inventory continuation cursor"); }
    if (cursor.version !== 1 || typeof cursor.revision !== "number" || !Number.isInteger(cursor.revision) || cursor.revision < 0 || (cursor.contentHash !== null && typeof cursor.contentHash !== "string") || (cursor.group !== undefined && typeof cursor.group !== "string") || typeof cursor.afterId !== "string") throw new Error("Invalid merge inventory continuation cursor");
    return cursor as MergeInventoryCursor;
  }

  private async readMergeState(outputRoot: string): Promise<MergeState> {
    if (!existsSync(mergedCandidatesPath(outputRoot))) return { stage: emptyStage(), revision: 0, contentHash: null };
    const stage = await readMergeStage(outputRoot);
    if (stage.kind !== "merge") throw new Error("Canonical merge stage has invalid kind");
    if (!Number.isInteger(stage.revision) || (stage.revision ?? 0) < 1 || typeof stage.contentHash !== "string") throw new Error("Canonical merge stage is missing revision/contentHash control metadata");
    const calculated = hash(semanticStage(stage));
    if (calculated !== stage.contentHash) throw new Error("Canonical merge stage contentHash does not match its semantic contents");
    return { stage, revision: stage.revision!, contentHash: stage.contentHash, ...(stage.parentContentHash ? { parentContentHash: stage.parentContentHash } : {}) };
  }

  private async validateBatch(outputRoot: string, runId: string, value: MergeBatch): Promise<MergeBatch> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Merge batch must be an object");
    if (!Array.isArray(value.proposalHashes) || value.proposalHashes.length === 0 || value.proposalHashes.length > MAX_MERGE_PROPOSALS || value.proposalHashes.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new Error(`Merge batch proposalHashes must contain one to ${MAX_MERGE_PROPOSALS} SHA-256 hashes`);
    if (new Set(value.proposalHashes).size !== value.proposalHashes.length) throw new Error("Merge batch proposalHashes must be unique");
    if (value.identityProposalHashes !== undefined && (!Array.isArray(value.identityProposalHashes) || value.identityProposalHashes.length > 100 || value.identityProposalHashes.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item)) || new Set(value.identityProposalHashes).size !== value.identityProposalHashes.length)) throw new Error("Merge batch identityProposalHashes must contain unique SHA-256 hashes");
    if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > MAX_TOTAL_MERGE_CHANGES) throw new Error(`Merge batch operations must contain one to ${MAX_TOTAL_MERGE_CHANGES} entries`);
    if (!Array.isArray(value.readSet) || value.readSet.length === 0 || value.readSet.length > 100) throw new Error("Merge batch requires one to one hundred readSet entries");
    requireNonEmpty(value.rationale, "batch.rationale");
    // Declared immutable proposals are the evidence boundary. An explicit upsert
    // may intentionally synthesize or rename across those proposals; accept
    // changes use the stricter byte-for-byte proposal lookup in commitWorkerBatch.
    for (const proposalHash of value.proposalHashes) await this.readProposal(outputRoot, runId, proposalHash);
    const readSet = new Map<string, string | null>();
    for (const item of value.readSet) {
      if (!item || typeof item !== "object" || typeof item.artifactId !== "string" || (item.contentHash !== null && (typeof item.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(item.contentHash)))) throw new Error("Merge batch readSet entries require artifactId and SHA-256 contentHash or null");
      assertId(item.artifactId, "batch readSet artifactId");
      if (readSet.has(item.artifactId)) throw new Error(`Merge batch readSet duplicates artifact ${item.artifactId}`);
      readSet.set(item.artifactId, item.contentHash);
    }
    const touched = new Set<string>();
    for (const operation of value.operations) {
      if (!operation || typeof operation !== "object" || !["upsert", "delete"].includes(String((operation as { kind?: unknown }).kind))) throw new Error("Merge batch operations must be upsert or delete");
      const id = operation.kind === "upsert" && operation.artifact && typeof operation.artifact === "object" ? (operation.artifact as { id?: unknown }).id : operation.kind === "delete" ? operation.artifactId : undefined;
      if (typeof id !== "string") throw new Error("Merge batch operation must name an artifact id");
      assertId(id, "batch artifact id");
      if (touched.has(id)) throw new Error(`Merge batch touches artifact ${id} more than once`);
      touched.add(id);
      if (!readSet.has(id)) throw new Error(`Merge batch operation ${id} is missing a readSet entry`);
    }
    const conflictOperations = this.validateConflictOperations(value.conflictOperations);
    return { proposalHashes: [...value.proposalHashes], ...(value.identityProposalHashes?.length ? { identityProposalHashes: [...value.identityProposalHashes] } : {}), readSet: [...readSet.entries()].map(([artifactId, contentHash]) => ({ artifactId, contentHash })), operations: structuredClone(value.operations), ...(value.candidateDispositions ? { candidateDispositions: structuredClone(value.candidateDispositions) } : {}), ...(conflictOperations.length ? { conflictOperations } : {}), rationale: value.rationale };
  }

  private validateConflictOperations(value: unknown): ConflictOperation[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100) throw new Error("Merge batch conflictOperations must be a bounded array");
    const touched = new Set<string>();
    return value.map((operation): ConflictOperation => {
      if (!operation || typeof operation !== "object" || !["create", "resolve", "defer"].includes(String((operation as { kind?: unknown }).kind))) throw new Error("Conflict operation must be create, resolve, or defer");
      const item = operation as ConflictOperation;
      assertId(item.conflictId, "conflictId");
      if (touched.has(item.conflictId)) throw new Error(`Merge batch touches conflict ${item.conflictId} more than once`);
      touched.add(item.conflictId);
      if (item.kind === "create") {
        if (typeof item.blocking !== "boolean" || typeof item.summary !== "string" || !item.summary.trim()) throw new Error("Conflict create requires blocking and summary");
        if (item.identityDecisionId !== undefined) assertId(item.identityDecisionId, "identityDecisionId");
        return structuredClone(item);
      }
      return { kind: item.kind, conflictId: item.conflictId };
    });
  }

  private async validateIdentityEffects(outputRoot: string, canonicalRoot: string, runId: string, stage: StageEnvelope, batch: MergeBatch): Promise<StoredIdentityProposal[]> {
    if (!batch.identityProposalHashes?.length) {
      if (batch.conflictOperations?.some((operation) => operation.kind === "create" && operation.identityDecisionId)) throw new Error("Conflict creates with identityDecisionId require identityProposalHashes");
      return [];
    }
    const packets = await Promise.all(batch.identityProposalHashes.map((identityHash) => this.identities.readIdentityProposal(outputRoot, runId, identityHash)));
    const operations = new Map(batch.operations.map((operation) => [operation.kind === "upsert" ? (operation.artifact as { id: string }).id : operation.artifactId, operation]));
    const existing = new Set((stage.artifacts ?? []).map((artifact) => artifact.id));
    const decisions = new Map<string, IdentityDecision>();
    for (const packet of packets) {
      if (packet.baselineRevision !== (stage.revision ?? 0) || packet.baselineContentHash !== (stage.contentHash ?? null)) {
        throw new Error(`Identity proposal ${packet.contentHash} has a stale canonical baseline`);
      }
      for (const decision of packet.decisions) {
        if (decisions.has(decision.id)) throw new Error(`Identity decision ${decision.id} appears in more than one accepted identity packet`);
        decisions.set(decision.id, decision);
        if (decision.disposition === "create") {
          const operation = operations.get(decision.canonicalId!);
          if (!operation || operation.kind !== "upsert") throw new Error(`Created canonical identity ${decision.canonicalId} requires an upsert in the same batch`);
          if (existing.has(decision.canonicalId!)) throw new Error(`Created canonical identity ${decision.canonicalId} already exists; reconcile it as a match or conflict`);
        }
        if (decision.disposition === "match" && !existing.has(decision.canonicalId!) && !operations.has(decision.canonicalId!)) throw new Error(`Matched canonical identity ${decision.canonicalId} is absent from the declared read set`);
      }
    }
    const identityState = await this.readIdentityState(canonicalRoot);
    for (const packet of packets) {
      for (const decision of packet.decisions) {
        if (decision.disposition !== "create") continue;
        const owner = identityState.owners[decision.canonicalId!];
        if (owner && (owner.proposalHash !== packet.contentHash || owner.decisionId !== decision.id)) throw new Error(`Canonical identity ${decision.canonicalId} is already owned by ${owner.proposalHash}:${owner.decisionId}`);
      }
    }
    for (const operation of batch.conflictOperations ?? []) {
      if (operation.kind === "create") {
        if (operation.identityDecisionId && !decisions.has(operation.identityDecisionId)) throw new Error(`Conflict ${operation.conflictId} cites an identity decision outside this batch`);
        if (identityState.conflicts[operation.conflictId]) throw new Error(`Conflict ${operation.conflictId} already exists`);
      } else if (!identityState.conflicts[operation.conflictId]) throw new Error(`Conflict ${operation.conflictId} does not exist`);
    }
    for (const decision of decisions.values()) {
      if (decision.disposition === "ambiguous" && decision.blocking && !batch.conflictOperations?.some((operation) => operation.kind === "create" && operation.conflictId === decision.conflictId && operation.identityDecisionId === decision.id)) {
        throw new Error(`Blocking ambiguous identity decision ${decision.id} requires a matching conflict create operation`);
      }
    }
    return packets;
  }

  private async readIdentityState(outputRoot: string): Promise<CanonicalIdentityState> {
    const path = identityStatePath(outputRoot);
    if (!existsSync(path)) return { version: 1, kind: "mem-import-identity-state", owners: {}, conflicts: {} };
    const value = JSON.parse(await readFile(path, "utf-8")) as Partial<CanonicalIdentityState>;
    if (value.version !== 1 || value.kind !== "mem-import-identity-state" || !value.owners || !value.conflicts || typeof value.owners !== "object" || typeof value.conflicts !== "object") throw new Error("Invalid canonical identity state");
    return value as CanonicalIdentityState;
  }

  private async applyIdentityEffects(outputRoot: string, batch: MergeBatch, packets: StoredIdentityProposal[]): Promise<void> {
    if (packets.length === 0 && !batch.conflictOperations?.length) return;
    const state = await this.readIdentityState(outputRoot);
    const now = this.now().toISOString();
    for (const packet of packets) {
      for (const decision of packet.decisions) {
        if (decision.disposition !== "create") continue;
        const owner = state.owners[decision.canonicalId!];
        if (owner && (owner.proposalHash !== packet.contentHash || owner.decisionId !== decision.id)) throw new Error(`Canonical identity ${decision.canonicalId} is already owned by ${owner.proposalHash}:${owner.decisionId}`);
        state.owners[decision.canonicalId!] = { proposalHash: packet.contentHash, decisionId: decision.id, provisionalId: decision.provisionalId, createdAt: now };
      }
    }
    for (const operation of batch.conflictOperations ?? []) {
      if (operation.kind === "create") {
        if (state.conflicts[operation.conflictId]) throw new Error(`Conflict ${operation.conflictId} already exists`);
        state.conflicts[operation.conflictId] = { status: "open", blocking: operation.blocking, summary: operation.summary, ...(operation.identityDecisionId ? { identityDecisionId: operation.identityDecisionId } : {}), updatedAt: now };
      } else {
        const conflict = state.conflicts[operation.conflictId];
        if (!conflict) throw new Error(`Conflict ${operation.conflictId} does not exist`);
        conflict.status = operation.kind === "resolve" ? "resolved" : "deferred";
        conflict.updatedAt = now;
      }
    }
    await writeJson(identityStatePath(outputRoot), state);
  }

  private async identityDiagnostics(outputRoot: string): Promise<Array<{ level: "error"; message: string; path: string }>> {
    const state = await this.readIdentityState(outputRoot);
    return Object.entries(state.conflicts)
      .filter(([, conflict]) => conflict.blocking && conflict.status !== "resolved")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([conflictId, conflict]) => ({ level: "error" as const, message: `Blocking identity conflict ${conflictId} remains ${conflict.status}: ${conflict.summary}`, path: `stages/identity/state.json#${conflictId}` }));
  }

  private async readProposal(outputRoot: string, runId: string, proposalHash: string): Promise<{ artifacts: unknown[]; candidateDispositions?: unknown[] }> {
    const directory = proposalDir(outputRoot, runId);
    if (!existsSync(directory)) throw new Error(`Declared proposal ${proposalHash} does not exist`);
    const file = (await readdir(directory)).find((name) => name.endsWith(`-${proposalHash}.json`));
    if (!file) throw new Error(`Declared proposal ${proposalHash} does not exist`);
    const proposal = JSON.parse(await readFile(join(directory, file), "utf-8")) as { runId?: unknown; contentHash?: unknown; artifacts?: unknown; candidateDispositions?: unknown };
    if (proposal.runId !== runId || proposal.contentHash !== proposalHash || !Array.isArray(proposal.artifacts) || (proposal.candidateDispositions !== undefined && !Array.isArray(proposal.candidateDispositions))) throw new Error(`Declared proposal ${proposalHash} is invalid`);
    return { artifacts: proposal.artifacts, ...(proposal.candidateDispositions ? { candidateDispositions: proposal.candidateDispositions } : {}) };
  }

  private assertReadSet(stage: StageEnvelope, readSet: MergeBatch["readSet"]): void {
    const artifacts = new Map((stage.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    for (const item of readSet) {
      const current = artifacts.get(item.artifactId);
      const actual = current ? hash(current) : null;
      if (actual !== item.contentHash) throw new Error(`Stale merge read set for artifact ${item.artifactId}`);
    }
  }

  private applyBatch(before: StageEnvelope, batch: MergeBatch): StageEnvelope {
    const artifacts = new Map((before.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    for (const operation of batch.operations) {
      if (operation.kind === "upsert") artifacts.set((operation.artifact as { id: string }).id, structuredClone(operation.artifact) as NonNullable<StageEnvelope["artifacts"]>[number]);
      else artifacts.delete(operation.artifactId);
    }
    const dispositions = new Map((before.candidateDispositions ?? []).map((disposition) => [`${disposition.unitId ?? ""}:${disposition.candidateId}`, disposition]));
    for (const disposition of batch.candidateDispositions as NonNullable<StageEnvelope["candidateDispositions"]> ?? []) {
      dispositions.set(`${disposition.unitId ?? ""}:${disposition.candidateId}`, disposition);
    }
    return {
      version: 1,
      kind: "merge",
      artifacts: [...artifacts.values()].sort((left, right) => left.id.localeCompare(right.id)),
      candidateDispositions: [...dispositions.values()],
      diagnostics: before.diagnostics ?? [],
    };
  }

  /** Derive durable artifact quotes from model-selected anchors to avoid Unicode transcription drift. */
  private async deriveArtifactProvenanceQuotes(outputRoot: string, stage: StageEnvelope, artifactIds?: Set<string>): Promise<void> {
    for (const artifact of stage.artifacts ?? []) {
      if (artifactIds && !artifactIds.has(artifact.id)) continue;
      for (const ref of artifact.provenance ?? []) {
        const mutable = ref as unknown as Record<string, unknown>;
        if (typeof mutable.unitId !== "string" || typeof mutable.sourceId !== "string" || typeof mutable.startAnchor !== "string" || typeof mutable.endAnchor !== "string") continue;
        const unit = await readNormalizedUnit(outputRoot, mutable.unitId);
        if (unit.sourceId !== mutable.sourceId) continue;
        const start = unit.blocks.findIndex((block) => block.anchor === mutable.startAnchor);
        const end = unit.blocks.findIndex((block) => block.anchor === mutable.endAnchor);
        if (start < 0 || end < start) continue;
        mutable.quote = unit.blocks.slice(start, end + 1).map((block) => block.text).join("\n\n");
      }
    }
  }

  private async assertLiteralArtifactProvenance(outputRoot: string, stage: StageEnvelope, artifactIds?: Set<string>): Promise<void> {
    for (const artifact of stage.artifacts ?? []) {
      if (artifactIds && !artifactIds.has(artifact.id)) continue;
      for (const [index, ref] of artifact.provenance.entries()) {
        const unit = await readNormalizedUnit(outputRoot, ref.unitId);
        if (unit.sourceId !== ref.sourceId) throw new Error(`Artifact ${artifact.id} provenance[${index}] sourceId does not match normalized source`);
        const start = unit.blocks.findIndex((block) => block.anchor === ref.startAnchor);
        const end = unit.blocks.findIndex((block) => block.anchor === ref.endAnchor);
        if (start < 0 || end < start) throw new Error(`Artifact ${artifact.id} provenance[${index}] has invalid local anchors`);
        const sourceRange = unit.blocks.slice(start, end + 1).map((block) => block.text).join("\n\n");
        if (!ref.quote || !sourceRange.includes(ref.quote)) throw new Error(`Artifact ${artifact.id} provenance[${index}].quote must be a literal contiguous excerpt of normalized source text`);
      }
    }
  }

  private async extractionHash(outputRoot: string): Promise<string> {
    const stages = await readExtractionStages(outputRoot);
    return hash(stages.map((stage) => ({ unitId: stage.unitId, contentHash: hash(stage) })).sort((a, b) => (a.unitId ?? "").localeCompare(b.unitId ?? "")));
  }

  private revisionReceiptPath(outputRoot: string, revision: number, contentHash: string): string {
    const revisionReceipt = revisionPath(outputRoot, revision, contentHash);
    return existsSync(revisionReceipt) ? revisionReceipt : transactionPath(outputRoot, revision, contentHash);
  }

  private async findRevisionReceipt(outputRoot: string, revision: number, contentHash: string): Promise<boolean> {
    return existsSync(revisionPath(outputRoot, revision, contentHash)) || existsSync(transactionPath(outputRoot, revision, contentHash));
  }

  private async persistTransactionArtifacts(outputRoot: string, stage: StageEnvelope, operations: MergeBatch["operations"]): Promise<StoredTransactionOperation[]> {
    const artifacts = new Map((stage.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    return Promise.all(operations.map(async (operation): Promise<StoredTransactionOperation> => {
      if (operation.kind === "delete") return { kind: "delete", artifactId: operation.artifactId };
      const id = (operation.artifact as { id: string }).id;
      const artifact = artifacts.get(id);
      if (!artifact) throw new Error(`Canonical artifact ${id} disappeared while recording transaction`);
      const artifactRef = hash(artifact);
      const path = artifactBlobPath(outputRoot, artifactRef);
      if (!existsSync(path)) await writeJson(path, artifact);
      return { kind: "upsert", artifactRef };
    }));
  }

  private async readRevisionStage(outputRoot: string, revision: number, contentHash: string, current: MergeState): Promise<StageEnvelope> {
    if (current.revision === revision && current.contentHash === contentHash) return current.stage;
    const reconstructed = await this.reconstructRevision(outputRoot, revision);
    if (reconstructed.contentHash !== contentHash) throw new Error("Review packet merge receipt content hash does not match reconstruction");
    return reconstructed.stage;
  }

  /** Replays immutable delta receipts from the nearest bounded checkpoint. */
  private async reconstructRevision(outputRoot: string, targetRevision: number): Promise<MergeState> {
    if (!Number.isInteger(targetRevision) || targetRevision < 1) throw new Error("Merge revision must be a positive integer");
    let state = await this.readNearestCheckpoint(outputRoot, targetRevision) ?? { stage: emptyStage(), revision: 0, contentHash: null };
    for (let revision = state.revision + 1; revision <= targetRevision; revision++) {
      const receipt = await this.readReceiptAtRevision(outputRoot, revision);
      if (receipt.parentContentHash !== state.contentHash) throw new Error(`Merge revision ${revision} does not link to the reconstructed parent`);
      if (receipt.kind === "mem-import-merge-revision") {
        if (!receipt.stage || typeof receipt.stage !== "object" || Array.isArray(receipt.stage)) throw new Error(`Merge revision ${revision} is missing its checkpoint stage`);
        state = { stage: receipt.stage as StageEnvelope, revision, contentHash: receipt.contentHash as string, ...(receipt.parentContentHash ? { parentContentHash: receipt.parentContentHash as string } : {}) };
      } else if (receipt.kind === "mem-import-merge-transaction") {
        const stage = await this.applyStoredTransaction(outputRoot, state.stage, receipt as StoredTransactionReceipt);
        const calculated = hash(semanticStage(stage));
        if (calculated !== receipt.contentHash) throw new Error(`Merge transaction ${revision} does not reconstruct to its content hash`);
        state = { stage: { ...stage, revision, contentHash: receipt.contentHash as string, ...(receipt.parentContentHash ? { parentContentHash: receipt.parentContentHash as string } : {}) }, revision, contentHash: receipt.contentHash as string, ...(receipt.parentContentHash ? { parentContentHash: receipt.parentContentHash as string } : {}) };
      } else throw new Error(`Merge revision ${revision} has an unknown receipt kind`);
    }
    return state;
  }

  private async readNearestCheckpoint(outputRoot: string, targetRevision: number): Promise<MergeState | undefined> {
    const directory = join(outputRoot, "stages", "merge", "checkpoints");
    if (!existsSync(directory)) return undefined;
    const candidates = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    let best: MergeCheckpoint | undefined;
    for (const name of candidates) {
      const value = JSON.parse(await readFile(join(directory, name), "utf-8")) as Partial<MergeCheckpoint>;
      if (value.version !== 1 || value.kind !== "mem-import-merge-checkpoint" || !Number.isInteger(value.revision) || value.revision! > targetRevision || typeof value.contentHash !== "string" || !value.stage || typeof value.stage !== "object" || Array.isArray(value.stage)) continue;
      if (!best || value.revision! > best.revision) best = value as MergeCheckpoint;
    }
    if (!best) return undefined;
    if (hash(semanticStage(best.stage)) !== best.contentHash) throw new Error(`Merge checkpoint ${best.revision} has invalid semantic content hash`);
    return { stage: best.stage, revision: best.revision, contentHash: best.contentHash, ...(best.stage.parentContentHash ? { parentContentHash: best.stage.parentContentHash } : {}) };
  }

  private async readReceiptAtRevision(outputRoot: string, revision: number): Promise<Record<string, unknown>> {
    const prefix = `${String(revision).padStart(8, "0")}-`;
    const paths = [join(outputRoot, "stages", "merge", "revisions"), join(outputRoot, "stages", "merge", "transactions")];
    const matches: string[] = [];
    for (const directory of paths) {
      if (!existsSync(directory)) continue;
      for (const name of await readdir(directory)) if (name.startsWith(prefix) && name.endsWith(".json")) matches.push(join(directory, name));
    }
    if (matches.length !== 1) throw new Error(`Expected exactly one immutable receipt for merge revision ${revision}`);
    const receipt = JSON.parse(await readFile(matches[0]!, "utf-8")) as Record<string, unknown>;
    if (receipt.revision !== revision || typeof receipt.contentHash !== "string" || (receipt.parentContentHash !== null && typeof receipt.parentContentHash !== "string")) throw new Error(`Merge revision ${revision} receipt is invalid`);
    return receipt;
  }

  private async applyStoredTransaction(outputRoot: string, before: StageEnvelope, receipt: StoredTransactionReceipt): Promise<StageEnvelope> {
    if (!Array.isArray(receipt.operations)) throw new Error(`Merge transaction ${receipt.revision} has invalid operations`);
    const artifacts = new Map((before.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    for (const operation of receipt.operations) {
      if (operation.kind === "delete" && typeof operation.artifactId === "string") artifacts.delete(operation.artifactId);
      else if (operation.kind === "upsert" && typeof operation.artifactRef === "string" && /^[a-f0-9]{64}$/.test(operation.artifactRef)) {
        const path = artifactBlobPath(outputRoot, operation.artifactRef);
        if (!existsSync(path)) throw new Error(`Merge transaction ${receipt.revision} references missing artifact content ${operation.artifactRef}`);
        const artifact = JSON.parse(await readFile(path, "utf-8")) as NonNullable<StageEnvelope["artifacts"]>[number];
        if (!artifact || typeof artifact.id !== "string" || hash(artifact) !== operation.artifactRef) throw new Error(`Merge transaction ${receipt.revision} references invalid artifact content ${operation.artifactRef}`);
        artifacts.set(artifact.id, artifact);
      } else throw new Error(`Merge transaction ${receipt.revision} has invalid operation`);
    }
    const dispositions = new Map((before.candidateDispositions ?? []).map((disposition) => [`${disposition.unitId ?? ""}:${disposition.candidateId}`, disposition]));
    for (const disposition of receipt.candidateDispositions ?? []) dispositions.set(`${disposition.unitId ?? ""}:${disposition.candidateId}`, disposition);
    return { version: 1, kind: "merge", artifacts: [...artifacts.values()].sort((left, right) => left.id.localeCompare(right.id)), candidateDispositions: [...dispositions.values()], diagnostics: before.diagnostics ?? [] };
  }

  private assertReviewReadSet(stage: StageEnvelope, readSet: ReviewPacket["readSet"]): void {
    if (!readSet) return;
    const artifacts = new Map((stage.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    for (const item of readSet) {
      const current = artifacts.get(item.artifactId);
      const actual = current ? hash(current) : null;
      if (actual !== item.contentHash) throw new Error(`Review readSet does not match reviewed revision for artifact ${item.artifactId}`);
    }
  }

  private async reviewPackets(directory: string): Promise<Array<{ path: string; packet: { reviewedMergeRevision?: unknown; reviewedMergeHash?: unknown; readSet?: ReviewPacket["readSet"]; contentHash?: unknown } }>> {
    if (!existsSync(directory)) return [];
    const entries = await readdir(directory, { withFileTypes: true });
    const packets: Array<{ path: string; packet: { reviewedMergeRevision?: unknown; reviewedMergeHash?: unknown; readSet?: ReviewPacket["readSet"]; contentHash?: unknown } }> = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) packets.push(...await this.reviewPackets(path));
      else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "validity.json") {
        const packet = JSON.parse(await readFile(path, "utf-8")) as { reviewedMergeRevision?: unknown; reviewedMergeHash?: unknown; readSet?: ReviewPacket["readSet"]; contentHash?: unknown };
        if (typeof packet.reviewedMergeRevision === "number" && typeof packet.reviewedMergeHash === "string") packets.push({ path, packet });
      }
    }
    return packets;
  }

  private async refreshReviewValidity(outputRoot: string, stage: StageEnvelope): Promise<void> {
    const directory = join(outputRoot, "stages", "reviews");
    const packets = await this.reviewPackets(directory);
    const artifacts = new Map((stage.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    const entries = packets.map(({ path, packet }) => {
      const readSet = packet.readSet;
      const readSetChanged = readSet?.some((item) => (artifacts.get(item.artifactId) ? hash(artifacts.get(item.artifactId)) : null) !== item.contentHash) ?? false;
      const sameRoot = packet.reviewedMergeRevision === stage.revision && packet.reviewedMergeHash === stage.contentHash;
      return {
        path: this.relative(outputRoot, path),
        ...(typeof packet.contentHash === "string" ? { contentHash: packet.contentHash } : {}),
        reviewedMergeRevision: packet.reviewedMergeRevision,
        reviewedMergeHash: packet.reviewedMergeHash,
        status: !readSet ? "unscoped" : readSetChanged ? "stale" : sameRoot ? "current" : "unaffected",
      };
    });
    await writeJson(reviewValidityPath(outputRoot), { version: 1, kind: "mem-import-review-validity", merge: { revision: stage.revision ?? 0, contentHash: stage.contentHash ?? null }, updatedAt: this.now().toISOString(), entries });
  }

  private validateReviewPacket(value: unknown): ReviewPacket {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Review packet must be an object");
    const packet = value as ReviewPacket;
    if (packet.version !== 1 || packet.kind !== "mem-import-review") throw new Error("Review packet must be version-1 mem-import-review");
    assertId(packet.checkpointId, "packet.checkpointId");
    if (!Number.isInteger(packet.reviewedMergeRevision) || packet.reviewedMergeRevision < 1) throw new Error("packet.reviewedMergeRevision must be a positive integer");
    if (!/^[a-f0-9]{64}$/.test(packet.reviewedMergeHash)) throw new Error("packet.reviewedMergeHash must be a SHA-256 hex string");
    if (!Array.isArray(packet.findings) || !Array.isArray(packet.requestedActions)) throw new Error("Review packet findings and requestedActions must be arrays");
    if (packet.readSet !== undefined) {
      if (!Array.isArray(packet.readSet) || packet.readSet.length > 100) throw new Error("Review packet readSet must contain at most one hundred entries");
      const artifacts = new Set<string>();
      for (const item of packet.readSet) {
        if (!item || typeof item !== "object" || typeof item.artifactId !== "string" || (item.contentHash !== null && (typeof item.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(item.contentHash)))) throw new Error("Review readSet entries require artifactId and SHA-256 contentHash or null");
        assertId(item.artifactId, "review readSet artifactId");
        if (artifacts.has(item.artifactId)) throw new Error(`Duplicate review readSet artifact ${item.artifactId}`);
        artifacts.add(item.artifactId);
      }
    }
    const ids = new Set<string>();
    for (const item of [...packet.findings, ...packet.requestedActions]) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.summary !== "string" || !item.id.trim() || !item.summary.trim()) throw new Error("Review findings/actions require non-empty id and summary");
      if (ids.has(item.id)) throw new Error(`Duplicate review finding/action id ${item.id}`);
      ids.add(item.id);
    }
    return packet;
  }

  private async collectChecks(outputRoot: string) {
    const [deterministic, lint, coverage, provenance] = await Promise.all([
      deterministicWorldImportChecks(outputRoot),
      lintWorldImport(outputRoot),
      buildCoveragePlan(outputRoot),
      provenanceAudit({ outputRoot }),
    ]);
    return { deterministic, lint, coverage, provenance };
  }

  private async recordEvent(outputRoot: string, kind: string, event: Record<string, unknown>): Promise<void> {
    await writeJson(eventPath(outputRoot, kind), { version: 1, kind: `mem-import-${kind}-event`, at: this.now().toISOString(), ...event });
  }

  private async updateAudit(outputRoot: string, runId: string, effect?: MemImportRunAuditV2["effects"][number], update: Partial<MemImportRunAuditV2> = {}): Promise<MemImportRunAuditV2> {
    let manifest: Awaited<ReturnType<typeof readManifest>> | undefined;
    try { manifest = await readManifest(outputRoot); } catch { manifest = undefined; }
    const source = manifest ? { normalizedUnits: manifest.units.length, manifestHash: hash(manifest) } : { normalizedUnits: 0, manifestHash: "unavailable" };
    let audit: MemImportRunAuditV2;
    if (existsSync(importRunPath(outputRoot))) {
      const existing = JSON.parse(await readFile(importRunPath(outputRoot), "utf-8")) as Partial<MemImportRunAuditV2>;
      if (existing.version === 2 && existing.kind === "mem-import-run" && existing.runId === runId && Array.isArray(existing.effects)) audit = existing as MemImportRunAuditV2;
      else audit = { version: 2, kind: "mem-import-run", runId, status: "running", createdAt: this.now().toISOString(), source, effects: [] };
    } else audit = { version: 2, kind: "mem-import-run", runId, status: "running", createdAt: this.now().toISOString(), source, effects: [] };
    const next: MemImportRunAuditV2 = { ...audit, ...update, effects: effect ? [...audit.effects, effect] : audit.effects };
    await writeJson(importRunPath(outputRoot), next);
    return next;
  }

  private canonicalRoot(run: { outputRoot: string; compendiumRoot?: string }): string {
    return run.compendiumRoot ?? run.outputRoot;
  }

  private relative(outputRoot: string, path: string): string {
    return path.startsWith(`${outputRoot}/`) ? path.slice(outputRoot.length + 1) : path;
  }
}
