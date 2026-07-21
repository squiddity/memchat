import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeSources } from "../world-import/normalize.js";
import { readSlice } from "../world-import/spans.js";
import {
  extractionStagePath,
  readExtractionStages,
  readManifest,
  readNormalizedUnit,
  writeExtractionStage,
  writeJson,
} from "../world-import/staging.js";
import { validateStageEnvelope } from "../world-import/staging.js";
import { WORLD_IMPORT_GROUPS, type SourceManifest, type SourceManifestEntry, type StageEnvelope, type WorldImportGroup } from "../world-import/types.js";

export const MEM_IMPORT_RUN_VERSION = 1;
export const EXTRACTOR_CAPABILITIES = ["source:read", "extraction:read", "extraction:validate", "extraction:submit"] as const;
export const MEM_IMPORT_CAPABILITIES = [
  ...EXTRACTOR_CAPABILITIES,
  "merge:read",
  "merge:lease",
  "merge:write",
  "proposal:submit",
  "identity:read",
  "identity:submit",
  "review:read",
  "review:submit",
  "check:read",
] as const;

export type ExtractorCapability = (typeof EXTRACTOR_CAPABILITIES)[number];
export type MemImportCapability = (typeof MEM_IMPORT_CAPABILITIES)[number];
export type AssignmentRole = "extractor" | "proposer" | "reconciler" | "merger" | "reviewer" | "repairer";
export type LifecycleOutcome = "assigned" | "submitted" | "revoked" | "superseded" | "completed";
export type DispatchFacility = "ordinary-subagent" | "managed-agent" | "inline" | "unknown";
export type DispatchOutcome = "completed" | "failed" | "cancelled";
export type MemImportTerminalStatus = "failed" | "finalized";

const MUTATING_WORKER_CAPABILITIES = new Set<MemImportCapability>([
  "extraction:submit",
  "merge:lease",
  "merge:write",
  "proposal:submit",
  "identity:submit",
  "review:submit",
]);

/** Exact model-visible role allowlists expected from an ordinary semantic worker. */
export const MEM_IMPORT_ROLE_TOOLS: Record<AssignmentRole, string[]> = {
  extractor: ["mem_source_read_unit", "mem_extraction_status", "mem_extraction_read", "mem_extraction_validate", "mem_extraction_submit"],
  proposer: ["mem_source_read_worker", "mem_extraction_inventory_worker", "mem_extraction_read_worker", "mem_proposal_submit"],
  reconciler: ["mem_proposal_inventory", "mem_proposal_read", "mem_merge_inventory", "mem_merge_read_artifact", "mem_source_read_worker", "mem_extraction_inventory_worker", "mem_extraction_read_worker", "mem_identity_submit"],
  merger: ["mem_proposal_inventory", "mem_proposal_read", "mem_identity_inventory", "mem_identity_read", "mem_merge_inventory", "mem_merge_read_artifact", "mem_source_read_worker", "mem_extraction_inventory_worker", "mem_extraction_read_worker", "mem_merge_commit"],
  reviewer: ["mem_merge_inventory", "mem_merge_read_artifact", "mem_source_read_worker", "mem_extraction_inventory_worker", "mem_extraction_read_worker", "mem_review_submit"],
  repairer: ["mem_proposal_inventory", "mem_proposal_read", "mem_identity_inventory", "mem_identity_read", "mem_merge_inventory", "mem_merge_read_artifact", "mem_source_read_worker", "mem_extraction_read_worker", "mem_merge_acquire_lease", "mem_merge_heartbeat_lease", "mem_merge_apply_repair_batch", "mem_merge_release_lease"],
};

export type MemImportDispatchRecord = {
  version: 1;
  kind: "mem-import-worker-dispatch";
  runId: string;
  taskId: string;
  role: AssignmentRole;
  facility: DispatchFacility;
  hostTaskId: string;
  requestedTools: string[];
  observedTools: string[];
  outcome: DispatchOutcome;
  requestedModel?: string;
  observedModel?: string;
  requestedThinking?: string;
  observedThinking?: string;
  recordedAt: string;
};

/** Deliberately small, credential-free runtime identity supplied by the parent. */
export type MemImportActorAudit = {
  model?: string;
  thinking?: string;
};

export type MemImportAssignmentAudit = {
  parent?: MemImportActorAudit;
  worker?: MemImportActorAudit;
  adapter?: string;
  profile?: string;
};

export type MemImportRunRecord = {
  version: 1;
  kind: "mem-import-run";
  runId: string;
  outputRoot: string;
  coordinatorTokenHash: string;
  createdAt: string;
  normalizedAt?: string;
  terminal?: {
    status: MemImportTerminalStatus;
    at: string;
    reason?: string;
  };
  /** Present for runs allocated under a persistent compendium; canonical state lives there. */
  compendiumRoot?: string;
  audit?: { parent?: MemImportActorAudit };
};

export type MemImportAssignmentRecord = {
  version: 1;
  kind: "mem-import-assignment";
  runId: string;
  taskId: string;
  role: AssignmentRole;
  outputRoot: string;
  allowedUnitIds: string[];
  /** Proposal grants can additionally restrict candidate IDs within their allowed units. */
  allowedCandidateIds?: string[];
  /** Reconciliation grants can name exact immutable shard-proposal hashes. */
  allowedProposalHashes?: string[];
  /** Repair grants name the checkpoint actions they may implement; other roles leave these empty. */
  allowedCheckpointIds?: string[];
  allowedActionIds?: string[];
  capabilities: MemImportCapability[];
  tokenHash: string;
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

export type BeginRunResult = {
  runId: string;
  outputRoot: string;
  coordinatorGrant: string;
};

export type ExtractorAssignmentUnit = Pick<SourceManifestEntry, "unitId" | "sourceId" | "order" | "title" | "role" | "blockCount">;

export type ExtractorAssignmentResult = {
  runId: string;
  taskId: string;
  outputRoot: string;
  grant: string;
  unitIds: string[];
  /** Compact assigned-unit context for the coordinator and bounded worker bootstrap. */
  units: ExtractorAssignmentUnit[];
  expiresAt: string;
  capabilities: ExtractorCapability[];
  /** Exact model-visible tools the host must allow for this worker. */
  tools: string[];
};

export type WorkerAssignmentResult = {
  runId: string;
  taskId: string;
  outputRoot: string;
  grant: string;
  role: Exclude<AssignmentRole, "extractor">;
  expiresAt: string;
  capabilities: MemImportCapability[];
  unitIds: string[];
  candidateIds: string[];
  proposalHashes: string[];
  checkpointIds: string[];
  actionIds: string[];
  /** Exact model-visible tools the host must allow for this worker. */
  tools: string[];
  units: Array<{ unitId: string; sourceId: string }>;
};

export type SourceReadResult = {
  unit: Pick<SourceManifestEntry, "unitId" | "sourceId" | "order" | "title" | "role" | "anchors" | "blockCount">;
  content: string;
  /** Source characters in the requested unit or anchor slice before any response limit. */
  totalChars: number;
  /** Characters emitted in content. */
  returnedChars: number;
  truncated: boolean;
  /** Opaque cursor for the next byte-for-byte monotonic page of this same source range. */
  continuationCursor?: string;
  /** Retained only when the next page begins at a block boundary; cursors are required for arbitrary continuation. */
  nextAnchor?: string;
};

export type ExtractionStatusResult = {
  assignedUnitIds: string[];
  submittedUnitIds: string[];
  missingUnitIds: string[];
};

/** Small, page-safe summary of one persisted extraction packet. */
export type ExtractionInventoryEntry = {
  unitId: string;
  sourceId: string;
  packetHash: string;
  candidateCount: number;
  groupCounts: Partial<Record<WorldImportGroup, number>>;
};

export type ExtractionInventoryResult = {
  entries: ExtractionInventoryEntry[];
  returnedItems: number;
  truncated: boolean;
  continuationCursor?: string;
};

/** A bounded candidate page from exactly one extraction packet. */
export type ExtractionPacketResult = {
  unitId: string;
  sourceId: string;
  packetHash: string;
  totalCandidates: number;
  candidates: NonNullable<StageEnvelope["candidates"]>;
  truncated: boolean;
  continuationCursor?: string;
};

type Clock = () => Date;
type SourceCursor = {
  version: 1;
  unitId: string;
  contentHash: string;
  startAnchor: string;
  endAnchor: string;
  offset: number;
};

type ExtractionInventoryCursor = {
  version: 1;
  kind: "extraction-inventory";
  afterOrder: number;
  afterUnitId: string;
  group?: WorldImportGroup;
};

type ExtractionPacketCursor = {
  version: 1;
  kind: "extraction-packet";
  unitId: string;
  packetHash: string;
  candidateIdsHash: string;
  offset: number;
};

function orchestrationDir(outputRoot: string): string {
  return `${outputRoot}/stages/orchestration`;
}

function runPath(outputRoot: string): string {
  return `${orchestrationDir(outputRoot)}/run.json`;
}

function assignmentPath(outputRoot: string, taskId: string): string {
  return `${orchestrationDir(outputRoot)}/assignments/${taskId}.json`;
}

function assignmentEffectPath(outputRoot: string, taskId: string, unitId: string): string {
  return `${orchestrationDir(outputRoot)}/effects/${taskId}/${createHash("sha256").update(unitId).digest("hex")}.json`;
}

function dispatchPath(outputRoot: string, taskId: string): string {
  return `${orchestrationDir(outputRoot)}/dispatches/${taskId}.json`;
}

function extractionInventoryPath(outputRoot: string, unitId: string): string {
  return `${orchestrationDir(outputRoot)}/extraction-inventory/${unitId}.json`;
}

async function writeAuthorizationEvent(outputRoot: string, event: Record<string, unknown>): Promise<void> {
  const nonce = randomBytes(6).toString("hex");
  await writeJson(`${orchestrationDir(outputRoot)}/authorization-events/${new Date().toISOString().replace(/[:.]/g, "-")}-${nonce}.json`, {
    version: 1,
    kind: "mem-import-authorization-event",
    at: new Date().toISOString(),
    ...event,
  });
}

function unitLockPath(outputRoot: string, unitId: string): string {
  return `${orchestrationDir(outputRoot)}/locks/extraction-${createHash("sha256").update(unitId).digest("hex")}`;
}

function canonicalOutputRoot(outputRoot: string): string {
  if (!outputRoot.trim()) throw new Error("outputRoot must be non-empty");
  return resolve(outputRoot);
}

function requireNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function newRunId(): string {
  return `mir-${randomBytes(12).toString("hex")}`;
}

function assertTaskId(taskId: string): void {
  requireNonEmpty(taskId, "taskId");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(taskId)) {
    throw new Error("taskId must contain only letters, numbers, dots, underscores, and hyphens");
  }
}

