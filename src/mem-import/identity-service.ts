import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeJson } from "../world-import/staging.js";
import { MemImportService } from "./service.js";

type WorkerAuthority = { outputRoot: string; runId: string; taskId: string; grant: string };

export type IdentityDecision = {
  id: string;
  provisionalId: string;
  disposition: "match" | "create" | "ambiguous";
  /** Required for match/create; absent for unresolved ambiguity. */
  canonicalId?: string;
  alternatives?: Array<{ canonicalId: string; artifactHash?: string; summary?: string }>;
  evidenceRefs?: unknown[];
  conflictId?: string;
  blocking?: boolean;
  rationale: string;
};

export type IdentityProposalPacket = {
  version: 1;
  kind: "mem-import-identity";
  id: string;
  proposalHashes: string[];
  baselineRevision: number;
  baselineContentHash: string | null;
  decisions: IdentityDecision[];
  diagnostics?: Array<{ level: "info" | "warning" | "error"; message: string; path?: string }>;
  rationale: string;
  metadata?: Record<string, unknown>;
};

export type StoredIdentityProposal = IdentityProposalPacket & {
  runId: string;
  taskId: string;
  contentHash: string;
  submittedAt: string;
};

function identityDir(outputRoot: string, runId: string): string { return join(outputRoot, "stages", "runs", runId, "identity"); }
function identityPath(outputRoot: string, runId: string, id: string, contentHash: string): string { return join(identityDir(outputRoot, runId), `${id}-${contentHash}.json`); }

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function assertMemImportId(value: string, label: string): void {
  if (!value.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens`);
}

/** Immutable model-authored reconciliation proposals. This service validates scope,
 * identity references, and packet immutability; it never chooses an identity. */
export class MemImportIdentityService {
  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {}

  async submitWorkerIdentity(options: WorkerAuthority & { packet: unknown }): Promise<{ path: string; contentHash: string }> {
    return this.base.withRunMutation(options.outputRoot, () => this.submitWorkerIdentityLocked(options));
  }

  private async submitWorkerIdentityLocked(options: WorkerAuthority & { packet: unknown }): Promise<{ path: string; contentHash: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "identity:submit", role: "reconciler" });
    const packet = await this.validatePacket(assignment.outputRoot, assignment.runId, assignment.allowedProposalHashes, options.packet);
    const contentHash = canonicalHash(packet);
    const path = identityPath(assignment.outputRoot, assignment.runId, packet.id, contentHash);
    if (existsSync(path)) return { path: this.relative(assignment.outputRoot, path), contentHash };
    await mkdir(identityDir(assignment.outputRoot, assignment.runId), { recursive: true, mode: 0o700 });
    const stored: StoredIdentityProposal = { ...packet, runId: assignment.runId, taskId: assignment.taskId, contentHash, submittedAt: this.now().toISOString() };
    await writeJson(path, stored);
    await this.base.recordWorkerEffect(assignment, { kind: "identity", path: this.relative(assignment.outputRoot, path), contentHash });
    return { path: this.relative(assignment.outputRoot, path), contentHash };
  }

  async inventoryWorkerIdentity(options: WorkerAuthority & { continuationCursor?: string; maxItems?: number }): Promise<{ entries: Array<{ identityProposalHash: string; id: string; decisionCount: number }>; truncated: boolean; continuationCursor?: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    if (!["merger", "repairer"].includes(assignment.role)) throw new Error("Identity packet reads require a merger or repairer assignment");
    const maxItems = options.maxItems ?? 25;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    const directory = identityDir(assignment.outputRoot, assignment.runId);
    const after = options.continuationCursor ? Buffer.from(options.continuationCursor, "base64url").toString("utf-8") : "";
    const rows: Array<{ file: string; packet: StoredIdentityProposal }> = [];
    for (const file of (existsSync(directory) ? await readdir(directory) : []).filter((name) => name.endsWith(".json") && name > after).sort()) {
      const packet = JSON.parse(await readFile(join(directory, file), "utf-8")) as StoredIdentityProposal;
      rows.push({ file, packet });
    }
    const page = rows.slice(0, maxItems);
    const truncated = rows.length > page.length;
    const last = page.at(-1);
    return {
      entries: page.map(({ packet }) => ({ identityProposalHash: packet.contentHash, id: packet.id, decisionCount: packet.decisions.length })),
      truncated,
      ...(truncated && last ? { continuationCursor: Buffer.from(last.file, "utf-8").toString("base64url") } : {}),
    };
  }

  async readWorkerIdentity(options: WorkerAuthority & { identityProposalHash: string; continuationCursor?: string; maxDecisions?: number }): Promise<{ identityProposalHash: string; id: string; proposalHashes: string[]; baselineRevision: number; baselineContentHash: string | null; decisions: IdentityDecision[]; rationale: string; truncated: boolean; continuationCursor?: string }> {
    const assignment = await this.base.authorizeWorker({ ...options, capability: "merge:read" });
    if (!["merger", "repairer"].includes(assignment.role)) throw new Error("Identity packet reads require a merger or repairer assignment");
    const packet = await this.readIdentityProposal(assignment.outputRoot, assignment.runId, options.identityProposalHash);
    const maxDecisions = options.maxDecisions ?? 25;
    if (!Number.isInteger(maxDecisions) || maxDecisions < 1 || maxDecisions > 100) throw new Error("maxDecisions must be an integer between 1 and 100");
    const offset = options.continuationCursor ? Number.parseInt(Buffer.from(options.continuationCursor, "base64url").toString("utf-8"), 10) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > packet.decisions.length) throw new Error("Invalid identity continuation cursor");
    const decisions = packet.decisions.slice(offset, offset + maxDecisions);
    const next = offset + decisions.length;
    const truncated = next < packet.decisions.length;
    return { identityProposalHash: packet.contentHash, id: packet.id, proposalHashes: packet.proposalHashes, baselineRevision: packet.baselineRevision, baselineContentHash: packet.baselineContentHash, decisions, rationale: packet.rationale, truncated, ...(truncated ? { continuationCursor: Buffer.from(String(next), "utf-8").toString("base64url") } : {}) };
  }

  async readIdentityProposal(outputRoot: string, runId: string, contentHash: string): Promise<StoredIdentityProposal> {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Identity proposal hash must be a SHA-256 hex string");
    const directory = identityDir(outputRoot, runId);
    if (!existsSync(directory)) throw new Error(`Declared identity proposal ${contentHash} does not exist`);
    const file = (await readdir(directory)).find((name) => name.endsWith(`-${contentHash}.json`));
    if (!file) throw new Error(`Declared identity proposal ${contentHash} does not exist`);
    const packet = JSON.parse(await readFile(join(directory, file), "utf-8")) as StoredIdentityProposal;
    if (packet.runId !== runId || packet.contentHash !== contentHash) throw new Error(`Declared identity proposal ${contentHash} is invalid`);
    return packet;
  }

  private async validatePacket(outputRoot: string, runId: string, allowedProposalHashes: string[] | undefined, value: unknown): Promise<IdentityProposalPacket> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Identity proposal packet must be an object");
    const packet = structuredClone(value) as IdentityProposalPacket;
    if (packet.version !== 1 || packet.kind !== "mem-import-identity") throw new Error("Identity proposal packet must be version-1 mem-import-identity");
    assertMemImportId(packet.id, "packet.id");
    if (!Array.isArray(packet.proposalHashes) || packet.proposalHashes.length === 0 || packet.proposalHashes.length > 100 || packet.proposalHashes.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new Error("Identity proposal packet requires one to one hundred proposal hashes");
    if (new Set(packet.proposalHashes).size !== packet.proposalHashes.length) throw new Error("Identity proposal packet proposalHashes must be unique");
    if (allowedProposalHashes?.length && packet.proposalHashes.some((item) => !allowedProposalHashes.includes(item))) throw new Error("An identity proposal hash is outside this reconciliation assignment");
    await Promise.all(packet.proposalHashes.map((proposalHash) => this.assertProposalExists(outputRoot, runId, proposalHash)));
    if (!Number.isInteger(packet.baselineRevision) || packet.baselineRevision < 0 || (packet.baselineContentHash !== null && !/^[a-f0-9]{64}$/.test(packet.baselineContentHash))) throw new Error("Identity proposal baseline revision/hash is invalid");
    if (!Array.isArray(packet.decisions) || packet.decisions.length === 0 || packet.decisions.length > 100) throw new Error("Identity proposal packet requires one to one hundred decisions");
    if (typeof packet.rationale !== "string" || !packet.rationale.trim()) throw new Error("Identity proposal packet rationale must be non-empty");
    const decisionIds = new Set<string>();
    const provisionalIds = new Set<string>();
    for (const decision of packet.decisions) {
      if (!decision || typeof decision !== "object") throw new Error("Identity proposal decision must be an object");
      assertMemImportId(decision.id, "identity decision id");
      assertMemImportId(decision.provisionalId, "identity provisionalId");
      if (decisionIds.has(decision.id) || provisionalIds.has(decision.provisionalId)) throw new Error("Identity proposal decisions must use unique ids and provisionalIds");
      decisionIds.add(decision.id); provisionalIds.add(decision.provisionalId);
      if (!["match", "create", "ambiguous"].includes(decision.disposition)) throw new Error("Identity decision disposition must be match, create, or ambiguous");
      if (decision.disposition === "ambiguous") {
        if (decision.canonicalId !== undefined) throw new Error("Ambiguous identity decisions must not select a canonicalId");
        if (decision.blocking && !decision.conflictId) throw new Error("Blocking ambiguous identity decisions require a conflictId");
      } else if (typeof decision.canonicalId !== "string") throw new Error("Match/create identity decisions require canonicalId");
      if (decision.canonicalId) assertMemImportId(decision.canonicalId, "identity canonicalId");
      if (decision.conflictId) assertMemImportId(decision.conflictId, "identity conflictId");
      if (decision.alternatives !== undefined && (!Array.isArray(decision.alternatives) || decision.alternatives.length > 25 || decision.alternatives.some((item) => !item || typeof item.canonicalId !== "string"))) throw new Error("Identity alternatives must be a bounded canonicalId array");
      if (typeof decision.rationale !== "string" || !decision.rationale.trim()) throw new Error("Identity decision rationale must be non-empty");
    }
    return packet;
  }

  private async assertProposalExists(outputRoot: string, runId: string, contentHash: string): Promise<void> {
    const directory = join(outputRoot, "stages", "runs", runId, "proposals");
    if (!existsSync(directory)) throw new Error(`Declared shard proposal ${contentHash} does not exist`);
    const file = (await readdir(directory)).find((name) => name.endsWith(`-${contentHash}.json`));
    if (!file) throw new Error(`Declared shard proposal ${contentHash} does not exist`);
  }

  private relative(outputRoot: string, path: string): string { return path.startsWith(`${outputRoot}/`) ? path.slice(outputRoot.length + 1) : path; }
}
