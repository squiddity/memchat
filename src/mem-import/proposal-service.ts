import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { extractionStagePath, readNormalizedUnit, validateStageEnvelope, writeJson } from "../world-import/staging.js";
import type { StageEnvelope } from "../world-import/types.js";
import { MemImportService } from "./service.js";

type WorkerAuthority = { outputRoot: string; runId: string; taskId: string; grant: string };

export type ProposalInput = {
  unitId: string;
  packetHash: string;
  candidateIds?: string[];
};

export type ShardProposalPacket = {
  version: 1;
  kind: "mem-import-proposal";
  id: string;
  planHash?: string;
  clusterId?: string;
  inputs: ProposalInput[];
  artifacts: unknown[];
  candidateDispositions?: unknown[];
  diagnostics?: Array<{ level: "info" | "warning" | "error"; message: string; path?: string }>;
  rationale: string;
  metadata?: Record<string, unknown>;
};

export type StoredProposal = ShardProposalPacket & {
  runId: string;
  taskId: string;
  contentHash: string;
  submittedAt: string;
};

function proposalPath(outputRoot: string, runId: string, id: string, contentHash: string): string {
  return join(outputRoot, "stages", "runs", runId, "proposals", `${id}-${contentHash}.json`);
}

function assertId(value: string, label: string): void {
  if (!value.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens`);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/** Immutable, grant-scoped handoff for bounded shard synthesis before canonical merge. */
export class MemImportProposalService {
  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {}

  async submitWorkerProposal(options: WorkerAuthority & { packet: unknown }): Promise<{ path: string; contentHash: string }> {
    return this.base.withRunMutation(options.outputRoot, () => this.submitWorkerProposalLocked(options));
  }

  private async submitWorkerProposalLocked(options: WorkerAuthority & { packet: unknown }): Promise<{ path: string; contentHash: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "proposal:submit", role: "proposer" });
    const packet = await this.validatePacket(assignment.outputRoot, assignment.allowedUnitIds, assignment.allowedCandidateIds, options.packet, assignment.planHash, assignment.clusterId);
    const contentHash = hash(packet);
    const path = proposalPath(assignment.outputRoot, assignment.runId, packet.id, contentHash);
    if (assignment.planHash && assignment.clusterId) {
      const existing = await this.findPlannedProposal(assignment.outputRoot, assignment.runId, assignment.planHash, assignment.clusterId);
      if (existing) {
        if (existing.contentHash === contentHash) return { path: existing.path, contentHash };
        throw new Error(`Cluster ${assignment.clusterId} already has an immutable proposal`);
      }
    }
    if (existsSync(path)) return { path: this.relative(assignment.outputRoot, path), contentHash };
    const stored: StoredProposal = { ...packet, runId: assignment.runId, taskId: assignment.taskId, contentHash, submittedAt: this.now().toISOString() };
    await writeJson(path, stored);
    await this.base.recordWorkerEffect(assignment, { kind: "proposal", path: this.relative(assignment.outputRoot, path), contentHash });
    return { path: this.relative(assignment.outputRoot, path), contentHash };
  }

  /** Model-facing proposer path: accept semantic output and derive protocol fields,
   * extraction hashes, packet identity, and exact candidate scope deterministically. */
  async submitWorkerProposalBody(options: WorkerAuthority & {
    artifacts: unknown[];
    candidateDispositions: unknown[];
    rationale: string;
    diagnostics?: ShardProposalPacket["diagnostics"];
    metadata?: Record<string, unknown>;
  }): Promise<{ path: string; contentHash: string }> {
    return this.base.withRunMutation(options.outputRoot, () => this.submitWorkerProposalBodyLocked(options));
  }

  private async submitWorkerProposalBodyLocked(options: WorkerAuthority & {
    artifacts: unknown[];
    candidateDispositions: unknown[];
    rationale: string;
    diagnostics?: ShardProposalPacket["diagnostics"];
    metadata?: Record<string, unknown>;
  }): Promise<{ path: string; contentHash: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "proposal:submit", role: "proposer" });
    const scoped = assignment.allowedCandidateIds?.length ? new Set(assignment.allowedCandidateIds) : undefined;
    const inputs: ProposalInput[] = [];
    const expectedCandidates = new Set<string>();
    for (const unitId of assignment.allowedUnitIds) {
      const path = extractionStagePath(assignment.outputRoot, unitId);
      if (!existsSync(path)) throw new Error(`Assigned extraction packet ${unitId} does not exist`);
      const stage = JSON.parse(await readFile(path, "utf-8")) as StageEnvelope;
      if (!Array.isArray(stage.candidates)) throw new Error(`Assigned extraction packet ${unitId} is invalid`);
      const candidateIds = stage.candidates.map((candidate) => candidate.id).filter((candidateId) => !scoped || scoped.has(`${unitId}:${candidateId}`));
      if (scoped && candidateIds.length === 0) continue;
      for (const candidateId of candidateIds) expectedCandidates.add(`${unitId}:${candidateId}`);
      inputs.push({ unitId, packetHash: createHash("sha256").update(JSON.stringify(stage)).digest("hex"), ...(scoped ? { candidateIds } : {}) });
    }
    const artifactIds = new Set((options.artifacts ?? []).flatMap((artifact) => artifact && typeof artifact === "object" && typeof (artifact as { id?: unknown }).id === "string" ? [(artifact as { id: string }).id] : []));
    const accounted = new Set<string>();
    for (const raw of options.candidateDispositions ?? []) {
      if (!raw || typeof raw !== "object") throw new Error("Each candidate disposition must be an object");
      const disposition = raw as { unitId?: unknown; candidateId?: unknown; disposition?: unknown; artifactId?: unknown; reason?: unknown };
      if (typeof disposition.unitId !== "string" || typeof disposition.candidateId !== "string") throw new Error("Each candidate disposition requires unitId and candidateId");
      const key = `${disposition.unitId}:${disposition.candidateId}`;
      if (!expectedCandidates.has(key)) throw new Error(`Candidate disposition ${key} is outside this proposer assignment`);
      if (accounted.has(key)) throw new Error(`Candidate disposition ${key} appears more than once`);
      accounted.add(key);
      if (!["represented", "merged", "deferred", "dropped"].includes(String(disposition.disposition))) throw new Error(`Candidate disposition ${key} has an invalid disposition`);
      if (["represented", "merged"].includes(String(disposition.disposition)) && (typeof disposition.artifactId !== "string" || !artifactIds.has(disposition.artifactId))) throw new Error(`Candidate disposition ${key} must name a proposed artifactId`);
      if (["deferred", "dropped"].includes(String(disposition.disposition)) && (typeof disposition.reason !== "string" || !disposition.reason.trim())) throw new Error(`Candidate disposition ${key} requires a reason`);
    }
    const missing = [...expectedCandidates].filter((key) => !accounted.has(key));
    if (missing.length) throw new Error(`Proposal must account for every assigned candidate; missing ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}`);
    return this.submitWorkerProposal({
      outputRoot: options.outputRoot,
      runId: options.runId,
      taskId: options.taskId,
      grant: options.grant,
      packet: {
        version: 1,
        kind: "mem-import-proposal",
        id: assignment.taskId,
        ...(assignment.planHash ? { planHash: assignment.planHash } : {}),
        ...(assignment.clusterId ? { clusterId: assignment.clusterId } : {}),
        inputs,
        artifacts: options.artifacts,
        candidateDispositions: options.candidateDispositions,
        ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
        rationale: options.rationale,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      },
    });
  }

  async inventoryWorkerProposals(options: WorkerAuthority & { continuationCursor?: string; maxItems?: number }): Promise<{ entries: Array<{ proposalHash: string; id: string; artifactCount: number; dispositionCount: number }>; truncated: boolean; continuationCursor?: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    if (!["reconciler", "merger", "repairer"].includes(assignment.role)) throw new Error("Proposal reads require a reconciler, merger, or repairer assignment");
    const maxItems = options.maxItems ?? 25;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    const directory = join(assignment.outputRoot, "stages", "runs", assignment.runId, "proposals");
    const allowed = assignment.allowedProposalHashes?.length ? new Set(assignment.allowedProposalHashes) : undefined;
    const after = options.continuationCursor ? Buffer.from(options.continuationCursor, "base64url").toString("utf-8") : "";
    const rows: Array<{ file: string; packet: StoredProposal }> = [];
    for (const file of (existsSync(directory) ? await readdir(directory) : []).filter((name) => name.endsWith(".json") && name > after).sort()) {
      const packet = JSON.parse(await readFile(join(directory, file), "utf-8")) as StoredProposal;
      if (!allowed || allowed.has(packet.contentHash)) rows.push({ file, packet });
    }
    const page = rows.slice(0, maxItems);
    const truncated = rows.length > page.length;
    const last = page.at(-1);
    return {
      entries: page.map(({ packet }) => ({ proposalHash: packet.contentHash, id: packet.id, artifactCount: packet.artifacts.length, dispositionCount: packet.candidateDispositions?.length ?? 0 })),
      truncated,
      ...(truncated && last ? { continuationCursor: Buffer.from(last.file, "utf-8").toString("base64url") } : {}),
    };
  }

  async readWorkerProposal(options: WorkerAuthority & { proposalHash: string; continuationCursor?: string; maxArtifacts?: number }): Promise<{ proposalHash: string; id: string; inputs: ProposalInput[]; artifacts: unknown[]; candidateDispositions: unknown[]; rationale: string; truncated: boolean; continuationCursor?: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    if (!["reconciler", "merger", "repairer"].includes(assignment.role)) throw new Error("Proposal reads require a reconciler, merger, or repairer assignment");
    if (assignment.allowedProposalHashes?.length && !assignment.allowedProposalHashes.includes(options.proposalHash)) throw new Error("Proposal hash is outside this assignment");
    const packet = await this.readProposal(assignment.outputRoot, assignment.runId, options.proposalHash);
    const maxArtifacts = options.maxArtifacts ?? 25;
    if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1 || maxArtifacts > 100) throw new Error("maxArtifacts must be an integer between 1 and 100");
    const offset = options.continuationCursor ? Number.parseInt(Buffer.from(options.continuationCursor, "base64url").toString("utf-8"), 10) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > packet.artifacts.length) throw new Error("Invalid proposal continuation cursor");
    const artifacts = packet.artifacts.slice(offset, offset + maxArtifacts);
    const next = offset + artifacts.length;
    const truncated = next < packet.artifacts.length;
    return { proposalHash: packet.contentHash, id: packet.id, inputs: packet.inputs, artifacts, candidateDispositions: packet.candidateDispositions ?? [], rationale: packet.rationale, truncated, ...(truncated ? { continuationCursor: Buffer.from(String(next), "utf-8").toString("base64url") } : {}) };
  }

  async readProposal(outputRoot: string, runId: string, contentHash: string): Promise<StoredProposal> {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Proposal hash must be a SHA-256 hex string");
    const directory = join(outputRoot, "stages", "runs", runId, "proposals");
    if (!existsSync(directory)) throw new Error(`Declared shard proposal ${contentHash} does not exist`);
    const file = (await readdir(directory)).find((name) => name.endsWith(`-${contentHash}.json`));
    if (!file) throw new Error(`Declared shard proposal ${contentHash} does not exist`);
    const packet = JSON.parse(await readFile(join(directory, file), "utf-8")) as StoredProposal;
    if (packet.runId !== runId || packet.contentHash !== contentHash) throw new Error(`Declared shard proposal ${contentHash} is invalid`);
    return packet;
  }

  private async validatePacket(outputRoot: string, allowedUnitIds: string[], allowedCandidateIds: string[] | undefined, value: unknown, planHash?: string, clusterId?: string): Promise<ShardProposalPacket> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Proposal packet must be an object");
    const packet = structuredClone(value) as ShardProposalPacket;
    if (packet.version !== 1 || packet.kind !== "mem-import-proposal") throw new Error("Proposal packet must be version-1 mem-import-proposal");
    assertId(packet.id, "packet.id");
    if (planHash) {
      if (packet.planHash !== planHash || packet.clusterId !== clusterId) throw new Error("Proposal packet planHash/clusterId must match its planned assignment");
    } else if (packet.planHash !== undefined || packet.clusterId !== undefined) throw new Error("Unplanned proposal packets must not claim a cluster-plan binding");
    if (!Array.isArray(packet.inputs) || packet.inputs.length === 0) throw new Error("Proposal packet requires at least one input extraction packet");
    if (!Array.isArray(packet.artifacts)) throw new Error("Proposal packet artifacts must be an array");
    if (typeof packet.rationale !== "string" || !packet.rationale.trim()) throw new Error("Proposal packet rationale must be non-empty");

    const inputUnitIds = new Set<string>();
    for (const input of packet.inputs) {
      if (!input || typeof input !== "object" || typeof input.unitId !== "string" || typeof input.packetHash !== "string" || !/^[a-f0-9]{64}$/.test(input.packetHash)) throw new Error("Proposal inputs require unitId and SHA-256 packetHash");
      if (!allowedUnitIds.includes(input.unitId)) throw new Error(`Proposal input unit ${input.unitId} is outside this assignment`);
      if (inputUnitIds.has(input.unitId)) throw new Error(`Proposal inputs duplicate unit ${input.unitId}`);
      inputUnitIds.add(input.unitId);
      const stagePath = extractionStagePath(outputRoot, input.unitId);
      if (!existsSync(stagePath)) throw new Error(`Proposal input extraction packet ${input.unitId} does not exist`);
      const stage = JSON.parse(await readFile(stagePath, "utf-8")) as StageEnvelope;
      if (!Array.isArray(stage.candidates) || createHash("sha256").update(JSON.stringify(stage)).digest("hex") !== input.packetHash) throw new Error(`Proposal input extraction packet ${input.unitId} is stale or invalid`);
      if (input.candidateIds !== undefined) {
        if (!Array.isArray(input.candidateIds) || input.candidateIds.length === 0 || input.candidateIds.some((id) => typeof id !== "string" || !id.trim())) throw new Error(`Proposal input ${input.unitId} candidateIds must be a non-empty string array`);
        const available = new Set(stage.candidates.map((candidate) => candidate.id));
        for (const candidateId of input.candidateIds) {
          if (!available.has(candidateId)) throw new Error(`Proposal input candidate ${input.unitId}:${candidateId} does not exist`);
          if (allowedCandidateIds?.length && !allowedCandidateIds.includes(`${input.unitId}:${candidateId}`)) throw new Error(`Proposal input candidate ${input.unitId}:${candidateId} is outside this assignment`);
        }
      }
    }

    const stage: StageEnvelope = {
      version: 1,
      kind: "merge",
      artifacts: packet.artifacts as StageEnvelope["artifacts"],
      candidateDispositions: packet.candidateDispositions as StageEnvelope["candidateDispositions"],
      diagnostics: packet.diagnostics as StageEnvelope["diagnostics"],
    };
    await this.deriveAndAssertProvenance(outputRoot, stage, inputUnitIds);
    validateStageEnvelope(stage, { requireArtifacts: true });
    return { ...packet, artifacts: stage.artifacts ?? [], ...(stage.candidateDispositions ? { candidateDispositions: stage.candidateDispositions } : {}), ...(stage.diagnostics ? { diagnostics: stage.diagnostics } : {}) };
  }

  private async deriveAndAssertProvenance(outputRoot: string, stage: StageEnvelope, allowedUnitIds: Set<string>): Promise<void> {
    for (const artifact of stage.artifacts ?? []) {
      for (const [index, ref] of (artifact.provenance ?? []).entries()) {
        if (!allowedUnitIds.has(ref.unitId)) throw new Error(`Artifact ${artifact.id} provenance[${index}] cites a unit outside this proposal assignment`);
        const unit = await readNormalizedUnit(outputRoot, ref.unitId);
        if (unit.sourceId !== ref.sourceId) throw new Error(`Artifact ${artifact.id} provenance[${index}] sourceId does not match normalized source`);
        const start = unit.blocks.findIndex((block) => block.anchor === ref.startAnchor);
        const end = unit.blocks.findIndex((block) => block.anchor === ref.endAnchor);
        if (start < 0 || end < start) throw new Error(`Artifact ${artifact.id} provenance[${index}] has invalid local anchors`);
        const quote = unit.blocks.slice(start, end + 1).map((block) => block.text).join("\n\n");
        // Artifact anchors are model-selected; quote transcription is service-owned.
        ref.quote = quote;
      }
    }
  }

  private async findPlannedProposal(outputRoot: string, runId: string, planHash: string, clusterId: string): Promise<{ path: string; contentHash: string } | undefined> {
    const directory = join(outputRoot, "stages", "runs", runId, "proposals");
    if (!existsSync(directory)) return undefined;
    let found: { path: string; contentHash: string } | undefined;
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json"))) {
      const packet = JSON.parse(await readFile(join(directory, file), "utf-8")) as StoredProposal;
      if (packet.planHash !== planHash || packet.clusterId !== clusterId) continue;
      if (found && found.contentHash !== packet.contentHash) throw new Error(`Cluster ${clusterId} has more than one effective proposal`);
      found = { path: this.relative(outputRoot, join(directory, file)), contentHash: packet.contentHash };
    }
    return found;
  }

  private relative(outputRoot: string, path: string): string {
    return path.startsWith(`${outputRoot}/`) ? path.slice(outputRoot.length + 1) : path;
  }
}