/** Host correlation IDs are opaque labels, never local paths, prompts, or credentials. */
function assertHostTaskId(hostTaskId: string): void {
  requireNonEmpty(hostTaskId, "hostTaskId");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(hostTaskId)) {
    throw new Error("hostTaskId must be a sanitized opaque identifier, not a path");
  }
}

function sameToolSet(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}

function asIsoDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseActorAudit(value: unknown): MemImportActorAudit | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid mem-import audit actor");
  for (const key of ["model", "thinking"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim())) throw new Error(`Invalid mem-import audit actor ${key}`);
  }
  return { ...(typeof value.model === "string" ? { model: value.model } : {}), ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}) };
}

function sanitizeAudit(value: MemImportAssignmentAudit | undefined): MemImportAssignmentAudit | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("audit must be an object");
  const audit = value as Record<string, unknown>;
  const parent = parseActorAudit(audit.parent);
  const worker = parseActorAudit(audit.worker);
  for (const key of ["adapter", "profile"] as const) {
    if (audit[key] !== undefined && (typeof audit[key] !== "string" || !audit[key].trim())) throw new Error(`audit.${key} must be a non-empty string`);
  }
  return {
    ...(parent ? { parent } : {}),
    ...(worker ? { worker } : {}),
    ...(typeof value.adapter === "string" ? { adapter: value.adapter } : {}),
    ...(typeof value.profile === "string" ? { profile: value.profile } : {}),
  };
}

function parseRunRecord(value: unknown): MemImportRunRecord {
  if (!isRecord(value)
    || value.version !== MEM_IMPORT_RUN_VERSION
    || value.kind !== "mem-import-run"
    || typeof value.runId !== "string"
    || typeof value.outputRoot !== "string"
    || typeof value.coordinatorTokenHash !== "string"
    || typeof value.createdAt !== "string"
    || (value.normalizedAt !== undefined && typeof value.normalizedAt !== "string")
    || (value.terminal !== undefined && (!isRecord(value.terminal)
      || !["failed", "finalized"].includes(String(value.terminal.status))
      || typeof value.terminal.at !== "string"
      || (value.terminal.reason !== undefined && typeof value.terminal.reason !== "string")))
    || (value.compendiumRoot !== undefined && typeof value.compendiumRoot !== "string")) {
    throw new Error("Invalid mem-import run record");
  }
  const audit = value.audit === undefined ? undefined : (() => {
    if (!isRecord(value.audit)) throw new Error("Invalid mem-import run record");
    return { ...(parseActorAudit(value.audit.parent) ? { parent: parseActorAudit(value.audit.parent)! } : {}) };
  })();
  return { ...value, ...(audit ? { audit } : {}) } as MemImportRunRecord;
}

function parseAssignmentRecord(value: unknown): MemImportAssignmentRecord {
  if (!isRecord(value)
    || value.version !== MEM_IMPORT_RUN_VERSION
    || value.kind !== "mem-import-assignment"
    || typeof value.runId !== "string"
    || typeof value.taskId !== "string"
    || !["extractor", "proposer", "reconciler", "merger", "reviewer", "repairer"].includes(String(value.role))
    || typeof value.outputRoot !== "string"
    || !Array.isArray(value.allowedUnitIds) || !value.allowedUnitIds.every((item) => typeof item === "string")
    || (value.allowedCandidateIds !== undefined && (!Array.isArray(value.allowedCandidateIds) || !value.allowedCandidateIds.every((item) => typeof item === "string")))
    || (value.allowedProposalHashes !== undefined && (!Array.isArray(value.allowedProposalHashes) || !value.allowedProposalHashes.every((item) => typeof item === "string")))
    || (value.allowedCheckpointIds !== undefined && (!Array.isArray(value.allowedCheckpointIds) || !value.allowedCheckpointIds.every((item) => typeof item === "string")))
    || (value.allowedActionIds !== undefined && (!Array.isArray(value.allowedActionIds) || !value.allowedActionIds.every((item) => typeof item === "string")))
    || !Array.isArray(value.capabilities) || !value.capabilities.every((item) => MEM_IMPORT_CAPABILITIES.includes(item as MemImportCapability))
    || typeof value.tokenHash !== "string"
    || typeof value.issuedAt !== "string"
    || typeof value.expiresAt !== "string"
    || (value.revokedAt !== undefined && typeof value.revokedAt !== "string")
    || (value.supersededAt !== undefined && typeof value.supersededAt !== "string")
    || (value.supersededByTaskId !== undefined && typeof value.supersededByTaskId !== "string")
    || (value.supersedesTaskIds !== undefined && (!Array.isArray(value.supersedesTaskIds) || !value.supersedesTaskIds.every((item) => typeof item === "string")))
    || (value.retriesTaskId !== undefined && typeof value.retriesTaskId !== "string")
    || (value.lifecycleOutcome !== undefined && !["assigned", "submitted", "revoked", "superseded", "completed"].includes(String(value.lifecycleOutcome)))) {
    throw new Error("Invalid mem-import assignment record");
  }
  // U1 records predate lifecycle evidence; treat them as live assigned records until changed by U1a operations.
  return { ...value, lifecycleOutcome: (value.lifecycleOutcome ?? "assigned") as LifecycleOutcome, ...(value.audit === undefined ? {} : { audit: sanitizeAudit(value.audit as MemImportAssignmentAudit) }) } as MemImportAssignmentRecord;
}

async function readRun(outputRoot: string): Promise<MemImportRunRecord> {
  const path = runPath(outputRoot);
  if (!existsSync(path)) throw new Error("No active mem-import run exists for outputRoot; call mem_import_begin first");
  return parseRunRecord(JSON.parse(await readFile(path, "utf-8")));
}

async function readAssignment(outputRoot: string, taskId: string): Promise<MemImportAssignmentRecord> {
  const path = assignmentPath(outputRoot, taskId);
  if (!existsSync(path)) throw new Error(`No assignment exists for taskId ${taskId}`);
  return parseAssignmentRecord(JSON.parse(await readFile(path, "utf-8")));
}

async function readAssignments(outputRoot: string): Promise<MemImportAssignmentRecord[]> {
  const directory = `${orchestrationDir(outputRoot)}/assignments`;
  if (!existsSync(directory)) return [];
  return Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json")).sort().map(async (name) => parseAssignmentRecord(JSON.parse(await readFile(`${directory}/${name}`, "utf-8")))));
}

function assertRunScope(run: MemImportRunRecord, outputRoot: string, runId: string): void {
  if (run.version !== MEM_IMPORT_RUN_VERSION || run.kind !== "mem-import-run") throw new Error("Invalid mem-import run record");
  if (run.outputRoot !== outputRoot) throw new Error("Run outputRoot does not match requested outputRoot");
  if (run.runId !== runId) throw new Error("runId does not match the active output-root run");
}

function isLiveAssignment(assignment: MemImportAssignmentRecord, now: Date): boolean {
  return !assignment.revokedAt && !assignment.supersededAt && asIsoDate(assignment.expiresAt, "assignment.expiresAt").getTime() > now.getTime();
}

function assertRunMutable(run: MemImportRunRecord): void {
  if (!run.terminal) return;
  throw new Error(`Mem-import run is terminal (${run.terminal.status} at ${run.terminal.at}); semantic mutation is no longer allowed`);
}

async function withUnitLocks<T>(outputRoot: string, unitIds: string[], action: () => Promise<T>): Promise<T> {
  await mkdir(`${orchestrationDir(outputRoot)}/locks`, { recursive: true, mode: 0o700 });
  const paths = [...new Set(unitIds)].sort().map((unitId) => unitLockPath(outputRoot, unitId));
  const acquired: string[] = [];
  try {
    for (const path of paths) {
      try {
        await mkdir(path, { recursive: false, mode: 0o700 });
        acquired.push(path);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("An extraction mutation is already in progress for an assigned unit; retry after it completes");
        throw error;
      }
    }
    return await action();
  } finally {
    await Promise.all(acquired.reverse().map((path) => rm(path, { recursive: true, force: true })));
  }
}

