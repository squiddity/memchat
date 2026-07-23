import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { extractionStagePath, mergedCandidatesPath, readManifest, readMergeStage, writeJson } from "../world-import/staging.js";
import type { StageEnvelope } from "../world-import/types.js";
import { canonicalHash, assertMemImportId } from "./identity-service.js";
import { MemImportService } from "./service.js";

type CoordinatorAuthority = { outputRoot: string; runId: string; coordinatorGrant: string };

export type ClusterPlanCandidate = { unitId: string; candidateId: string; group: string; title: string };
export type ClusterPlanCluster = { id: string; label: string; kind: "identity" | "coherent"; candidateIds: string[]; rationale: string };
export type CanonicalDependency = { artifactId: string; contentHash: string | null };
export type ClusterPlanReconciliationSet = { id: string; clusterIds: string[]; canonicalDependencies?: CanonicalDependency[]; rationale: string };

export type ClusterPlanArtifact = {
  version: 1;
  kind: "mem-import-cluster-plan";
  id: string;
  runId: string;
  extractionSnapshotHash: string;
  baselineRevision: number;
  baselineContentHash: string | null;
  clusters: ClusterPlanCluster[];
  reconciliationSets: ClusterPlanReconciliationSet[];
  rationale: string;
  planHash: string;
  submittedAt: string;
};

type CandidateSnapshot = {
  snapshotHash: string;
  entries: ClusterPlanCandidate[];
  baselineRevision: number;
  baselineContentHash: string | null;
};

type InventoryCursor = { version: 1; kind: "cluster-candidate-inventory"; snapshotHash: string; baselineRevision: number; baselineContentHash: string | null; offset: number };
type StatusCursor = { version: 1; kind: "cluster-plan-status"; planHash: string; statusHash: string; offset: number };

export type ClusterPlanStatusEntry =
  | { kind: "cluster"; clusterId: string; label: string; clusterKind: "identity" | "coherent"; candidateCount: number; status: "pending" | "proposed"; proposalHash?: string }
  | { kind: "reconciliation-set"; reconciliationSetId: string; clusterIds: string[]; canonicalDependencyCount: number; status: "required" | "completed"; identityProposalHash?: string };

export type ClusterPlanStatus = {
  planned: boolean;
  planHash?: string;
  extractionSnapshotHash?: string;
  baselineRevision?: number;
  baselineContentHash?: string | null;
  clusterCount: number;
  pendingClusterCount: number;
  proposedClusterCount: number;
  requiredReconciliationSetCount: number;
  completedReconciliationSetCount: number;
  readyForMerge: boolean;
  entries: ClusterPlanStatusEntry[];
  returnedItems: number;
  truncated: boolean;
  continuationCursor?: string;
};

type FullPlanStatus = Omit<ClusterPlanStatus, "entries" | "returnedItems" | "truncated" | "continuationCursor"> & {
  plan?: ClusterPlanArtifact;
  entries: ClusterPlanStatusEntry[];
  proposalHashes: string[];
  identityProposalHashes: string[];
};

function planDir(outputRoot: string, runId: string): string { return join(outputRoot, "stages", "runs", runId, "cluster-plans"); }
function planPath(outputRoot: string, runId: string, planHash: string): string { return join(planDir(outputRoot, runId), `${planHash}.json`); }
function proposalDir(outputRoot: string, runId: string): string { return join(outputRoot, "stages", "runs", runId, "proposals"); }
function identityDir(outputRoot: string, runId: string): string { return join(outputRoot, "stages", "runs", runId, "identity"); }

