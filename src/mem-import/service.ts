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
import type { SourceManifest, SourceManifestEntry, StageEnvelope } from "../world-import/types.js";

export const MEM_IMPORT_RUN_VERSION = 1;
export const EXTRACTOR_CAPABILITIES = ["source:read", "extraction:read", "extraction:validate", "extraction:submit"] as const;

export type ExtractorCapability = (typeof EXTRACTOR_CAPABILITIES)[number];
export type AssignmentRole = "extractor" | "reviewer";
export type LifecycleOutcome = "assigned" | "submitted" | "revoked" | "superseded";

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
  capabilities: ExtractorCapability[];
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

type Clock = () => Date;
type SourceCursor = {
  version: 1;
  unitId: string;
  contentHash: string;
  startAnchor: string;
  endAnchor: string;
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
    || (value.normalizedAt !== undefined && typeof value.normalizedAt !== "string")) {
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
    || (value.role !== "extractor" && value.role !== "reviewer")
    || typeof value.outputRoot !== "string"
    || !Array.isArray(value.allowedUnitIds) || !value.allowedUnitIds.every((item) => typeof item === "string")
    || !Array.isArray(value.capabilities) || !value.capabilities.every((item) => EXTRACTOR_CAPABILITIES.includes(item as ExtractorCapability))
    || typeof value.tokenHash !== "string"
    || typeof value.issuedAt !== "string"
    || typeof value.expiresAt !== "string"
    || (value.revokedAt !== undefined && typeof value.revokedAt !== "string")
    || (value.supersededAt !== undefined && typeof value.supersededAt !== "string")
    || (value.supersededByTaskId !== undefined && typeof value.supersededByTaskId !== "string")
    || (value.supersedesTaskIds !== undefined && (!Array.isArray(value.supersedesTaskIds) || !value.supersedesTaskIds.every((item) => typeof item === "string")))
    || (value.retriesTaskId !== undefined && typeof value.retriesTaskId !== "string")
    || (value.lifecycleOutcome !== undefined && !["assigned", "submitted", "revoked", "superseded"].includes(String(value.lifecycleOutcome)))) {
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

  async begin(outputRootInput: string, audit?: { parent?: MemImportActorAudit }): Promise<BeginRunResult> {
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
      ...(parent ? { audit: { parent } } : {}),
    };
    await writeJson(runPath(outputRoot), record);
    return { runId: record.runId, outputRoot, coordinatorGrant };
  }

  async authorizeCoordinator(options: { outputRoot: string; runId: string; coordinatorGrant: string }): Promise<MemImportRunRecord> {
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    const run = await readRun(outputRoot);
    assertRunScope(run, outputRoot, options.runId);
    if (!tokenMatches(options.coordinatorGrant, run.coordinatorTokenHash)) throw new Error("Invalid coordinator grant");
    return run;
  }

  async normalize(options: { outputRoot: string; runId: string; coordinatorGrant: string; input: string }): Promise<SourceManifest> {
    const run = await this.authorizeCoordinator(options);
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
    const run = await this.authorizeCoordinator(options);
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
      capabilities: assignment.capabilities,
    };
  }

  async revokeAssignment(options: { outputRoot: string; runId: string; coordinatorGrant: string; taskId: string }): Promise<{ taskId: string; revokedAt: string }> {
    const run = await this.authorizeCoordinator(options);
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

  async authorizeExtractor(options: {
    outputRoot: string;
    runId: string;
    taskId: string;
    grant: string;
    capability: ExtractorCapability;
    unitId?: string;
  }): Promise<MemImportAssignmentRecord> {
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    assertTaskId(options.taskId);
    const [run, assignment] = await Promise.all([readRun(outputRoot), readAssignment(outputRoot, options.taskId)]);
    assertRunScope(run, outputRoot, options.runId);
    if (assignment.version !== MEM_IMPORT_RUN_VERSION || assignment.kind !== "mem-import-assignment") throw new Error("Invalid mem-import assignment record");
    if (assignment.outputRoot !== outputRoot || assignment.runId !== run.runId) throw new Error("Assignment scope does not match the active run");
    if (assignment.role !== "extractor") throw new Error("Assignment role is not extractor");
    if (!tokenMatches(options.grant, assignment.tokenHash)) throw new Error("Invalid assignment grant");
    if (assignment.revokedAt) throw new Error(`Assignment ${assignment.taskId} was revoked at ${assignment.revokedAt}`);
    if (assignment.supersededAt) throw new Error(`Assignment ${assignment.taskId} was superseded at ${assignment.supersededAt}`);
    if (asIsoDate(assignment.expiresAt, "assignment.expiresAt").getTime() <= this.now().getTime()) throw new Error(`Assignment ${assignment.taskId} has expired`);
    if (!assignment.capabilities.includes(options.capability)) throw new Error(`Assignment does not allow capability ${options.capability}`);
    if (options.unitId && !assignment.allowedUnitIds.includes(options.unitId)) throw new Error(`Unit ${options.unitId} is outside this extractor assignment`);
    return assignment;
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

  async extractionStatus(options: { outputRoot: string; runId: string; taskId: string; grant: string }): Promise<ExtractionStatusResult> {
    const assignment = await this.authorizeExtractor({ ...options, capability: "extraction:read" });
    const stages = await readExtractionStages(canonicalOutputRoot(options.outputRoot));
    const submitted = new Set(stages.map((stage) => stage.unitId).filter((unitId): unitId is string => Boolean(unitId)));
    const submittedUnitIds = assignment.allowedUnitIds.filter((unitId) => submitted.has(unitId));
    return { assignedUnitIds: assignment.allowedUnitIds, submittedUnitIds, missingUnitIds: assignment.allowedUnitIds.filter((unitId) => !submitted.has(unitId)) };
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

  private async assertExtractionStage(outputRoot: string, unitId: string, value: unknown): Promise<StageEnvelope> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extraction stage must be an object");
    const stage = value as StageEnvelope;
    if (stage.kind !== "extraction") throw new Error("Extraction stage kind must be extraction");
    if (stage.unitId !== unitId) throw new Error(`Extraction stage unitId must match assigned unit ${unitId}`);
    const manifest = await readManifest(outputRoot);
    const entry = manifest.units.find((item) => item.unitId === unitId);
    if (!entry) throw new Error(`Assigned unit ${unitId} is absent from the normalized manifest`);
    if (stage.sourceId !== entry.sourceId) throw new Error(`Extraction stage sourceId must match assigned unit sourceId ${entry.sourceId}`);
    validateStageEnvelope(stage, { requireCandidates: true });
    const unit = await readNormalizedUnit(outputRoot, unitId);
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