function encodeCursor(cursor: SourceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

function decodeCursor(value: string): SourceCursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as unknown;
    if (!isRecord(cursor)
      || cursor.version !== 1
      || typeof cursor.unitId !== "string"
      || typeof cursor.contentHash !== "string"
      || typeof cursor.startAnchor !== "string"
      || typeof cursor.endAnchor !== "string"
      || typeof cursor.offset !== "number"
      || !Number.isInteger(cursor.offset)
      || cursor.offset < 0) throw new Error("shape");
    return cursor as SourceCursor;
  } catch {
    throw new Error("Invalid source continuation cursor");
  }
}

function renderedSourceRange(blocks: Array<{ anchor: string; text: string }>): string {
  return blocks.map((block) => `[${block.anchor}] ${block.text}`).join("\n\n");
}

/** Canonical quote representation: selected normalized block text joined by exactly two LF characters. */
function canonicalQuoteRange(blocks: Array<{ text: string }>): string {
  return blocks.map((block) => block.text).join("\n\n");
}

export class MemImportService {
  constructor(private readonly now: Clock = () => new Date()) {}

  async begin(outputRootInput: string, audit?: { parent?: MemImportActorAudit }, scope?: { compendiumRoot?: string }): Promise<BeginRunResult> {
    const outputRoot = canonicalOutputRoot(outputRootInput);
    const existing = existsSync(runPath(outputRoot)) ? await readRun(outputRoot) : undefined;
    if (existing) throw new Error(`A mem-import run already exists for outputRoot (${existing.runId}); use its coordinator grant or choose a fresh outputRoot`);
    const coordinatorGrant = newToken();
    const parent = audit ? parseActorAudit(audit.parent) : undefined;
    const record: MemImportRunRecord = {
      version: MEM_IMPORT_RUN_VERSION,
      kind: "mem-import-run",
      runId: newRunId(),
      outputRoot,
      coordinatorTokenHash: hashToken(coordinatorGrant),
      createdAt: this.now().toISOString(),
      ...(scope?.compendiumRoot ? { compendiumRoot: canonicalOutputRoot(scope.compendiumRoot) } : {}),
      ...(parent ? { audit: { parent } } : {}),
    };
    await writeJson(runPath(outputRoot), record);
    return { runId: record.runId, outputRoot, coordinatorGrant };
  }

  async canonicalRootForRun(outputRootInput: string): Promise<string> {
    const run = await readRun(canonicalOutputRoot(outputRootInput));
    return run.compendiumRoot ?? run.outputRoot;
  }

  async authorizeCoordinator(options: { outputRoot: string; runId: string; coordinatorGrant: string }): Promise<MemImportRunRecord> {
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    const run = await readRun(outputRoot);
    assertRunScope(run, outputRoot, options.runId);
    if (!tokenMatches(options.coordinatorGrant, run.coordinatorTokenHash)) throw new Error("Invalid coordinator grant");
    return run;
  }

  async authorizeCoordinatorMutation(options: { outputRoot: string; runId: string; coordinatorGrant: string }): Promise<MemImportRunRecord> {
    const run = await this.authorizeCoordinator(options);
    assertRunMutable(run);
    return run;
  }

  async markRunTerminal(run: MemImportRunRecord, status: MemImportTerminalStatus, reason?: string): Promise<MemImportRunRecord> {
    const current = await readRun(run.outputRoot);
    assertRunScope(current, run.outputRoot, run.runId);
    assertRunMutable(current);
    const terminal = { status, at: this.now().toISOString(), ...(reason ? { reason: reason.slice(0, 1000) } : {}) };
    const next = { ...current, terminal } satisfies MemImportRunRecord;
    await writeJson(runPath(run.outputRoot), next);
    return next;
  }

  async normalize(options: { outputRoot: string; runId: string; coordinatorGrant: string; input: string }): Promise<SourceManifest> {
    const run = await this.authorizeCoordinatorMutation(options);
    requireNonEmpty(options.input, "input");
    const manifest = await normalizeSources({ input: resolve(options.input), outputRoot: run.outputRoot });
    await writeJson(runPath(run.outputRoot), { ...run, normalizedAt: this.now().toISOString() } satisfies MemImportRunRecord);
    return manifest;
  }

  async inspectManifest(options: { outputRoot: string; runId: string; coordinatorGrant: string }): Promise<SourceManifest> {
    await this.authorizeCoordinator(options);
    return readManifest(canonicalOutputRoot(options.outputRoot));
  }

  async status(options: { outputRoot: string; runId: string; coordinatorGrant: string }): Promise<{ runId: string; normalized: boolean; unitCount: number; extractionStageCount: number }> {
    const run = await this.authorizeCoordinator(options);
    const normalized = Boolean(run.normalizedAt) && existsSync(`${run.outputRoot}/sources/manifest.json`);
    if (!normalized) return { runId: run.runId, normalized: false, unitCount: 0, extractionStageCount: 0 };
    const [manifest, extractionStages] = await Promise.all([readManifest(run.outputRoot), readExtractionStages(run.outputRoot)]);
    return { runId: run.runId, normalized: true, unitCount: manifest.units.length, extractionStageCount: extractionStages.length };
  }

  async inspectExtractionCandidates(options: {
    outputRoot: string;
    runId: string;
    coordinatorGrant: string;
    unitId: string;
    continuationCursor?: string;
    maxItems?: number;
  }): Promise<{
    unitId: string;
    packetHash: string;
    totalCandidates: number;
    candidates: Array<{ id: string; group: WorldImportGroup; title: string }>;
    truncated: boolean;
    continuationCursor?: string;
  }> {
    const run = await this.authorizeCoordinator(options);
    const manifest = await readManifest(run.outputRoot);
    if (!manifest.units.some((unit) => unit.unitId === options.unitId)) throw new Error(`Unknown normalized unit ${options.unitId}`);
    const path = extractionStagePath(run.outputRoot, options.unitId);
    if (!existsSync(path)) throw new Error(`Extraction packet ${options.unitId} does not exist`);
    const stage = JSON.parse(await readFile(path, "utf-8")) as StageEnvelope;
    if (!Array.isArray(stage.candidates)) throw new Error(`Extraction packet ${options.unitId} is invalid`);
    const packetHash = createHash("sha256").update(JSON.stringify(stage)).digest("hex");
    const maxItems = options.maxItems ?? 50;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    let offset = 0;
    if (options.continuationCursor) {
      const cursor = this.decodeExtractionPacketCursor(options.continuationCursor);
      if (cursor.unitId !== options.unitId || cursor.packetHash !== packetHash || cursor.candidateIdsHash !== "coordinator-inventory") throw new Error("Extraction candidate continuation cursor is stale or belongs to another packet");
      offset = cursor.offset;
    }
    if (offset > stage.candidates.length) throw new Error("Extraction candidate continuation cursor offset is invalid");
    const page = stage.candidates.slice(offset, offset + maxItems).map((candidate) => ({ id: candidate.id, group: candidate.group, title: candidate.title }));
    const next = offset + page.length;
    const truncated = next < stage.candidates.length;
    return {
      unitId: options.unitId,
      packetHash,
      totalCandidates: stage.candidates.length,
      candidates: page,
      truncated,
      ...(truncated ? { continuationCursor: this.encodeExtractionPacketCursor({ version: 1, kind: "extraction-packet", unitId: options.unitId, packetHash, candidateIdsHash: "coordinator-inventory", offset: next }) } : {}),
    };
  }

