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
import { MemImportService, type AssignmentRole, type MemImportAssignmentRecord, type MemImportCapability } from "./service.js";

const LEASE_HEARTBEAT_MS = 60_000;
const LEASE_EXPIRY_MS = 5 * 60_000;

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

export type MergeInventoryEntry = {
  id: string;
  group: string;
  title: string;
  type?: string;
  tags?: string[];
};

export type MergeInventoryResult = {
  revision: number;
  contentHash: string | null;
  totalArtifacts: number;
  entries: MergeInventoryEntry[];
  truncated: boolean;
  continuationCursor?: string;
};

type MergeInventoryCursor = { version: 1; revision: number; contentHash: string | null; group?: string; afterId: string };

export type MergeLeaseResult = { fence: number; expiresAt: string; heartbeatEveryMs: number };
export type MergeBatch = {
  proposalHashes: string[];
  operations: Array<{ kind: "upsert"; artifact: unknown } | { kind: "delete"; artifactId: string }>;
  candidateDispositions?: unknown[];
  rationale: string;
};
export type ReviewPacket = {
  version: 1;
  kind: "mem-import-review";
  checkpointId: string;
  reviewedMergeRevision: number;
  reviewedMergeHash: string;
  findings: Array<{ id: string; severity: "info" | "warning" | "repair" | "critical"; summary: string; sourceRefs?: unknown[]; requestedActionIds?: string[] }>;
  requestedActions: Array<{ id: string; type: string; severity: "info" | "warning" | "repair" | "critical"; summary: string; rationale?: string; sourceRefs?: unknown[] }>;
  diagnostics?: Array<{ level: "info" | "warning" | "error"; message: string }>;
  metadata?: Record<string, unknown>;
};