function parseCursor<T>(value: string, label: string): T {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as T; }
  catch { throw new Error(`Invalid ${label} continuation cursor`); }
}
function encodeCursor(value: unknown): string { return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url"); }
function semanticStage(stage: StageEnvelope): StageEnvelope {
  const { revision: _revision, contentHash: _contentHash, parentContentHash: _parentContentHash, ...semantic } = stage;
  return semantic;
}

/** Artifact ledger for model-authored cross-unit candidate partitioning. It validates
 * references and accounting only; cluster membership remains entirely model-owned. */
export class MemImportClusterPlanService {
  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {}

  async candidateInventory(options: CoordinatorAuthority & { continuationCursor?: string; maxItems?: number }): Promise<{
    snapshotHash: string;
    baselineRevision: number;
    baselineContentHash: string | null;
    totalCandidates: number;
    candidates: ClusterPlanCandidate[];
    returnedItems: number;
    truncated: boolean;
    continuationCursor?: string;
  }> {
    const run = await this.base.authorizeCoordinator(options);
    const snapshot = await this.buildSnapshot(run.outputRoot);
    const maxItems = options.maxItems ?? 50;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    let offset = 0;
    if (options.continuationCursor) {
      const cursor = parseCursor<Partial<InventoryCursor>>(options.continuationCursor, "cluster candidate inventory");
      if (cursor.version !== 1 || cursor.kind !== "cluster-candidate-inventory" || cursor.snapshotHash !== snapshot.snapshotHash || cursor.baselineRevision !== snapshot.baselineRevision || cursor.baselineContentHash !== snapshot.baselineContentHash || !Number.isInteger(cursor.offset) || cursor.offset! < 0) {
        throw new Error("Cluster candidate inventory continuation cursor is stale or invalid");
      }
      offset = cursor.offset!;
    }
    if (offset > snapshot.entries.length) throw new Error("Cluster candidate inventory continuation cursor offset is invalid");
    const candidates = snapshot.entries.slice(offset, offset + maxItems);
    const next = offset + candidates.length;
    const truncated = next < snapshot.entries.length;
    return {
      snapshotHash: snapshot.snapshotHash,
      baselineRevision: snapshot.baselineRevision,
      baselineContentHash: snapshot.baselineContentHash,
      totalCandidates: snapshot.entries.length,
      candidates,
      returnedItems: candidates.length,
      truncated,
      ...(truncated ? { continuationCursor: encodeCursor({ version: 1, kind: "cluster-candidate-inventory", snapshotHash: snapshot.snapshotHash, baselineRevision: snapshot.baselineRevision, baselineContentHash: snapshot.baselineContentHash, offset: next } satisfies InventoryCursor) } : {}),
    };
  }

  async submit(options: CoordinatorAuthority & {
    snapshotHash: string;
    baselineRevision: number;
    baselineContentHash: string | null;
    plan: { id: string; clusters: ClusterPlanCluster[]; reconciliationSets?: ClusterPlanReconciliationSet[]; rationale: string };
  }): Promise<{ path: string; planHash: string; clusterCount: number; reconciliationSetCount: number; idempotent: boolean }> {
    return this.base.withRunMutation(options.outputRoot, () => this.submitLocked(options));
  }

  private async submitLocked(options: CoordinatorAuthority & {
    snapshotHash: string;
    baselineRevision: number;
    baselineContentHash: string | null;
    plan: { id: string; clusters: ClusterPlanCluster[]; reconciliationSets?: ClusterPlanReconciliationSet[]; rationale: string };
  }): Promise<{ path: string; planHash: string; clusterCount: number; reconciliationSetCount: number; idempotent: boolean }> {
    const run = await this.base.authorizeCoordinatorMutation(options);
    const snapshot = await this.buildSnapshot(run.outputRoot);
    const existing = await this.readActivePlan(run.outputRoot, run.runId);
    if (existing) {
      if (snapshot.snapshotHash !== existing.extractionSnapshotHash) throw new Error("The extraction snapshot changed after the immutable cluster plan was accepted");
      if (options.snapshotHash !== existing.extractionSnapshotHash || options.baselineRevision !== existing.baselineRevision || options.baselineContentHash !== existing.baselineContentHash) throw new Error(`An immutable cluster plan already exists for this run (${existing.planHash})`);
      const repeated = this.validatePlan(run.runId, { ...snapshot, baselineRevision: existing.baselineRevision, baselineContentHash: existing.baselineContentHash }, options.plan);
      if (this.hashPlan(repeated) !== existing.planHash) throw new Error(`An immutable cluster plan already exists for this run (${existing.planHash})`);
      return { path: this.relative(run.outputRoot, planPath(run.outputRoot, run.runId, existing.planHash)), planHash: existing.planHash, clusterCount: existing.clusters.length, reconciliationSetCount: existing.reconciliationSets.length, idempotent: true };
    }
    if (options.snapshotHash !== snapshot.snapshotHash) throw new Error("Cluster plan extraction snapshot is stale");
    if (options.baselineRevision !== snapshot.baselineRevision || options.baselineContentHash !== snapshot.baselineContentHash) throw new Error("Cluster plan canonical baseline is stale");
    if (existsSync(proposalDir(run.outputRoot, run.runId)) && (await readdir(proposalDir(run.outputRoot, run.runId))).some((name) => name.endsWith(".json"))) throw new Error("A cluster plan must be accepted before proposal artifacts exist");
    if (existsSync(identityDir(run.outputRoot, run.runId)) && (await readdir(identityDir(run.outputRoot, run.runId))).some((name) => name.endsWith(".json"))) throw new Error("A cluster plan must be accepted before identity artifacts exist");
    const plan = this.validatePlan(run.runId, snapshot, options.plan);
    await this.assertCanonicalDependencies(run.outputRoot, plan.reconciliationSets);
    const planHash = this.hashPlan(plan);
    const stored: ClusterPlanArtifact = { ...plan, planHash, submittedAt: this.now().toISOString() };
    await mkdir(planDir(run.outputRoot, run.runId), { recursive: true, mode: 0o700 });
    await writeJson(planPath(run.outputRoot, run.runId, planHash), stored);
    return { path: this.relative(run.outputRoot, planPath(run.outputRoot, run.runId, planHash)), planHash, clusterCount: stored.clusters.length, reconciliationSetCount: stored.reconciliationSets.length, idempotent: false };
  }

  async status(options: CoordinatorAuthority & { continuationCursor?: string; maxItems?: number }): Promise<ClusterPlanStatus> {
    const run = await this.base.authorizeCoordinator(options);
    const full = await this.statusForRun(run.outputRoot, run.runId);
    const maxItems = options.maxItems ?? 20;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    const statusHash = canonicalHash({ planHash: full.planHash ?? null, entries: full.entries });
    let offset = 0;
    if (options.continuationCursor) {
      const cursor = parseCursor<Partial<StatusCursor>>(options.continuationCursor, "cluster plan status");
      if (cursor.version !== 1 || cursor.kind !== "cluster-plan-status" || cursor.planHash !== full.planHash || cursor.statusHash !== statusHash || !Number.isInteger(cursor.offset) || cursor.offset! < 0) throw new Error("Cluster plan status continuation cursor is stale or invalid");
      offset = cursor.offset!;
    }
    const entries = full.entries.slice(offset, offset + maxItems);
    const next = offset + entries.length;
    const truncated = next < full.entries.length;
    const { plan: _plan, proposalHashes: _proposalHashes, identityProposalHashes: _identityProposalHashes, entries: _entries, ...summary } = full;
    return { ...summary, entries, returnedItems: entries.length, truncated, ...(truncated && full.planHash ? { continuationCursor: encodeCursor({ version: 1, kind: "cluster-plan-status", planHash: full.planHash, statusHash, offset: next } satisfies StatusCursor) } : {}) };
  }

  async statusForRun(outputRoot: string, runId: string): Promise<FullPlanStatus> {
    const plan = await this.readActivePlan(outputRoot, runId);
    if (!plan) return { planned: false, clusterCount: 0, pendingClusterCount: 0, proposedClusterCount: 0, requiredReconciliationSetCount: 0, completedReconciliationSetCount: 0, readyForMerge: false, entries: [], proposalHashes: [], identityProposalHashes: [] };
    await this.assertExtractionSnapshotCurrent(outputRoot, plan);
    const proposalByCluster = new Map<string, string>();
    const proposalsRoot = proposalDir(outputRoot, runId);
    for (const file of existsSync(proposalsRoot) ? await readdir(proposalsRoot) : []) {
      if (!file.endsWith(".json")) continue;
      const packet = JSON.parse(await readFile(join(proposalsRoot, file), "utf-8")) as Record<string, unknown>;
      if (packet.planHash !== plan.planHash || typeof packet.clusterId !== "string" || typeof packet.contentHash !== "string") continue;
      const { runId: packetRunId, taskId: _taskId, contentHash, submittedAt: _submittedAt, ...semantic } = packet;
      if (packetRunId !== runId || !/^[a-f0-9]{64}$/.test(contentHash) || canonicalHash(semantic) !== contentHash) throw new Error(`Cluster ${packet.clusterId} has an invalid immutable proposal`);
      if (!plan.clusters.some((cluster) => cluster.id === packet.clusterId)) throw new Error(`Proposal references missing cluster ${packet.clusterId}`);
      if (proposalByCluster.has(packet.clusterId) && proposalByCluster.get(packet.clusterId) !== contentHash) throw new Error(`Cluster ${packet.clusterId} has more than one effective proposal`);
      proposalByCluster.set(packet.clusterId, contentHash);
    }
    const identityBySet = new Map<string, string>();
    const identitiesRoot = identityDir(outputRoot, runId);
    for (const file of existsSync(identitiesRoot) ? await readdir(identitiesRoot) : []) {
      if (!file.endsWith(".json")) continue;
      const packet = JSON.parse(await readFile(join(identitiesRoot, file), "utf-8")) as Record<string, unknown>;
      if (packet.planHash !== plan.planHash || typeof packet.reconciliationSetId !== "string" || typeof packet.contentHash !== "string") continue;
      const { runId: packetRunId, taskId: _taskId, contentHash, submittedAt: _submittedAt, ...semantic } = packet;
      if (packetRunId !== runId || !/^[a-f0-9]{64}$/.test(contentHash) || canonicalHash(semantic) !== contentHash) throw new Error(`Reconciliation set ${packet.reconciliationSetId} has an invalid immutable identity packet`);
      if (!plan.reconciliationSets.some((set) => set.id === packet.reconciliationSetId)) throw new Error(`Identity packet references missing reconciliation set ${packet.reconciliationSetId}`);
      if (identityBySet.has(packet.reconciliationSetId) && identityBySet.get(packet.reconciliationSetId) !== contentHash) throw new Error(`Reconciliation set ${packet.reconciliationSetId} has more than one effective identity packet`);
      identityBySet.set(packet.reconciliationSetId, contentHash);
    }
    const clusterEntries: ClusterPlanStatusEntry[] = plan.clusters.map((cluster) => proposalByCluster.has(cluster.id)
      ? { kind: "cluster", clusterId: cluster.id, label: cluster.label, clusterKind: cluster.kind, candidateCount: cluster.candidateIds.length, status: "proposed", proposalHash: proposalByCluster.get(cluster.id)! }
      : { kind: "cluster", clusterId: cluster.id, label: cluster.label, clusterKind: cluster.kind, candidateCount: cluster.candidateIds.length, status: "pending" });
    const setEntries: ClusterPlanStatusEntry[] = plan.reconciliationSets.map((set) => identityBySet.has(set.id)
      ? { kind: "reconciliation-set", reconciliationSetId: set.id, clusterIds: [...set.clusterIds], canonicalDependencyCount: set.canonicalDependencies?.length ?? 0, status: "completed", identityProposalHash: identityBySet.get(set.id)! }
      : { kind: "reconciliation-set", reconciliationSetId: set.id, clusterIds: [...set.clusterIds], canonicalDependencyCount: set.canonicalDependencies?.length ?? 0, status: "required" });
    const proposedClusterCount = proposalByCluster.size;
    const completedReconciliationSetCount = identityBySet.size;
    return {
      planned: true,
      plan,
      planHash: plan.planHash,
      extractionSnapshotHash: plan.extractionSnapshotHash,
      baselineRevision: plan.baselineRevision,
      baselineContentHash: plan.baselineContentHash,
      clusterCount: plan.clusters.length,
      pendingClusterCount: plan.clusters.length - proposedClusterCount,
      proposedClusterCount,
      requiredReconciliationSetCount: plan.reconciliationSets.length,
      completedReconciliationSetCount,
      readyForMerge: proposedClusterCount === plan.clusters.length && completedReconciliationSetCount === plan.reconciliationSets.length,
      entries: [...clusterEntries, ...setEntries],
      proposalHashes: plan.clusters.flatMap((cluster) => proposalByCluster.get(cluster.id) ?? []),
      identityProposalHashes: plan.reconciliationSets.flatMap((set) => identityBySet.get(set.id) ?? []),
    };
  }

  async readActivePlan(outputRoot: string, runId: string): Promise<ClusterPlanArtifact | undefined> {
    const directory = planDir(outputRoot, runId);
    if (!existsSync(directory)) return undefined;
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    if (files.length === 0) return undefined;
    if (files.length !== 1) throw new Error("A run must contain exactly one immutable cluster plan");
    const stored = JSON.parse(await readFile(join(directory, files[0]!), "utf-8")) as ClusterPlanArtifact;
    if (stored.version !== 1 || stored.kind !== "mem-import-cluster-plan" || stored.runId !== runId || !/^[a-f0-9]{64}$/.test(String(stored.planHash))) throw new Error("Invalid immutable cluster plan artifact");
    const { planHash, submittedAt: _submittedAt, ...semantic } = stored;
    if (this.hashPlan(semantic) !== planHash || files[0] !== `${planHash}.json`) throw new Error("Immutable cluster plan content hash does not match its contents");
    return stored;
  }

  async proposalBinding(outputRoot: string, runId: string, planHash: string, clusterId: string): Promise<{ unitIds: string[]; candidateIds: string[] }> {
    const plan = await this.requirePlan(outputRoot, runId, planHash);
    await this.assertExtractionSnapshotCurrent(outputRoot, plan);
    const cluster = plan.clusters.find((item) => item.id === clusterId);
    if (!cluster) throw new Error(`Cluster ${clusterId} does not exist in plan ${planHash}`);
    return { unitIds: [...new Set(cluster.candidateIds.map((id) => id.slice(0, id.indexOf(":"))))], candidateIds: [...cluster.candidateIds] };
  }

  async reconciliationBinding(outputRoot: string, runId: string, planHash: string, reconciliationSetId: string): Promise<{ proposalHashes: string[]; baselineRevision: number; baselineContentHash: string | null; canonicalDependencies?: CanonicalDependency[] }> {
    const plan = await this.requirePlan(outputRoot, runId, planHash);
    await this.assertExtractionSnapshotCurrent(outputRoot, plan);
    const set = plan.reconciliationSets.find((item) => item.id === reconciliationSetId);
    if (!set) throw new Error(`Reconciliation set ${reconciliationSetId} does not exist in plan ${planHash}`);
    const status = await this.statusForRun(outputRoot, runId);
    const proposalByCluster = new Map(status.entries.filter((entry): entry is Extract<ClusterPlanStatusEntry, { kind: "cluster" }> => entry.kind === "cluster" && entry.status === "proposed").map((entry) => [entry.clusterId, entry.proposalHash!]));
    const missing = set.clusterIds.filter((clusterId) => !proposalByCluster.has(clusterId));
    if (missing.length) throw new Error(`Reconciliation set ${set.id} is not assignable until its clusters are proposed: ${missing.join(", ")}`);
    return { proposalHashes: set.clusterIds.map((clusterId) => proposalByCluster.get(clusterId)!), baselineRevision: plan.baselineRevision, baselineContentHash: plan.baselineContentHash, ...(set.canonicalDependencies !== undefined ? { canonicalDependencies: structuredClone(set.canonicalDependencies) } : {}) };
  }

  async requireReady(outputRoot: string, runId: string, planHash: string): Promise<FullPlanStatus> {
    const status = await this.statusForRun(outputRoot, runId);
    if (!status.planned || status.planHash !== planHash) throw new Error("Merger assignment cluster plan does not match the run plan");
    if (!status.readyForMerge) throw new Error(`Cluster plan is not ready for merge (${status.pendingClusterCount} pending clusters, ${status.requiredReconciliationSetCount - status.completedReconciliationSetCount} incomplete reconciliation sets)`);
    return status;
  }

  async assertMergeIdentityCoverage(outputRoot: string, runId: string, planHash: string, proposalHashes: string[], identityProposalHashes: string[] = []): Promise<void> {
    const status = await this.requireReady(outputRoot, runId, planHash);
    const plan = status.plan!;
    const proposalByCluster = new Map(status.entries.filter((entry): entry is Extract<ClusterPlanStatusEntry, { kind: "cluster" }> => entry.kind === "cluster" && entry.status === "proposed").map((entry) => [entry.clusterId, entry.proposalHash!]));
    const identityBySet = new Map(status.entries.filter((entry): entry is Extract<ClusterPlanStatusEntry, { kind: "reconciliation-set" }> => entry.kind === "reconciliation-set" && entry.status === "completed").map((entry) => [entry.reconciliationSetId, entry.identityProposalHash!]));
    const acceptedIdentityHashes = new Set<string>();
    const canonicalRoot = await this.base.canonicalRootForRun(outputRoot);
    const transactionsRoot = join(canonicalRoot, "stages", "merge", "transactions");
    for (const file of existsSync(transactionsRoot) ? await readdir(transactionsRoot) : []) {
      if (!file.endsWith(".json")) continue;
      const transaction = JSON.parse(await readFile(join(transactionsRoot, file), "utf-8")) as { identityProposalHashes?: unknown };
      if (Array.isArray(transaction.identityProposalHashes)) for (const value of transaction.identityProposalHashes) if (typeof value === "string") acceptedIdentityHashes.add(value);
    }
    const declaredProposals = new Set(proposalHashes);
    const declaredIdentities = new Set(identityProposalHashes);
    for (const set of plan.reconciliationSets) {
      const relatedProposals = set.clusterIds.map((clusterId) => proposalByCluster.get(clusterId)!).filter(Boolean);
      if (!relatedProposals.some((proposalHash) => declaredProposals.has(proposalHash))) continue;
      const requiredIdentityHash = identityBySet.get(set.id)!;
      if (!acceptedIdentityHashes.has(requiredIdentityHash) && !declaredIdentities.has(requiredIdentityHash)) throw new Error(`Merge work for reconciliation set ${set.id} requires identity packet ${requiredIdentityHash} in the same batch or an earlier accepted transaction`);
    }
  }

  private async requirePlan(outputRoot: string, runId: string, planHash: string): Promise<ClusterPlanArtifact> {
    const plan = await this.readActivePlan(outputRoot, runId);
    if (!plan || plan.planHash !== planHash) throw new Error("Cluster plan hash does not match the active immutable plan");
    return plan;
  }

  private validatePlan(runId: string, snapshot: CandidateSnapshot, input: { id: string; clusters: ClusterPlanCluster[]; reconciliationSets?: ClusterPlanReconciliationSet[]; rationale: string }): Omit<ClusterPlanArtifact, "planHash" | "submittedAt"> {
    if (!input || typeof input !== "object") throw new Error("Cluster plan must be an object");
    assertMemImportId(input.id, "cluster plan id");
    if (!Array.isArray(input.clusters) || input.clusters.length > 100 || (snapshot.entries.length > 0 && input.clusters.length === 0)) throw new Error("Cluster plan requires one to one hundred clusters when the extraction snapshot has candidates");
    if (typeof input.rationale !== "string" || !input.rationale.trim()) throw new Error("Cluster plan rationale must be non-empty");
    const available = new Set(snapshot.entries.map((entry) => `${entry.unitId}:${entry.candidateId}`));
    const accounted = new Set<string>();
    const clusterIds = new Set<string>();
    const clusters = input.clusters.map((cluster) => {
      if (!cluster || typeof cluster !== "object") throw new Error("Cluster plan clusters must be objects");
      assertMemImportId(cluster.id, "cluster id");
      if (cluster.id === input.id || clusterIds.has(cluster.id)) throw new Error(`Cluster plan duplicates id ${cluster.id}`);
      clusterIds.add(cluster.id);
      if (typeof cluster.label !== "string" || !cluster.label.trim()) throw new Error(`Cluster ${cluster.id} label must be non-empty`);
      if (cluster.kind !== "identity" && cluster.kind !== "coherent") throw new Error(`Cluster ${cluster.id} kind must be identity or coherent`);
      if (!Array.isArray(cluster.candidateIds) || cluster.candidateIds.length === 0 || cluster.candidateIds.length > 100) throw new Error(`Cluster ${cluster.id} requires one to one hundred candidate IDs`);
      const local = new Set<string>();
      for (const candidateId of cluster.candidateIds) {
        if (typeof candidateId !== "string" || !available.has(candidateId)) throw new Error(`Cluster ${cluster.id} references missing candidate ${String(candidateId)}`);
        if (local.has(candidateId) || accounted.has(candidateId)) throw new Error(`Cluster plan candidate ${candidateId} appears more than once`);
        local.add(candidateId); accounted.add(candidateId);
      }
      if (typeof cluster.rationale !== "string" || !cluster.rationale.trim()) throw new Error(`Cluster ${cluster.id} rationale must be non-empty`);
      return { id: cluster.id, label: cluster.label, kind: cluster.kind, candidateIds: [...cluster.candidateIds], rationale: cluster.rationale };
    });
    const missing = [...available].filter((candidateId) => !accounted.has(candidateId));
    if (missing.length) throw new Error(`Cluster plan must partition the complete candidate snapshot; missing ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}`);
    const setIds = new Set<string>();
    const reconciledClusterIds = new Set<string>();
    const reconciliationSets = (input.reconciliationSets ?? []).map((set) => {
      if (!set || typeof set !== "object") throw new Error("Reconciliation sets must be objects");
      assertMemImportId(set.id, "reconciliation set id");
      if (set.id === input.id || setIds.has(set.id) || clusterIds.has(set.id)) throw new Error(`Cluster plan duplicates id ${set.id}`);
      setIds.add(set.id);
      if (!Array.isArray(set.clusterIds) || set.clusterIds.length === 0 || set.clusterIds.length > 100 || new Set(set.clusterIds).size !== set.clusterIds.length) throw new Error(`Reconciliation set ${set.id} requires unique cluster IDs`);
      for (const clusterId of set.clusterIds) {
        if (!clusterIds.has(clusterId)) throw new Error(`Reconciliation set ${set.id} references missing cluster ${clusterId}`);
        if (reconciledClusterIds.has(clusterId)) throw new Error(`Cluster ${clusterId} belongs to more than one reconciliation set`);
        reconciledClusterIds.add(clusterId);
      }
      if (typeof set.rationale !== "string" || !set.rationale.trim()) throw new Error(`Reconciliation set ${set.id} rationale must be non-empty`);
      if (set.canonicalDependencies !== undefined) {
        if (!Array.isArray(set.canonicalDependencies) || set.canonicalDependencies.length > 100) throw new Error(`Reconciliation set ${set.id} canonicalDependencies must be bounded`);
        const dependencyIds = new Set<string>();
        for (const dependency of set.canonicalDependencies) {
          if (!dependency || typeof dependency.artifactId !== "string" || (dependency.contentHash !== null && !/^[a-f0-9]{64}$/.test(String(dependency.contentHash)))) throw new Error(`Reconciliation set ${set.id} has an invalid canonical dependency`);
          assertMemImportId(dependency.artifactId, "canonical dependency artifactId");
          if (dependencyIds.has(dependency.artifactId)) throw new Error(`Reconciliation set ${set.id} duplicates canonical dependency ${dependency.artifactId}`);
          dependencyIds.add(dependency.artifactId);
        }
      }
      return { id: set.id, clusterIds: [...set.clusterIds], ...(set.canonicalDependencies !== undefined ? { canonicalDependencies: structuredClone(set.canonicalDependencies) } : {}), rationale: set.rationale };
    });
    return { version: 1, kind: "mem-import-cluster-plan", id: input.id, runId, extractionSnapshotHash: snapshot.snapshotHash, baselineRevision: snapshot.baselineRevision, baselineContentHash: snapshot.baselineContentHash, clusters, reconciliationSets, rationale: input.rationale };
  }

  private hashPlan(value: Omit<ClusterPlanArtifact, "planHash" | "submittedAt">): string { return canonicalHash(value); }

  private async buildSnapshot(outputRoot: string): Promise<CandidateSnapshot> {
    const manifest = await readManifest(outputRoot);
    const entries: ClusterPlanCandidate[] = [];
    const packets: Array<{ unitId: string; order: number; packetHash: string; candidateIds: string[] }> = [];
    for (const unit of [...manifest.units].sort((left, right) => left.order - right.order || left.unitId.localeCompare(right.unitId))) {
      const path = extractionStagePath(outputRoot, unit.unitId);
      if (!existsSync(path)) throw new Error(`A complete extraction snapshot is required; unit ${unit.unitId} has no extraction packet`);
      const stage = JSON.parse(await readFile(path, "utf-8")) as StageEnvelope;
      if (stage.kind !== "extraction" || stage.unitId !== unit.unitId || !Array.isArray(stage.candidates)) throw new Error(`Extraction packet ${unit.unitId} is invalid`);
      const candidateIds = new Set<string>();
      for (const candidate of stage.candidates) {
        if (typeof candidate.id !== "string" || candidateIds.has(candidate.id)) throw new Error(`Extraction packet ${unit.unitId} has duplicate or invalid candidate IDs`);
        candidateIds.add(candidate.id);
        entries.push({ unitId: unit.unitId, candidateId: candidate.id, group: candidate.group, title: candidate.title });
      }
      packets.push({ unitId: unit.unitId, order: unit.order, packetHash: createHash("sha256").update(JSON.stringify(stage)).digest("hex"), candidateIds: [...candidateIds] });
    }
    const baseline = await this.canonicalBaseline(outputRoot);
    return { snapshotHash: canonicalHash({ units: packets }), entries, ...baseline };
  }

  private async assertCanonicalDependencies(outputRoot: string, sets: ClusterPlanReconciliationSet[]): Promise<void> {
    const canonicalRoot = await this.base.canonicalRootForRun(outputRoot);
    const stage = existsSync(mergedCandidatesPath(canonicalRoot)) ? await readMergeStage(canonicalRoot) : { version: 1, kind: "merge", artifacts: [] } satisfies StageEnvelope;
    const artifacts = new Map((stage.artifacts ?? []).map((artifact) => [artifact.id, canonicalHash(artifact)]));
    for (const set of sets) for (const dependency of set.canonicalDependencies ?? []) {
      const actual = artifacts.get(dependency.artifactId) ?? null;
      if (actual !== dependency.contentHash) throw new Error(`Reconciliation set ${set.id} has a stale canonical dependency for ${dependency.artifactId}`);
    }
  }

  private async assertExtractionSnapshotCurrent(outputRoot: string, plan: ClusterPlanArtifact): Promise<void> {
    const current = await this.buildSnapshot(outputRoot);
    if (current.snapshotHash !== plan.extractionSnapshotHash) throw new Error("The extraction snapshot changed after the immutable cluster plan was accepted");
  }

  private async canonicalBaseline(outputRoot: string): Promise<{ baselineRevision: number; baselineContentHash: string | null }> {
    const canonicalRoot = await this.base.canonicalRootForRun(outputRoot);
    if (!existsSync(mergedCandidatesPath(canonicalRoot))) return { baselineRevision: 0, baselineContentHash: null };
    const stage = await readMergeStage(canonicalRoot);
    if (!Number.isInteger(stage.revision) || stage.revision! < 1 || typeof stage.contentHash !== "string" || canonicalHash(semanticStage(stage)) !== stage.contentHash) throw new Error("Canonical baseline is invalid");
    return { baselineRevision: stage.revision!, baselineContentHash: stage.contentHash };
  }

  private relative(outputRoot: string, path: string): string { return path.startsWith(`${outputRoot}/`) ? path.slice(outputRoot.length + 1) : path; }
}