  async assignExtractor(options: {
    outputRoot: string;
    runId: string;
    coordinatorGrant: string;
    taskId: string;
    unitIds: string[];
    expiresAt?: string;
    /** Existing live task IDs this new task explicitly supersedes. */
    supersedesTaskIds?: string[];
    /** Prior task this fresh task retries after revocation/expiry. */
    retriesTaskId?: string;
    /** Credential-free, model-supplied identity and adapter/profile audit metadata. */
    audit?: MemImportAssignmentAudit;
  }): Promise<ExtractorAssignmentResult> {
    const run = await this.authorizeCoordinatorMutation(options);
    if (!run.normalizedAt || !existsSync(`${run.outputRoot}/sources/manifest.json`)) throw new Error("Normalize the run before issuing extractor assignments");
    assertTaskId(options.taskId);
    if (!Array.isArray(options.unitIds) || options.unitIds.length === 0) throw new Error("unitIds must be a non-empty array");
    const unitIds = [...new Set(options.unitIds)];
    if (unitIds.some((unitId) => typeof unitId !== "string" || !unitId.trim())) throw new Error("unitIds must contain non-empty strings");
    const supersedesTaskIds = [...new Set(options.supersedesTaskIds ?? [])];
    supersedesTaskIds.forEach(assertTaskId);
    if (options.retriesTaskId !== undefined) assertTaskId(options.retriesTaskId);
    if (options.retriesTaskId === options.taskId) throw new Error("retriesTaskId must name a prior task");
    const audit = sanitizeAudit(options.audit);
    const manifest = await readManifest(run.outputRoot);
    const known = new Set(manifest.units.map((unit) => unit.unitId));
    const unknown = unitIds.filter((unitId) => !known.has(unitId));
    if (unknown.length > 0) throw new Error(`Assignment includes unknown normalized unit(s): ${unknown.join(", ")}`);

    const issuedAt = this.now();
    const expiresAt = options.expiresAt ? asIsoDate(options.expiresAt, "expiresAt") : new Date(issuedAt.getTime() + 60 * 60 * 1000);
    if (expiresAt.getTime() <= issuedAt.getTime()) throw new Error("expiresAt must be in the future");
    const grant = newToken();
    const assignment: MemImportAssignmentRecord = {
      version: MEM_IMPORT_RUN_VERSION,
      kind: "mem-import-assignment",
      runId: run.runId,
      taskId: options.taskId,
      role: "extractor",
      outputRoot: run.outputRoot,
      allowedUnitIds: unitIds,
      capabilities: [...EXTRACTOR_CAPABILITIES],
      tokenHash: hashToken(grant),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lifecycleOutcome: "assigned",
      ...(supersedesTaskIds.length > 0 ? { supersedesTaskIds } : {}),
      ...(options.retriesTaskId ? { retriesTaskId: options.retriesTaskId } : {}),
      ...(audit ? { audit } : {}),
    };

    await withUnitLocks(run.outputRoot, unitIds, async () => {
      if (existsSync(assignmentPath(run.outputRoot, options.taskId))) throw new Error(`Assignment ${options.taskId} already exists; use a new taskId for a retry or superseding worker`);
      const existing = await readAssignments(run.outputRoot);
      if (options.retriesTaskId && !existing.some((item) => item.taskId === options.retriesTaskId && item.runId === run.runId)) {
        throw new Error(`retriesTaskId does not name an assignment in this run: ${options.retriesTaskId}`);
      }
      const liveOverlaps = existing.filter((item) => item.role === "extractor" && isLiveAssignment(item, issuedAt) && item.allowedUnitIds.some((unitId) => unitIds.includes(unitId)));
      const unapproved = liveOverlaps.filter((item) => !supersedesTaskIds.includes(item.taskId));
      if (unapproved.length > 0) throw new Error(`Unit(s) already have live extractor assignment(s): ${unapproved.map((item) => item.taskId).join(", ")}; revoke them or explicitly supersede them`);
      const unknownSupersession = supersedesTaskIds.filter((taskId) => !liveOverlaps.some((item) => item.taskId === taskId));
      if (unknownSupersession.length > 0) throw new Error(`supersedesTaskIds must name live overlapping assignment(s): ${unknownSupersession.join(", ")}`);
      const supersededAt = this.now().toISOString();
      await Promise.all(liveOverlaps.map((item) => writeJson(assignmentPath(run.outputRoot, item.taskId), {
        ...item,
        supersededAt,
        supersededByTaskId: assignment.taskId,
        lifecycleOutcome: "superseded",
      } satisfies MemImportAssignmentRecord)));
      await writeJson(assignmentPath(run.outputRoot, assignment.taskId), assignment);
    });

    return {
      runId: assignment.runId,
      taskId: assignment.taskId,
      outputRoot: assignment.outputRoot,
      grant,
      unitIds: assignment.allowedUnitIds,
      units: assignment.allowedUnitIds.map((unitId) => {
        const unit = manifest.units.find((entry) => entry.unitId === unitId)!;
        return {
          unitId: unit.unitId,
          sourceId: unit.sourceId,
          order: unit.order,
          ...(unit.title ? { title: unit.title } : {}),
          ...(unit.role ? { role: unit.role } : {}),
          blockCount: unit.blockCount,
        };
      }),
      expiresAt: assignment.expiresAt,
      capabilities: [...EXTRACTOR_CAPABILITIES],
      tools: [...MEM_IMPORT_ROLE_TOOLS.extractor],
    };
  }

  async assignWorker(options: {
    outputRoot: string;
    runId: string;
    coordinatorGrant: string;
    taskId: string;
    role: Exclude<AssignmentRole, "extractor">;
    expiresAt?: string;
    unitIds?: string[];
    candidateIds?: string[];
    proposalHashes?: string[];
    checkpointIds?: string[];
    actionIds?: string[];
    audit?: MemImportAssignmentAudit;
  }): Promise<WorkerAssignmentResult> {
    const run = await this.authorizeCoordinatorMutation(options);
    if (!run.normalizedAt || !existsSync(`${run.outputRoot}/sources/manifest.json`)) throw new Error("Normalize the run before issuing worker assignments");
    const manifest = await readManifest(run.outputRoot);
    assertTaskId(options.taskId);
    if (!["proposer", "reconciler", "merger", "reviewer", "repairer"].includes(options.role)) throw new Error("role must be proposer, reconciler, merger, reviewer, or repairer");
    if (existsSync(assignmentPath(run.outputRoot, options.taskId))) throw new Error(`Assignment ${options.taskId} already exists; use a fresh taskId`);
    const unitIds = [...new Set(options.unitIds ?? [])];
    let candidateIds = [...new Set(options.candidateIds ?? [])];
    const proposalHashes = [...new Set(options.proposalHashes ?? [])];
    const checkpointIds = [...new Set(options.checkpointIds ?? [])];
    const actionIds = [...new Set(options.actionIds ?? [])];
    if (unitIds.length > 100 || candidateIds.length > 100 || proposalHashes.length > 100) throw new Error("Worker assignment unit, candidate, and proposal scopes are limited to 100 items each");
    unitIds.forEach(assertTaskId);
    candidateIds.forEach((candidateId) => {
      requireNonEmpty(candidateId, "candidateId");
      if (candidateId.includes("\n") || candidateId.includes("\r")) throw new Error("candidateId must not contain line breaks");
    });
    proposalHashes.forEach((proposalHash) => {
      if (!/^[a-f0-9]{64}$/.test(proposalHash)) throw new Error("proposalHashes must contain SHA-256 hex hashes");
    });
    checkpointIds.forEach(assertTaskId);
    actionIds.forEach(assertTaskId);
    if (options.role === "proposer" && unitIds.length === 0) throw new Error("Proposer assignments require explicit unitIds");
    for (const unitId of unitIds) if (!manifest.units.some((unit) => unit.unitId === unitId)) throw new Error(`Worker assignment references missing normalized unit ${unitId}`);
    if (options.role === "proposer" && candidateIds.length) {
      const stages = new Map<string, StageEnvelope>();
      for (const unitId of unitIds) {
        const path = extractionStagePath(run.outputRoot, unitId);
        if (!existsSync(path)) throw new Error(`Proposer unit ${unitId} has no persisted extraction packet`);
        stages.set(unitId, JSON.parse(await readFile(path, "utf-8")) as StageEnvelope);
      }
      candidateIds = [...new Set(candidateIds.map((inputId) => {
        const separator = inputId.indexOf(":");
        if (separator > 0 && separator < inputId.length - 1) {
          const unitId = inputId.slice(0, separator);
          const candidateId = inputId.slice(separator + 1);
          if (!unitIds.includes(unitId)) throw new Error(`Proposer candidate ${inputId} names a unit outside this assignment`);
          if (!stages.get(unitId)?.candidates?.some((candidate) => candidate.id === candidateId)) throw new Error(`Proposer candidate ${inputId} does not exist`);
          return `${unitId}:${candidateId}`;
        }
        const matches = unitIds.filter((unitId) => stages.get(unitId)?.candidates?.some((candidate) => candidate.id === inputId));
        if (matches.length === 0) throw new Error(`Proposer candidate ${inputId} does not exist in the assigned units`);
        if (matches.length > 1) throw new Error(`Proposer candidate ${inputId} is ambiguous; use qualified unitId:candidateId`);
        return `${matches[0]}:${inputId}`;
      }))];
    }
    if (options.role !== "proposer" && (unitIds.length > 0 || candidateIds.length > 0)) throw new Error("Only proposer assignments may carry unit/candidate scope");
    if (options.role === "reconciler" && proposalHashes.length === 0) throw new Error("Reconciler assignments require explicit proposalHashes");
    if (!["reconciler", "merger"].includes(options.role) && proposalHashes.length > 0) throw new Error("Only reconciler or merger assignments may carry proposalHashes");
    if (options.role === "repairer" && (checkpointIds.length === 0 || actionIds.length === 0)) {
      throw new Error("Repairer assignments require explicit checkpointIds and actionIds");
    }
    if (options.role !== "repairer" && (checkpointIds.length > 0 || actionIds.length > 0)) {
      throw new Error("Only repairer assignments may carry checkpoint/action scope");
    }
    const issuedAt = this.now();
    const expiresAt = options.expiresAt ? asIsoDate(options.expiresAt, "expiresAt") : new Date(issuedAt.getTime() + 60 * 60 * 1000);
    if (expiresAt.getTime() <= issuedAt.getTime()) throw new Error("expiresAt must be in the future");
    const capabilities: Record<Exclude<AssignmentRole, "extractor">, MemImportCapability[]> = {
      proposer: ["source:read", "extraction:read", "proposal:submit"],
      reconciler: ["source:read", "extraction:read", "merge:read", "identity:read", "identity:submit"],
      merger: ["source:read", "extraction:read", "merge:read", "merge:lease", "merge:write", "check:read"],
      reviewer: ["source:read", "extraction:read", "merge:read", "review:read", "review:submit", "check:read"],
      repairer: ["source:read", "extraction:read", "merge:read", "merge:lease", "merge:write", "check:read"],
    };
    const grant = newToken();
    const assignment: MemImportAssignmentRecord = {
      version: MEM_IMPORT_RUN_VERSION,
      kind: "mem-import-assignment",
      runId: run.runId,
      taskId: options.taskId,
      role: options.role,
      outputRoot: run.outputRoot,
      allowedUnitIds: unitIds,
      ...(candidateIds.length ? { allowedCandidateIds: candidateIds } : {}),
      ...(proposalHashes.length ? { allowedProposalHashes: proposalHashes } : {}),
      ...(checkpointIds.length ? { allowedCheckpointIds: checkpointIds } : {}),
      ...(actionIds.length ? { allowedActionIds: actionIds } : {}),
      capabilities: capabilities[options.role],
      tokenHash: hashToken(grant),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lifecycleOutcome: "assigned",
      ...(sanitizeAudit(options.audit) ? { audit: sanitizeAudit(options.audit) } : {}),
    };
    await writeJson(assignmentPath(run.outputRoot, assignment.taskId), assignment);
    return {
      runId: assignment.runId,
      taskId: assignment.taskId,
      outputRoot: assignment.outputRoot,
      grant,
      role: assignment.role as Exclude<AssignmentRole, "extractor">,
      expiresAt: assignment.expiresAt,
      capabilities: assignment.capabilities,
      unitIds,
      units: unitIds.map((unitId) => {
        const unit = manifest.units.find((item) => item.unitId === unitId)!;
        return { unitId, sourceId: unit.sourceId };
      }),
      candidateIds,
      proposalHashes,
      checkpointIds,
      actionIds,
      tools: [...MEM_IMPORT_ROLE_TOOLS[assignment.role]],
    };
  }