function orchestrationDir(outputRoot: string): string { return join(outputRoot, "stages", "orchestration"); }
function leaseDir(outputRoot: string): string { return join(orchestrationDir(outputRoot), "locks", "merge-writer"); }
function leasePath(outputRoot: string): string { return join(leaseDir(outputRoot), "lease.json"); }
function fencePath(outputRoot: string): string { return join(orchestrationDir(outputRoot), "merge-fence.json"); }
function revisionPath(outputRoot: string, revision: number, contentHash: string): string { return join(outputRoot, "stages", "merge", "revisions", `${String(revision).padStart(8, "0")}-${contentHash}.json`); }
function transactionPath(outputRoot: string, revision: number, contentHash: string): string { return join(outputRoot, "stages", "merge", "transactions", `${String(revision).padStart(8, "0")}-${contentHash}.json`); }
function proposalDir(outputRoot: string, runId: string): string { return join(outputRoot, "stages", "runs", runId, "proposals"); }
function eventPath(outputRoot: string, kind: string): string { return join(orchestrationDir(outputRoot), "events", `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}-${randomBytes(6).toString("hex")}.json`); }
function reviewPath(outputRoot: string, checkpointId: string, taskId: string, hash: string): string { return join(outputRoot, "stages", "reviews", checkpointId, `${taskId}-${hash}.json`); }

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
  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {}

  async mergeState(options: CoordinatorAuthority): Promise<MergeState> {
    const run = await this.base.authorizeCoordinator(options);
    return this.readMergeState(run.outputRoot);
  }

  async readMergeForWorker(options: WorkerAuthority): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    return this.readMergeState(assignment.outputRoot);
  }

  async mergeInventory(options: CoordinatorAuthority & { group?: string; continuationCursor?: string; maxItems?: number }): Promise<MergeInventoryResult> {
    const run = await this.base.authorizeCoordinator(options);
    return this.inventoryMerge(run.outputRoot, options);
  }

  async readMergeInventoryForWorker(options: WorkerAuthority & { group?: string; continuationCursor?: string; maxItems?: number }): Promise<MergeInventoryResult> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    return this.inventoryMerge(assignment.outputRoot, options);
  }

  async readMergeArtifactForWorker(options: WorkerAuthority & { artifactId: string }): Promise<{ revision: number; contentHash: string | null; artifact?: NonNullable<StageEnvelope["artifacts"]>[number] }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    assertId(options.artifactId, "artifactId");
    const state = await this.readMergeState(assignment.outputRoot);
    return { revision: state.revision, contentHash: state.contentHash, ...(state.stage.artifacts?.find((artifact) => artifact.id === options.artifactId) ? { artifact: state.stage.artifacts.find((artifact) => artifact.id === options.artifactId)! } : {}) };
  }

  async acquireCoordinatorLease(options: CoordinatorAuthority & { taskId: string }): Promise<MergeLeaseResult> {
    const run = await this.base.authorizeCoordinator(options);
    assertId(options.taskId, "taskId");
    return this.acquireLease(run.outputRoot, run.runId, { kind: "coordinator", taskId: options.taskId });
  }

  async acquireWorkerLease(options: WorkerAuthority): Promise<MergeLeaseResult> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:lease" });
    if (assignment.role !== "merger" && assignment.role !== "repairer") throw new Error("Only merger or repairer assignments may acquire the global merge lease");
    return this.acquireLease(assignment.outputRoot, assignment.runId, { kind: "worker", taskId: assignment.taskId, role: assignment.role });
  }

  async heartbeatCoordinatorLease(options: CoordinatorAuthority & { taskId: string; fence: number }): Promise<MergeLeaseResult> {
    const run = await this.base.authorizeCoordinator(options);
    return this.heartbeatLease(run.outputRoot, run.runId, { kind: "coordinator", taskId: options.taskId }, options.fence);
  }

  async heartbeatWorkerLease(options: WorkerAuthority & { fence: number }): Promise<MergeLeaseResult> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:lease" });
    return this.heartbeatLease(assignment.outputRoot, assignment.runId, { kind: "worker", taskId: assignment.taskId, role: assignment.role }, options.fence);
  }

  async releaseCoordinatorLease(options: CoordinatorAuthority & { taskId: string; fence: number }): Promise<void> {
    const run = await this.base.authorizeCoordinator(options);
    await this.releaseLease(run.outputRoot, run.runId, { kind: "coordinator", taskId: options.taskId }, options.fence);
  }

  async releaseWorkerLease(options: WorkerAuthority & { fence: number }): Promise<void> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:lease" });
    await this.releaseLease(assignment.outputRoot, assignment.runId, { kind: "worker", taskId: assignment.taskId, role: assignment.role }, options.fence);
  }

  async writeCoordinatorMerge(options: CoordinatorAuthority & { taskId: string; fence: number; expectedRevision: number; expectedContentHash: string | null; stage: unknown; rationale: string; checkpointId?: string; actionIds?: string[] }): Promise<MergeState> {
    const run = await this.base.authorizeCoordinator(options);
    const { outputRoot: _outputRoot, runId: _runId, coordinatorGrant: _coordinatorGrant, ...mutation } = options;
    return this.writeMerge({ outputRoot: run.outputRoot, runId: run.runId, actor: { kind: "coordinator", taskId: options.taskId }, ...mutation });
  }

  async writeWorkerMerge(options: WorkerAuthority & { fence: number; expectedRevision: number; expectedContentHash: string | null; stage: unknown; rationale: string; checkpointId?: string; actionIds?: string[] }): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:write", checkpointId: options.checkpointId, actionIds: options.actionIds });
    if (assignment.role !== "merger" && assignment.role !== "repairer") throw new Error("Only merger or repairer assignments may mutate merge state");
    if (assignment.role === "repairer" && (!options.checkpointId || !options.actionIds?.length)) throw new Error("Repairer mutations must cite assigned checkpointId and actionIds");
    const { outputRoot: _outputRoot, runId: _runId, taskId: _taskId, grant: _grant, ...mutation } = options;
    return this.writeMerge({ outputRoot: assignment.outputRoot, runId: assignment.runId, actor: { kind: "worker", taskId: assignment.taskId, role: assignment.role }, ...mutation });
  }

  /** Apply a small proposal-backed artifact delta; normal mergers cannot use repair scope here. */
  async applyWorkerBatch(options: WorkerAuthority & { fence: number; expectedRevision: number; expectedContentHash: string | null; batch: MergeBatch }): Promise<MergeState> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:write", role: "merger" });
    const batch = await this.validateBatch(assignment.outputRoot, assignment.runId, options.batch);
    const before = await this.readMergeState(assignment.outputRoot);
    if (before.revision !== options.expectedRevision || before.contentHash !== options.expectedContentHash) throw new Error(`Stale merge compare-and-swap: expected revision/hash ${options.expectedRevision}/${options.expectedContentHash ?? "absent"}, current is ${before.revision}/${before.contentHash ?? "absent"}`);
    const stage = this.applyBatch(before.stage, batch);
    return this.writeMerge({
      outputRoot: assignment.outputRoot,
      runId: assignment.runId,
      actor: { kind: "worker", taskId: assignment.taskId, role: assignment.role },
      fence: options.fence,
      expectedRevision: options.expectedRevision,
      expectedContentHash: options.expectedContentHash,
      stage,
      rationale: batch.rationale,
      transaction: { proposalHashes: batch.proposalHashes, operations: batch.operations },
    });
  }

  async submitReview(options: WorkerAuthority & { packet: ReviewPacket }): Promise<{ path: string; contentHash: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "review:submit", role: "reviewer" });
    const packet = this.validateReviewPacket(options.packet);
    const state = await this.readMergeState(assignment.outputRoot);
    const receipt = await this.findRevisionReceipt(assignment.outputRoot, packet.reviewedMergeRevision, packet.reviewedMergeHash);
    if (!receipt && !(state.revision === packet.reviewedMergeRevision && state.contentHash === packet.reviewedMergeHash)) {
      throw new Error("Review packet must bind to an existing immutable merge revision");
    }
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
    await this.recordEvent(assignment.outputRoot, "review", { runId: assignment.runId, taskId: assignment.taskId, path: this.relative(assignment.outputRoot, path), contentHash, mergeRevision: packet.reviewedMergeRevision, mergeHash: packet.reviewedMergeHash });
    await this.updateAudit(assignment.outputRoot, assignment.runId, { kind: "review", path: this.relative(assignment.outputRoot, path), contentHash, at: this.now().toISOString(), taskId: assignment.taskId });
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

  async checks(options: CoordinatorAuthority): Promise<{ deterministic: Awaited<ReturnType<typeof deterministicWorldImportChecks>>; lint: Awaited<ReturnType<typeof lintWorldImport>>; coverage: Awaited<ReturnType<typeof buildCoveragePlan>>; provenance: Awaited<ReturnType<typeof provenanceAudit>> }> {
    const run = await this.base.authorizeCoordinator(options);
    return this.collectChecks(run.outputRoot);
  }

  async finalize(options: CoordinatorAuthority & { taskId: string; fence: number }): Promise<{ finalized: boolean; auditPath: string; checksPath: string; errors: number; warnings: number }> {
    const run = await this.base.authorizeCoordinator(options);
    await this.requireLease(run.outputRoot, run.runId, { kind: "coordinator", taskId: options.taskId }, options.fence);
    await emitWorldLibrary(run.outputRoot);
    const checks = await this.collectChecks(run.outputRoot);
    const diagnostics = [
      ...checks.lint.diagnostics,
      ...checks.coverage.recommendations,
      ...checks.coverage.unitCoverage.flatMap((unit) => unit.diagnostics),
      ...checks.provenance.diagnostics,
      ...checks.deterministic.checks.flatMap((check) => check.diagnostics ?? []),
    ];
    const errors = diagnostics.filter((item) => item.level === "error").length;
    const warnings = diagnostics.filter((item) => item.level === "warning").length;
    const state = await this.readMergeState(run.outputRoot);
    if (!state.contentHash) throw new Error("Cannot finalize before a canonical merge revision exists");
    const checksPath = join(run.outputRoot, "stages", "checks", `final-${String(state.revision).padStart(8, "0")}-${state.contentHash}.json`);
    await writeJson(checksPath, { version: 1, kind: "mem-import-final-checks", runId: run.runId, merge: { revision: state.revision, contentHash: state.contentHash }, createdAt: this.now().toISOString(), errors, warnings, checks });
    const receiptPath = this.relative(run.outputRoot, this.revisionReceiptPath(run.outputRoot, state.revision, state.contentHash));
    const audit = await this.updateAudit(run.outputRoot, run.runId, {
      kind: "finalization",
      path: this.relative(run.outputRoot, checksPath),
      contentHash: hash({ errors, warnings, state }),
      at: this.now().toISOString(),
      taskId: options.taskId,
    }, {
      status: errors === 0 ? "finalized" : "failed",
      finalizedAt: this.now().toISOString(),
      merge: { revision: state.revision, contentHash: state.contentHash, revisionReceiptPath: receiptPath },
      finalization: { passed: errors === 0, errorCount: errors, warningCount: warnings, checksPath: this.relative(run.outputRoot, checksPath) },
    });
    await this.recordEvent(run.outputRoot, "finalization", { runId: run.runId, taskId: options.taskId, mergeRevision: state.revision, mergeHash: state.contentHash, checksPath: this.relative(run.outputRoot, checksPath), errors, warnings, status: audit.status });
    return { finalized: errors === 0, auditPath: "stages/import-run.json", checksPath: this.relative(run.outputRoot, checksPath), errors, warnings };
  }

  private async writeMerge(options: { outputRoot: string; runId: string; actor: MergeActor; fence: number; expectedRevision: number; expectedContentHash: string | null; stage: unknown; rationale: string; checkpointId?: string; actionIds?: string[]; transaction?: Pick<MergeBatch, "proposalHashes" | "operations"> }): Promise<MergeState> {
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
    await this.deriveArtifactProvenanceQuotes(options.outputRoot, submitted);
    const contentHash = hash(submitted);
    const stage: StageEnvelope = { ...submitted, revision: before.revision + 1, contentHash, ...(before.contentHash ? { parentContentHash: before.contentHash } : {}) };
    const { validateStageEnvelope } = await import("../world-import/staging.js");
    validateStageEnvelope(stage, { requireArtifacts: true });
    await this.assertLiteralArtifactProvenance(options.outputRoot, stage);
    const extractionHash = await this.extractionHash(options.outputRoot);
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
      operations: options.transaction.operations,
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
    await writeMergeStage(options.outputRoot, stage);
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
    if (!Array.isArray(value.proposalHashes) || value.proposalHashes.length === 0 || value.proposalHashes.length > 12 || value.proposalHashes.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new Error("Merge batch requires one to twelve SHA-256 proposalHashes");
    if (new Set(value.proposalHashes).size !== value.proposalHashes.length) throw new Error("Merge batch proposalHashes must be unique");
    if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > 12) throw new Error("Merge batch requires one to twelve operations");
    requireNonEmpty(value.rationale, "batch.rationale");
    const proposedArtifactIds = new Set<string>();
    for (const proposalHash of value.proposalHashes) {
      const proposal = await this.readProposal(outputRoot, runId, proposalHash);
      for (const artifact of proposal.artifacts) if (artifact && typeof artifact === "object" && typeof (artifact as { id?: unknown }).id === "string") proposedArtifactIds.add((artifact as { id: string }).id);
    }
    const touched = new Set<string>();
    for (const operation of value.operations) {
      if (!operation || typeof operation !== "object" || !["upsert", "delete"].includes(String((operation as { kind?: unknown }).kind))) throw new Error("Merge batch operations must be upsert or delete");
      const id = operation.kind === "upsert" && operation.artifact && typeof operation.artifact === "object" ? (operation.artifact as { id?: unknown }).id : operation.kind === "delete" ? operation.artifactId : undefined;
      if (typeof id !== "string") throw new Error("Merge batch operation must name an artifact id");
      assertId(id, "batch artifact id");
      if (touched.has(id)) throw new Error(`Merge batch touches artifact ${id} more than once`);
      touched.add(id);
      if (operation.kind === "upsert" && !proposedArtifactIds.has(id)) throw new Error(`Merge batch upsert ${id} is not supported by a declared proposal`);
    }
    return { proposalHashes: [...value.proposalHashes], operations: structuredClone(value.operations), ...(value.candidateDispositions ? { candidateDispositions: structuredClone(value.candidateDispositions) } : {}), rationale: value.rationale };
  }

  private async readProposal(outputRoot: string, runId: string, proposalHash: string): Promise<{ artifacts: unknown[] }> {
    const directory = proposalDir(outputRoot, runId);
    if (!existsSync(directory)) throw new Error(`Declared proposal ${proposalHash} does not exist`);
    const file = (await readdir(directory)).find((name) => name.endsWith(`-${proposalHash}.json`));
    if (!file) throw new Error(`Declared proposal ${proposalHash} does not exist`);
    const proposal = JSON.parse(await readFile(join(directory, file), "utf-8")) as { runId?: unknown; contentHash?: unknown; artifacts?: unknown };
    if (proposal.runId !== runId || proposal.contentHash !== proposalHash || !Array.isArray(proposal.artifacts)) throw new Error(`Declared proposal ${proposalHash} is invalid`);
    return { artifacts: proposal.artifacts };
  }

  private applyBatch(before: StageEnvelope, batch: MergeBatch): StageEnvelope {
    const artifacts = new Map((before.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
    for (const operation of batch.operations) {
      if (operation.kind === "upsert") artifacts.set((operation.artifact as { id: string }).id, structuredClone(operation.artifact) as NonNullable<StageEnvelope["artifacts"]>[number]);
      else artifacts.delete(operation.artifactId);
    }
    return {
      version: 1,
      kind: "merge",
      artifacts: [...artifacts.values()].sort((left, right) => left.id.localeCompare(right.id)),
      candidateDispositions: batch.candidateDispositions as StageEnvelope["candidateDispositions"] ?? before.candidateDispositions ?? [],
      diagnostics: before.diagnostics ?? [],
    };
  }

  /** Derive durable artifact quotes from model-selected anchors to avoid Unicode transcription drift. */
  private async deriveArtifactProvenanceQuotes(outputRoot: string, stage: StageEnvelope): Promise<void> {
    for (const artifact of stage.artifacts ?? []) {
      for (const ref of artifact.provenance ?? []) {
        const mutable = ref as unknown as Record<string, unknown>;
        if (mutable.quote !== undefined && mutable.quote !== "") continue;
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

  private async assertLiteralArtifactProvenance(outputRoot: string, stage: StageEnvelope): Promise<void> {
    for (const artifact of stage.artifacts ?? []) {
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

  private validateReviewPacket(value: unknown): ReviewPacket {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Review packet must be an object");
    const packet = value as ReviewPacket;
    if (packet.version !== 1 || packet.kind !== "mem-import-review") throw new Error("Review packet must be version-1 mem-import-review");
    assertId(packet.checkpointId, "packet.checkpointId");
    if (!Number.isInteger(packet.reviewedMergeRevision) || packet.reviewedMergeRevision < 1) throw new Error("packet.reviewedMergeRevision must be a positive integer");
    if (!/^[a-f0-9]{64}$/.test(packet.reviewedMergeHash)) throw new Error("packet.reviewedMergeHash must be a SHA-256 hex string");
    if (!Array.isArray(packet.findings) || !Array.isArray(packet.requestedActions)) throw new Error("Review packet findings and requestedActions must be arrays");
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

  private relative(outputRoot: string, path: string): string {
    return path.startsWith(`${outputRoot}/`) ? path.slice(outputRoot.length + 1) : path;
  }
}
