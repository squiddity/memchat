import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
  inputs: ProposalInput[];
  artifacts: unknown[];
  candidateDispositions?: unknown[];
  diagnostics?: Array<{ level: "info" | "warning" | "error"; message: string; path?: string }>;
  rationale: string;
  metadata?: Record<string, unknown>;
};

type StoredProposal = ShardProposalPacket & {
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
    const assignment = await this.base.authorizeWorker({ ...options, capability: "proposal:submit", role: "proposer" });
    const packet = await this.validatePacket(assignment.outputRoot, assignment.allowedUnitIds, assignment.allowedCandidateIds, options.packet);
    const contentHash = hash(packet);
    const path = proposalPath(assignment.outputRoot, assignment.runId, packet.id, contentHash);
    if (existsSync(path)) return { path: this.relative(assignment.outputRoot, path), contentHash };
    const stored: StoredProposal = { ...packet, runId: assignment.runId, taskId: assignment.taskId, contentHash, submittedAt: this.now().toISOString() };
    await writeJson(path, stored);
    return { path: this.relative(assignment.outputRoot, path), contentHash };
  }

  private async validatePacket(outputRoot: string, allowedUnitIds: string[], allowedCandidateIds: string[] | undefined, value: unknown): Promise<ShardProposalPacket> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Proposal packet must be an object");
    const packet = structuredClone(value) as ShardProposalPacket;
    if (packet.version !== 1 || packet.kind !== "mem-import-proposal") throw new Error("Proposal packet must be version-1 mem-import-proposal");
    assertId(packet.id, "packet.id");
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
        if (!ref.quote) ref.quote = quote;
        if (!quote.includes(ref.quote)) throw new Error(`Artifact ${artifact.id} provenance[${index}].quote must be a literal contiguous excerpt of normalized source text`);
      }
    }
  }

  private relative(outputRoot: string, path: string): string {
    return path.startsWith(`${outputRoot}/`) ? path.slice(outputRoot.length + 1) : path;
  }
}