  /**
   * Persist a host-issued dispatch receipt. It records observable correlation and
   * exact allowlists, but it deliberately does not claim to prove host isolation.
   */
  /**
   * Render the complete, non-persistent bootstrap a launcher must paste into a child task.
   * The grant is caller-supplied because durable state stores only its hash.
   */
  async assignmentBrief(options: {
    outputRoot: string;
    runId: string;
    coordinatorGrant: string;
    taskId: string;
    grant: string;
  }): Promise<{
    outputRoot: string;
    runId: string;
    taskId: string;
    grant: string;
    role: AssignmentRole;
    units: Array<{ unitId: string; sourceId: string }>;
    candidateIds: string[];
    proposalHashes: string[];
    checkpointIds: string[];
    actionIds: string[];
    tools: string[];
  }> {
    const run = await this.authorizeCoordinatorMutation(options);
    const assignment = await readAssignment(run.outputRoot, options.taskId);
    if (assignment.runId !== run.runId || assignment.outputRoot !== run.outputRoot) throw new Error("Assignment brief does not belong to this run");
    if (!tokenMatches(options.grant, assignment.tokenHash)) throw new Error("Invalid assignment grant");
    if (assignment.revokedAt) throw new Error(`Assignment ${assignment.taskId} was revoked at ${assignment.revokedAt}`);
    if (assignment.supersededAt) throw new Error(`Assignment ${assignment.taskId} was superseded at ${assignment.supersededAt}`);
    if (asIsoDate(assignment.expiresAt, "assignment.expiresAt").getTime() <= this.now().getTime()) throw new Error(`Assignment ${assignment.taskId} has expired`);
    const manifest = await readManifest(run.outputRoot);
    const units = assignment.allowedUnitIds.map((unitId) => {
      const unit = manifest.units.find((item) => item.unitId === unitId);
      if (!unit) throw new Error(`Assignment ${assignment.taskId} references missing normalized unit ${unitId}`);
      return { unitId, sourceId: unit.sourceId };
    });
    return {
      outputRoot: run.outputRoot,
      runId: run.runId,
      taskId: assignment.taskId,
      grant: options.grant,
      role: assignment.role,
      units,
      candidateIds: assignment.allowedCandidateIds ?? [],
      proposalHashes: assignment.allowedProposalHashes ?? [],
      checkpointIds: assignment.allowedCheckpointIds ?? [],
      actionIds: assignment.allowedActionIds ?? [],
      tools: [...MEM_IMPORT_ROLE_TOOLS[assignment.role]],
    };
  }

  async recordWorkerDispatch(options: {
    outputRoot: string;
    runId: string;
    coordinatorGrant: string;
    taskId: string;
    facility: DispatchFacility;
    hostTaskId: string;
    requestedTools: string[];
    observedTools: string[];
    outcome: DispatchOutcome;
    requestedModel?: string;
    observedModel?: string;
    requestedThinking?: string;
    observedThinking?: string;
  }): Promise<MemImportDispatchRecord> {
    const run = await this.authorizeCoordinatorMutation(options);
    const assignment = await readAssignment(run.outputRoot, options.taskId);
    if (assignment.runId !== run.runId) throw new Error("Dispatch assignment does not belong to this run");
    if (!["ordinary-subagent", "managed-agent", "inline", "unknown"].includes(options.facility)) throw new Error("Invalid dispatch facility");
    if (!["completed", "failed", "cancelled"].includes(options.outcome)) throw new Error("Invalid dispatch outcome");
    assertHostTaskId(options.hostTaskId);
    if (!Array.isArray(options.requestedTools) || !Array.isArray(options.observedTools) || options.requestedTools.some((tool) => typeof tool !== "string" || !tool.trim()) || options.observedTools.some((tool) => typeof tool !== "string" || !tool.trim())) throw new Error("Dispatch tool lists must contain non-empty names");
    const expectedTools = MEM_IMPORT_ROLE_TOOLS[assignment.role];
    if (!sameToolSet(options.requestedTools, expectedTools) || !sameToolSet(options.observedTools, expectedTools)) throw new Error(`Dispatch tool allowlist does not exactly match the ${assignment.role} role`);
    for (const [name, value] of Object.entries({ requestedModel: options.requestedModel, observedModel: options.observedModel, requestedThinking: options.requestedThinking, observedThinking: options.observedThinking })) {
      if (value !== undefined && (typeof value !== "string" || !value.trim())) throw new Error(`${name} must be a non-empty string when supplied`);
    }
    const record: MemImportDispatchRecord = {
      version: 1, kind: "mem-import-worker-dispatch", runId: run.runId, taskId: assignment.taskId, role: assignment.role,
      facility: options.facility, hostTaskId: options.hostTaskId, requestedTools: [...options.requestedTools].sort(), observedTools: [...options.observedTools].sort(), outcome: options.outcome,
      ...(options.requestedModel ? { requestedModel: options.requestedModel } : {}), ...(options.observedModel ? { observedModel: options.observedModel } : {}),
      ...(options.requestedThinking ? { requestedThinking: options.requestedThinking } : {}), ...(options.observedThinking ? { observedThinking: options.observedThinking } : {}),
      recordedAt: this.now().toISOString(),
    };
    await writeJson(dispatchPath(run.outputRoot, assignment.taskId), record);
    return record;
  }

  async recordWorkerEffect(assignment: MemImportAssignmentRecord, effect: { kind: string; path: string; contentHash: string }): Promise<void> {
    requireNonEmpty(effect.kind, "effect.kind");
    requireNonEmpty(effect.path, "effect.path");
    if (!/^[a-f0-9]{64}$/.test(effect.contentHash)) throw new Error("effect.contentHash must be a SHA-256 hex string");
    const nonce = randomBytes(6).toString("hex");
    await writeJson(`${orchestrationDir(assignment.outputRoot)}/effects/${assignment.taskId}/${new Date().toISOString().replace(/[:.]/g, "-")}-${nonce}.json`, {
      version: 1, kind: "mem-import-worker-effect", runId: assignment.runId, taskId: assignment.taskId,
      effect: effect.kind, path: effect.path, contentHash: effect.contentHash, recordedAt: this.now().toISOString(),
    });
  }

  async dispatchDiagnostics(outputRootInput: string): Promise<Array<{ taskId: string; message: string }>> {
    const outputRoot = canonicalOutputRoot(outputRootInput);
    const effectsRoot = `${orchestrationDir(outputRoot)}/effects`;
    if (!existsSync(effectsRoot)) return [];
    const diagnostics: Array<{ taskId: string; message: string }> = [];
    for (const entry of await readdir(effectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskId = entry.name;
      let assignment: MemImportAssignmentRecord;
      try { assignment = await readAssignment(outputRoot, taskId); }
      catch { diagnostics.push({ taskId, message: "Semantic effect has no valid assignment record." }); continue; }
      const dispatchFile = dispatchPath(outputRoot, taskId);
      if (!existsSync(dispatchFile)) { diagnostics.push({ taskId, message: "Semantic worker effect lacks a correlated dispatch receipt." }); continue; }
      let dispatch: MemImportDispatchRecord;
      try { dispatch = JSON.parse(await readFile(dispatchFile, "utf-8")) as MemImportDispatchRecord; }
      catch { diagnostics.push({ taskId, message: "Semantic worker dispatch receipt is unreadable." }); continue; }
      if (dispatch.version !== 1 || dispatch.kind !== "mem-import-worker-dispatch" || dispatch.runId !== assignment.runId || dispatch.taskId !== taskId || dispatch.role !== assignment.role) diagnostics.push({ taskId, message: "Semantic worker dispatch receipt does not correlate to its assignment." });
      else if (dispatch.facility !== "ordinary-subagent") diagnostics.push({ taskId, message: `Semantic worker used disallowed ${dispatch.facility} facility.` });
      else if (dispatch.outcome !== "completed") diagnostics.push({ taskId, message: `Semantic worker dispatch ended ${dispatch.outcome}.` });
      else if (!sameToolSet(dispatch.requestedTools, MEM_IMPORT_ROLE_TOOLS[assignment.role]) || !sameToolSet(dispatch.observedTools, MEM_IMPORT_ROLE_TOOLS[assignment.role])) diagnostics.push({ taskId, message: "Semantic worker dispatch allowlist does not match its role." });
    }
    return diagnostics;
  }

  async revokeAssignment(options: { outputRoot: string; runId: string; coordinatorGrant: string; taskId: string }): Promise<{ taskId: string; revokedAt: string }> {
    const run = await this.authorizeCoordinatorMutation(options);
    assertTaskId(options.taskId);
    const initial = await readAssignment(run.outputRoot, options.taskId);
    if (initial.runId !== run.runId) throw new Error("Assignment does not belong to this run");
    return withUnitLocks(run.outputRoot, initial.allowedUnitIds, async () => {
      const assignment = await readAssignment(run.outputRoot, options.taskId);
      const revokedAt = this.now().toISOString();
      await writeJson(assignmentPath(run.outputRoot, assignment.taskId), { ...assignment, revokedAt, lifecycleOutcome: "revoked" } satisfies MemImportAssignmentRecord);
      return { taskId: assignment.taskId, revokedAt };
    });
  }

  async authorizeWorker(options: {
    outputRoot: string;
    runId: string;
    taskId: string;
    grant: string;
    capability: MemImportCapability;
    role?: AssignmentRole;
    unitId?: string;
    checkpointId?: string;
    actionIds?: string[];
  }): Promise<MemImportAssignmentRecord> {
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    let runId: string | undefined;
    try {
      assertTaskId(options.taskId);
      const [run, assignment] = await Promise.all([readRun(outputRoot), readAssignment(outputRoot, options.taskId)]);
      runId = run.runId;
      assertRunScope(run, outputRoot, options.runId);
      if (assignment.version !== MEM_IMPORT_RUN_VERSION || assignment.kind !== "mem-import-assignment") throw new Error("Invalid mem-import assignment record");
      if (assignment.outputRoot !== outputRoot || assignment.runId !== run.runId) throw new Error("Assignment scope does not match the active run");
      if (MUTATING_WORKER_CAPABILITIES.has(options.capability)) assertRunMutable(run);
      if (options.role && assignment.role !== options.role) throw new Error(`Assignment role is not ${options.role}`);
      if (!tokenMatches(options.grant, assignment.tokenHash)) throw new Error("Invalid assignment grant");
      if (assignment.revokedAt) throw new Error(`Assignment ${assignment.taskId} was revoked at ${assignment.revokedAt}`);
      if (assignment.supersededAt) throw new Error(`Assignment ${assignment.taskId} was superseded at ${assignment.supersededAt}`);
      if (asIsoDate(assignment.expiresAt, "assignment.expiresAt").getTime() <= this.now().getTime()) throw new Error(`Assignment ${assignment.taskId} has expired`);
      if (!assignment.capabilities.includes(options.capability)) throw new Error(`Assignment does not allow capability ${options.capability}`);
      if (options.unitId && !assignment.allowedUnitIds.includes(options.unitId)) throw new Error(`Unit ${options.unitId} is outside this${assignment.role === "extractor" ? " extractor" : ""} assignment`);
      if (options.checkpointId && !assignment.allowedCheckpointIds?.includes(options.checkpointId)) throw new Error(`Checkpoint ${options.checkpointId} is outside this assignment`);
      if (options.actionIds?.some((actionId) => !assignment.allowedActionIds?.includes(actionId))) throw new Error("One or more repair actions are outside this assignment");
      await writeAuthorizationEvent(outputRoot, { runId, taskId: assignment.taskId, role: assignment.role, capability: options.capability, ...(options.unitId ? { unitId: options.unitId } : {}), ...(options.checkpointId ? { checkpointId: options.checkpointId } : {}), ...(options.actionIds?.length ? { actionIds: [...options.actionIds] } : {}), outcome: "allowed" });
      return assignment;
    } catch (error) {
      await writeAuthorizationEvent(outputRoot, { ...(runId ? { runId } : {}), taskId: options.taskId, capability: options.capability, outcome: "denied", reasonCode: "authorization-rejected" }).catch(() => undefined);
      throw error;
    }
  }

  async authorizeExtractor(options: {
    outputRoot: string;
    runId: string;
    taskId: string;
    grant: string;
    capability: ExtractorCapability;
    unitId?: string;
  }): Promise<MemImportAssignmentRecord> {
    return this.authorizeWorker({ ...options, role: "extractor" });
  }

  async readAssignedUnit(options: {
    outputRoot: string;
    runId: string;
    taskId: string;
    grant: string;
    unitId: string;
    startAnchor?: string;
    endAnchor?: string;
    continuationCursor?: string;
    maxChars?: number;
  }): Promise<SourceReadResult> {
    await this.authorizeExtractor({ ...options, capability: "source:read", unitId: options.unitId });
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    const [manifest, unit] = await Promise.all([readManifest(outputRoot), readNormalizedUnit(outputRoot, options.unitId)]);
    const entry = manifest.units.find((item) => item.unitId === options.unitId);
    if (!entry) throw new Error(`Unit ${options.unitId} is not present in the normalized manifest`);
    if (options.continuationCursor && (options.startAnchor || options.endAnchor)) throw new Error("continuationCursor cannot be combined with startAnchor or endAnchor");
    if ((options.startAnchor && !options.endAnchor) || (!options.startAnchor && options.endAnchor)) throw new Error("startAnchor and endAnchor must be provided together");
    const cursor = options.continuationCursor ? decodeCursor(options.continuationCursor) : undefined;
    if (cursor && (cursor.unitId !== options.unitId || cursor.contentHash !== unit.contentHash)) throw new Error("Stale source continuation cursor for this normalized unit");
    const requestedStart = cursor?.startAnchor ?? options.startAnchor;
    const requestedEnd = cursor?.endAnchor ?? options.endAnchor;
    const startIndex = requestedStart ? unit.blocks.findIndex((block) => block.anchor === requestedStart) : 0;
    const endIndex = requestedEnd ? unit.blocks.findIndex((block) => block.anchor === requestedEnd) : unit.blocks.length - 1;
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      readSlice(unit, requestedStart ?? unit.blocks[0]?.anchor ?? "", requestedEnd ?? unit.blocks.at(-1)?.anchor ?? "");
    }
    const selectedBlocks = unit.blocks.slice(startIndex, endIndex + 1);
    const fullContent = renderedSourceRange(selectedBlocks);
    const maxChars = options.maxChars ?? 12_000;
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 50_000) throw new Error("maxChars must be an integer between 1 and 50000");
    const offset = cursor?.offset ?? 0;
    if (offset >= fullContent.length) throw new Error("Stale source continuation cursor is already at the end of its source range");
    const content = fullContent.slice(offset, offset + maxChars);
    const nextOffset = offset + content.length;
    const truncated = nextOffset < fullContent.length;
    const nextAnchorIndex = selectedBlocks.findIndex((block) => renderedSourceRange(selectedBlocks.slice(0, selectedBlocks.indexOf(block))).length === nextOffset);
    const nextAnchor = nextAnchorIndex >= 0 ? selectedBlocks[nextAnchorIndex]?.anchor : undefined;
    const nextCursor: SourceCursor | undefined = truncated ? {
      version: 1,
      unitId: unit.unitId,
      contentHash: unit.contentHash,
      startAnchor: selectedBlocks[0]!.anchor,
      endAnchor: selectedBlocks.at(-1)!.anchor,
      offset: nextOffset,
    } : undefined;

    return {
      unit: {
        unitId: entry.unitId,
        sourceId: entry.sourceId,
        order: entry.order,
        ...(entry.title ? { title: entry.title } : {}),
        ...(entry.role ? { role: entry.role } : {}),
        anchors: entry.anchors,
        blockCount: entry.blockCount,
      },
      content,
      totalChars: fullContent.length,
      returnedChars: content.length,
      truncated,
      ...(nextCursor ? { continuationCursor: encodeCursor(nextCursor) } : {}),
      ...(nextAnchor ? { nextAnchor } : {}),
    };
  }

  /** Bounded source read for a merger/reviewer/repairer; their grants are run-wide rather than extractor unit-scoped. */
  async readWorkerUnit(options: {
    outputRoot: string;
    runId: string;
    taskId: string;
    grant: string;
    unitId: string;
    startAnchor?: string;
    endAnchor?: string;
    continuationCursor?: string;
    maxChars?: number;
  }): Promise<SourceReadResult> {
    // A requested unit is not an extractor assignment scope, so do not pass it
    // to authorizeWorker for run-wide merger/reviewer/repairer read grants.
    const { unitId: requestedUnitId, ...authority } = options;
    const assignment = await this.authorizeWorker({ ...authority, capability: "source:read" });
    if (assignment.role === "proposer" && !assignment.allowedUnitIds.includes(requestedUnitId)) throw new Error(`Unit ${requestedUnitId} is outside this assignment`);
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    const [manifest, unit] = await Promise.all([readManifest(outputRoot), readNormalizedUnit(outputRoot, requestedUnitId)]);
    const entry = manifest.units.find((item) => item.unitId === requestedUnitId);
    if (!entry) throw new Error(`Unit ${requestedUnitId} is not present in the normalized manifest`);
    if (options.continuationCursor && (options.startAnchor || options.endAnchor)) throw new Error("continuationCursor cannot be combined with startAnchor or endAnchor");
    if ((options.startAnchor && !options.endAnchor) || (!options.startAnchor && options.endAnchor)) throw new Error("startAnchor and endAnchor must be provided together");
    const cursor = options.continuationCursor ? decodeCursor(options.continuationCursor) : undefined;
    if (cursor && (cursor.unitId !== requestedUnitId || cursor.contentHash !== unit.contentHash)) throw new Error("Stale source continuation cursor for this normalized unit");
    const requestedStart = cursor?.startAnchor ?? options.startAnchor;
    const requestedEnd = cursor?.endAnchor ?? options.endAnchor;
    const startIndex = requestedStart ? unit.blocks.findIndex((block) => block.anchor === requestedStart) : 0;
    const endIndex = requestedEnd ? unit.blocks.findIndex((block) => block.anchor === requestedEnd) : unit.blocks.length - 1;
    if (startIndex < 0 || endIndex < startIndex) throw new Error("Invalid local source anchor range");
    const selectedBlocks = unit.blocks.slice(startIndex, endIndex + 1);
    const fullContent = renderedSourceRange(selectedBlocks);
    const maxChars = options.maxChars ?? 12_000;
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 50_000) throw new Error("maxChars must be an integer between 1 and 50000");
    const offset = cursor?.offset ?? 0;
    if (offset >= fullContent.length) throw new Error("Stale source continuation cursor is already at the end of its source range");
    const content = fullContent.slice(offset, offset + maxChars);
    const nextOffset = offset + content.length;
    const truncated = nextOffset < fullContent.length;
    const nextCursor = truncated ? encodeCursor({ version: 1, unitId: unit.unitId, contentHash: unit.contentHash, startAnchor: selectedBlocks[0]!.anchor, endAnchor: selectedBlocks.at(-1)!.anchor, offset: nextOffset }) : undefined;
    return {
      unit: { unitId: entry.unitId, sourceId: entry.sourceId, order: entry.order, ...(entry.title ? { title: entry.title } : {}), ...(entry.role ? { role: entry.role } : {}), anchors: entry.anchors, blockCount: entry.blockCount },
      content,
      totalChars: fullContent.length,
      returnedChars: content.length,
      truncated,
      ...(nextCursor ? { continuationCursor: nextCursor } : {}),
    };
  }

  async extractionStatus(options: { outputRoot: string; runId: string; taskId: string; grant: string }): Promise<ExtractionStatusResult> {
    const assignment = await this.authorizeExtractor({ ...options, capability: "extraction:read" });
    const stages = await readExtractionStages(canonicalOutputRoot(options.outputRoot));
    const submitted = new Set(stages.map((stage) => stage.unitId).filter((unitId): unitId is string => Boolean(unitId)));
    const submittedUnitIds = assignment.allowedUnitIds.filter((unitId) => submitted.has(unitId));
    return { assignedUnitIds: assignment.allowedUnitIds, submittedUnitIds, missingUnitIds: assignment.allowedUnitIds.filter((unitId) => !submitted.has(unitId)) };
  }

  /**
   * List compact extraction-packet summaries in deterministic source-unit order.
   * This deliberately never returns candidates or a whole corpus packet payload.
   */
  async readWorkerExtractionInventory(options: { outputRoot: string; runId: string; taskId: string; grant: string; group?: WorldImportGroup; continuationCursor?: string; maxItems?: number }): Promise<ExtractionInventoryResult> {
    const assignment = await this.authorizeWorker({ ...options, capability: "extraction:read" });
    if (options.group && !WORLD_IMPORT_GROUPS.includes(options.group)) throw new Error("group must be a known world-import group");
    const maxItems = options.maxItems ?? 25;
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("maxItems must be an integer between 1 and 100");
    const cursor = options.continuationCursor ? this.decodeExtractionInventoryCursor(options.continuationCursor) : undefined;
    if (cursor && cursor.group !== options.group) throw new Error("Extraction inventory cursor does not match the requested group filter");

    const manifest = await readManifest(assignment.outputRoot);
    const candidates = manifest.units
      .filter((unit) => assignment.role !== "proposer" || assignment.allowedUnitIds.includes(unit.unitId))
      .filter((unit) => !cursor || unit.order > cursor.afterOrder || (unit.order === cursor.afterOrder && unit.unitId > cursor.afterUnitId))
      .sort((left, right) => left.order - right.order || left.unitId.localeCompare(right.unitId));
    const entries: ExtractionInventoryEntry[] = [];
    let hasMore = false;
    for (const unit of candidates) {
      const entry = await this.readExtractionInventoryEntry(assignment.outputRoot, unit.unitId);
      if (!entry || (options.group && !entry.groupCounts[options.group])) continue;
      if (entries.length === maxItems) { hasMore = true; break; }
      entries.push(entry);
    }
    const last = entries.at(-1);
    const lastManifestEntry = last ? manifest.units.find((unit) => unit.unitId === last.unitId) : undefined;
    return {
      entries,
      returnedItems: entries.length,
      truncated: hasMore,
      ...(hasMore && last && lastManifestEntry ? { continuationCursor: this.encodeExtractionInventoryCursor({ version: 1, kind: "extraction-inventory", afterOrder: lastManifestEntry.order, afterUnitId: last.unitId, ...(options.group ? { group: options.group } : {}) }) } : {}),
    };
  }

  /**
   * Read candidates from exactly one packet in bounded pages. Callers must use
   * the inventory first instead of requesting every extraction packet at once.
   */
  async readWorkerExtractions(options: { outputRoot: string; runId: string; taskId: string; grant: string; unitId: string; candidateIds?: string[]; continuationCursor?: string; maxCandidates?: number }): Promise<ExtractionPacketResult | undefined> {
    const { unitId, candidateIds, continuationCursor, maxCandidates, ...authority } = options;
    const assignment = await this.authorizeWorker({ ...authority, capability: "extraction:read" });
    if (assignment.role === "proposer" && !assignment.allowedUnitIds.includes(unitId)) throw new Error(`Unit ${unitId} is outside this assignment`);
    assertTaskId(unitId);
    const path = extractionStagePath(assignment.outputRoot, unitId);
    if (!existsSync(path)) return undefined;
    const stage = JSON.parse(await readFile(path, "utf-8")) as StageEnvelope;
    if (stage.kind !== "extraction" || stage.unitId !== unitId || typeof stage.sourceId !== "string" || !Array.isArray(stage.candidates)) throw new Error(`Extraction packet ${unitId} is invalid`);
    const packetHash = createHash("sha256").update(JSON.stringify(stage)).digest("hex");
    const requestedIds = candidateIds?.length ? [...new Set(candidateIds)] : undefined;
    if (requestedIds?.some((id) => !id.trim())) throw new Error("candidateIds must contain non-empty IDs");
    if (requestedIds && requestedIds.length > 100) throw new Error("candidateIds may contain at most 100 IDs");
    const scopedIds = assignment.role === "proposer" && assignment.allowedCandidateIds?.length
      ? assignment.allowedCandidateIds.filter((id) => id.startsWith(`${unitId}:`)).map((id) => id.slice(unitId.length + 1))
      : undefined;
    if (assignment.role === "proposer" && requestedIds?.some((id) => scopedIds && !scopedIds.includes(id))) throw new Error("One or more candidate IDs are outside this proposal assignment");
    const effectiveIds = requestedIds ?? scopedIds;
    const candidateIdsHash = createHash("sha256").update(JSON.stringify(effectiveIds ?? [])).digest("hex");
    const cursor = continuationCursor ? this.decodeExtractionPacketCursor(continuationCursor) : undefined;
    if (cursor && (cursor.unitId !== unitId || cursor.packetHash !== packetHash || cursor.candidateIdsHash !== candidateIdsHash)) throw new Error("Stale extraction packet continuation cursor");
    const limit = maxCandidates ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("maxCandidates must be an integer between 1 and 100");
    const selected = effectiveIds ? stage.candidates.filter((candidate) => effectiveIds.includes(candidate.id)) : stage.candidates;
    const offset = cursor?.offset ?? 0;
    if (offset >= selected.length && (cursor || selected.length > 0)) throw new Error("Stale extraction packet continuation cursor is already at the end of its candidate range");
    const candidates = selected.slice(offset, offset + limit);
    const nextOffset = offset + candidates.length;
    const truncated = nextOffset < selected.length;
    return {
      unitId,
      sourceId: stage.sourceId,
      packetHash,
      totalCandidates: selected.length,
      candidates,
      truncated,
      ...(truncated ? { continuationCursor: this.encodeExtractionPacketCursor({ version: 1, kind: "extraction-packet", unitId, packetHash, candidateIdsHash, offset: nextOffset }) } : {}),
    };
  }

  async readExtraction(options: { outputRoot: string; runId: string; taskId: string; grant: string; unitId: string }): Promise<StageEnvelope | undefined> {
    await this.authorizeExtractor({ ...options, capability: "extraction:read", unitId: options.unitId });
    const path = extractionStagePath(canonicalOutputRoot(options.outputRoot), options.unitId);
    if (!existsSync(path)) return undefined;
    return JSON.parse(await readFile(path, "utf-8")) as StageEnvelope;
  }

  async validateExtraction(options: { outputRoot: string; runId: string; taskId: string; grant: string; unitId: string; stage: unknown }): Promise<void> {
    await this.authorizeExtractor({ ...options, capability: "extraction:validate", unitId: options.unitId });
    await this.assertExtractionStage(canonicalOutputRoot(options.outputRoot), options.unitId, options.stage);
  }

  async submitExtraction(options: { outputRoot: string; runId: string; taskId: string; grant: string; unitId: string; stage: unknown }): Promise<{ unitId: string; candidateCount: number; packetHash: string }> {
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    return withUnitLocks(outputRoot, [options.unitId], async () => {
      const assignment = await this.authorizeExtractor({ ...options, outputRoot, capability: "extraction:submit", unitId: options.unitId });
      const stage = await this.assertExtractionStage(outputRoot, options.unitId, options.stage);
      const packetHash = createHash("sha256").update(JSON.stringify(stage)).digest("hex");
      const submittedAt = this.now().toISOString();
      await writeExtractionStage(outputRoot, stage);
      await writeJson(extractionInventoryPath(outputRoot, options.unitId), this.extractionInventoryEntry(stage, packetHash));
      await writeJson(assignmentEffectPath(outputRoot, assignment.taskId, options.unitId), {
        version: 1,
        kind: "mem-import-packet-effect",
        runId: assignment.runId,
        taskId: assignment.taskId,
        unitId: options.unitId,
        stagePath: `stages/extraction/${options.unitId}.json`,
        packetHash,
        candidateCount: stage.candidates?.length ?? 0,
        submittedAt,
      });
      await writeJson(assignmentPath(outputRoot, assignment.taskId), { ...assignment, lifecycleOutcome: "submitted" } satisfies MemImportAssignmentRecord);
      return { unitId: options.unitId, candidateCount: stage.candidates?.length ?? 0, packetHash };
    });
  }

  private extractionInventoryEntry(stage: StageEnvelope, packetHash: string): ExtractionInventoryEntry {
    if (!stage.unitId || !stage.sourceId || !Array.isArray(stage.candidates)) throw new Error("Cannot inventory an invalid extraction stage");
    const groupCounts: Partial<Record<WorldImportGroup, number>> = {};
    for (const candidate of stage.candidates) {
      groupCounts[candidate.group] = (groupCounts[candidate.group] ?? 0) + 1;
    }
    return { unitId: stage.unitId, sourceId: stage.sourceId, packetHash, candidateCount: stage.candidates.length, groupCounts };
  }

  private async readExtractionInventoryEntry(outputRoot: string, unitId: string): Promise<ExtractionInventoryEntry | undefined> {
    const inventoryPath = extractionInventoryPath(outputRoot, unitId);
    if (existsSync(inventoryPath)) {
      const inventory = JSON.parse(await readFile(inventoryPath, "utf-8")) as ExtractionInventoryEntry;
      if (inventory.unitId === unitId && typeof inventory.sourceId === "string" && typeof inventory.packetHash === "string" && Number.isInteger(inventory.candidateCount) && inventory.candidateCount >= 0 && inventory.groupCounts && typeof inventory.groupCounts === "object") return inventory;
      throw new Error(`Extraction inventory record ${unitId} is invalid`);
    }
    const path = extractionStagePath(outputRoot, unitId);
    if (!existsSync(path)) return undefined;
    const stage = JSON.parse(await readFile(path, "utf-8")) as StageEnvelope;
    return this.extractionInventoryEntry(stage, createHash("sha256").update(JSON.stringify(stage)).digest("hex"));
  }

  private encodeExtractionInventoryCursor(cursor: ExtractionInventoryCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
  }

  private decodeExtractionInventoryCursor(value: string): ExtractionInventoryCursor {
    let cursor: Partial<ExtractionInventoryCursor>;
    try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<ExtractionInventoryCursor>; }
    catch { throw new Error("Invalid extraction inventory continuation cursor"); }
    if (cursor.version !== 1 || cursor.kind !== "extraction-inventory" || typeof cursor.afterOrder !== "number" || !Number.isInteger(cursor.afterOrder) || cursor.afterOrder < 0 || typeof cursor.afterUnitId !== "string" || (cursor.group !== undefined && !WORLD_IMPORT_GROUPS.includes(cursor.group))) throw new Error("Invalid extraction inventory continuation cursor");
    return cursor as ExtractionInventoryCursor;
  }

  private encodeExtractionPacketCursor(cursor: ExtractionPacketCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
  }

  private decodeExtractionPacketCursor(value: string): ExtractionPacketCursor {
    let cursor: Partial<ExtractionPacketCursor>;
    try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<ExtractionPacketCursor>; }
    catch { throw new Error("Invalid extraction packet continuation cursor"); }
    if (cursor.version !== 1 || cursor.kind !== "extraction-packet" || typeof cursor.unitId !== "string" || typeof cursor.packetHash !== "string" || typeof cursor.candidateIdsHash !== "string" || typeof cursor.offset !== "number" || !Number.isInteger(cursor.offset) || cursor.offset < 0) throw new Error("Invalid extraction packet continuation cursor");
    return cursor as ExtractionPacketCursor;
  }

  private async assertExtractionStage(outputRoot: string, unitId: string, value: unknown): Promise<StageEnvelope> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extraction stage must be an object");
    // The submitted object may omit a provenance quote. Copy it before deriving
    // durable quote text so callers never observe a mutation of their input packet.
    const stage = structuredClone(value) as StageEnvelope;
    if (stage.kind !== "extraction") throw new Error("Extraction stage kind must be extraction");
    if (stage.unitId !== unitId) throw new Error(`Extraction stage unitId must match assigned unit ${unitId}`);
    const manifest = await readManifest(outputRoot);
    const entry = manifest.units.find((item) => item.unitId === unitId);
    if (!entry) throw new Error(`Assigned unit ${unitId} is absent from the normalized manifest`);
    if (stage.sourceId !== entry.sourceId) throw new Error(`Extraction stage sourceId must match assigned unit sourceId ${entry.sourceId}`);
    const unit = await readNormalizedUnit(outputRoot, unitId);
    // Anchor selection is model-owned; durable quote transcription is not. Always
    // replace any caller-supplied quote with the exact canonical block range.
    for (const candidate of Array.isArray(stage.candidates) ? stage.candidates : []) {
      if (!isRecord(candidate) || !Array.isArray(candidate.provenance)) continue;
      for (const ref of candidate.provenance) {
        if (!isRecord(ref)
          || typeof ref.sourceId !== "string"
          || typeof ref.unitId !== "string"
          || typeof ref.startAnchor !== "string"
          || typeof ref.endAnchor !== "string") continue;
        if (ref.unitId !== unitId || ref.sourceId !== entry.sourceId) continue;
        const startIndex = unit.blocks.findIndex((block) => block.anchor === ref.startAnchor);
        const endIndex = unit.blocks.findIndex((block) => block.anchor === ref.endAnchor);
        if (startIndex < 0 || endIndex < startIndex) continue;
        ref.quote = canonicalQuoteRange(unit.blocks.slice(startIndex, endIndex + 1));
      }
    }
    validateStageEnvelope(stage, { requireCandidates: true });
    for (const [candidateIndex, candidate] of (stage.candidates ?? []).entries()) {
      for (const [refIndex, ref] of candidate.provenance.entries()) {
        const path = `stage.candidates[${candidateIndex}].provenance[${refIndex}]`;
        if (ref.unitId !== unitId || ref.sourceId !== entry.sourceId) throw new Error(`${path} must cite only assigned unit ${unitId}`);
        const startIndex = unit.blocks.findIndex((block) => block.anchor === ref.startAnchor);
        const endIndex = unit.blocks.findIndex((block) => block.anchor === ref.endAnchor);
        try {
          readSlice(unit, ref.startAnchor, ref.endAnchor);
        } catch (error) {
          throw new Error(`${path} has invalid local anchors: ${error instanceof Error ? error.message : String(error)}`);
        }
        const sourceRange = canonicalQuoteRange(unit.blocks.slice(startIndex, endIndex + 1));
        if (!ref.quote || !sourceRange.includes(ref.quote)) {
          throw new Error(`${path}.quote must be a literal contiguous excerpt of normalized source text in the cited anchor range`);
        }
      }
    }
    return stage;
  }
}
