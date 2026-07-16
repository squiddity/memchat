import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

export type MemImportRunRecord = {
  version: 1;
  kind: "mem-import-run";
  runId: string;
  outputRoot: string;
  coordinatorTokenHash: string;
  createdAt: string;
  normalizedAt?: string;
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
  /** Characters emitted in content, including a truncation ellipsis when present. */
  returnedChars: number;
  truncated: boolean;
  /** First unread anchor; repeats the first requested anchor if no complete block fit. */
  nextAnchor?: string;
};

export type ExtractionStatusResult = {
  assignedUnitIds: string[];
  submittedUnitIds: string[];
  missingUnitIds: string[];
};

type Clock = () => Date;

function orchestrationDir(outputRoot: string): string {
  return `${outputRoot}/stages/orchestration`;
}

function runPath(outputRoot: string): string {
  return `${orchestrationDir(outputRoot)}/run.json`;
}

function assignmentPath(outputRoot: string, taskId: string): string {
  return `${orchestrationDir(outputRoot)}/assignments/${taskId}.json`;
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
  return value as MemImportRunRecord;
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
    || (value.revokedAt !== undefined && typeof value.revokedAt !== "string")) {
    throw new Error("Invalid mem-import assignment record");
  }
  return value as MemImportAssignmentRecord;
}

async function readRun(outputRoot: string): Promise<MemImportRunRecord> {
  const path = runPath(outputRoot);
  if (!existsSync(path)) throw new Error("No active mem-import run exists for outputRoot; call world_import_begin first");
  return parseRunRecord(JSON.parse(await readFile(path, "utf-8")));
}

async function readAssignment(outputRoot: string, taskId: string): Promise<MemImportAssignmentRecord> {
  const path = assignmentPath(outputRoot, taskId);
  if (!existsSync(path)) throw new Error(`No assignment exists for taskId ${taskId}`);
  return parseAssignmentRecord(JSON.parse(await readFile(path, "utf-8")));
}

function assertRunScope(run: MemImportRunRecord, outputRoot: string, runId: string): void {
  if (run.version !== MEM_IMPORT_RUN_VERSION || run.kind !== "mem-import-run") throw new Error("Invalid mem-import run record");
  if (run.outputRoot !== outputRoot) throw new Error("Run outputRoot does not match requested outputRoot");
  if (run.runId !== runId) throw new Error("runId does not match the active output-root run");
}

export class MemImportService {
  constructor(private readonly now: Clock = () => new Date()) {}

  async begin(outputRootInput: string): Promise<BeginRunResult> {
    const outputRoot = canonicalOutputRoot(outputRootInput);
    const existing = existsSync(runPath(outputRoot)) ? await readRun(outputRoot) : undefined;
    if (existing) throw new Error(`A mem-import run already exists for outputRoot (${existing.runId}); use its coordinator grant or choose a fresh outputRoot`);
    const coordinatorGrant = newToken();
    const record: MemImportRunRecord = {
      version: MEM_IMPORT_RUN_VERSION,
      kind: "mem-import-run",
      runId: newRunId(),
      outputRoot,
      coordinatorTokenHash: hashToken(coordinatorGrant),
      createdAt: this.now().toISOString(),
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
  }): Promise<ExtractorAssignmentResult> {
    const run = await this.authorizeCoordinator(options);
    if (!run.normalizedAt || !existsSync(`${run.outputRoot}/sources/manifest.json`)) {
      throw new Error("Normalize the run before issuing extractor assignments");
    }
    assertTaskId(options.taskId);
    if (!Array.isArray(options.unitIds) || options.unitIds.length === 0) throw new Error("unitIds must be a non-empty array");
    const unitIds = [...new Set(options.unitIds)];
    if (unitIds.some((unitId) => typeof unitId !== "string" || !unitId.trim())) throw new Error("unitIds must contain non-empty strings");
    const manifest = await readManifest(run.outputRoot);
    const known = new Set(manifest.units.map((unit) => unit.unitId));
    const unknown = unitIds.filter((unitId) => !known.has(unitId));
    if (unknown.length > 0) throw new Error(`Assignment includes unknown normalized unit(s): ${unknown.join(", ")}`);
    if (existsSync(assignmentPath(run.outputRoot, options.taskId))) throw new Error(`Assignment ${options.taskId} already exists; use a new taskId for a retry or superseding worker`);

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
    };
    await writeJson(assignmentPath(run.outputRoot, assignment.taskId), assignment);
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
    const assignment = await readAssignment(run.outputRoot, options.taskId);
    if (assignment.runId !== run.runId) throw new Error("Assignment does not belong to this run");
    const revokedAt = this.now().toISOString();
    await writeJson(assignmentPath(run.outputRoot, assignment.taskId), { ...assignment, revokedAt } satisfies MemImportAssignmentRecord);
    return { taskId: assignment.taskId, revokedAt };
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
    maxChars?: number;
  }): Promise<SourceReadResult> {
    await this.authorizeExtractor({ ...options, capability: "source:read", unitId: options.unitId });
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    const [manifest, unit] = await Promise.all([readManifest(outputRoot), readNormalizedUnit(outputRoot, options.unitId)]);
    const entry = manifest.units.find((item) => item.unitId === options.unitId);
    if (!entry) throw new Error(`Unit ${options.unitId} is not present in the normalized manifest`);
    if ((options.startAnchor && !options.endAnchor) || (!options.startAnchor && options.endAnchor)) throw new Error("startAnchor and endAnchor must be provided together");
    const startIndex = options.startAnchor ? unit.blocks.findIndex((block) => block.anchor === options.startAnchor) : 0;
    const endIndex = options.endAnchor ? unit.blocks.findIndex((block) => block.anchor === options.endAnchor) : unit.blocks.length - 1;
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      // Preserve the legacy deterministic diagnostic wording for invalid ranges.
      readSlice(unit, options.startAnchor ?? unit.blocks[0]?.anchor ?? "", options.endAnchor ?? unit.blocks.at(-1)?.anchor ?? "");
    }
    const selectedBlocks = unit.blocks.slice(startIndex, endIndex + 1);
    const renderedBlocks = selectedBlocks.map((block) => `[${block.anchor}] ${block.text}`);
    const fullContent = renderedBlocks.join("\n\n");
    const maxChars = options.maxChars ?? 12_000;
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 50_000) throw new Error("maxChars must be an integer between 1 and 50000");

    let content = fullContent;
    let nextAnchor: string | undefined;
    if (fullContent.length > maxChars) {
      const completeBlocks: string[] = [];
      for (const renderedBlock of renderedBlocks) {
        const separator = completeBlocks.length === 0 ? "" : "\n\n";
        if ((completeBlocks.join("\n\n").length + separator.length + renderedBlock.length) > maxChars) break;
        completeBlocks.push(renderedBlock);
      }
      if (completeBlocks.length > 0) {
        content = completeBlocks.join("\n\n");
        nextAnchor = selectedBlocks[completeBlocks.length]?.anchor;
      } else {
        content = `${fullContent.slice(0, Math.max(0, maxChars - 1))}…`;
        nextAnchor = selectedBlocks[0]?.anchor;
      }
    }

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
      truncated: Boolean(nextAnchor),
      ...(nextAnchor ? { nextAnchor } : {}),
    };
  }

  async extractionStatus(options: { outputRoot: string; runId: string; taskId: string; grant: string }): Promise<ExtractionStatusResult> {
    const assignment = await this.authorizeExtractor({ ...options, capability: "extraction:read" });
    const stages = await readExtractionStages(canonicalOutputRoot(options.outputRoot));
    const submitted = new Set(stages.map((stage) => stage.unitId).filter((unitId): unitId is string => Boolean(unitId)));
    const submittedUnitIds = assignment.allowedUnitIds.filter((unitId) => submitted.has(unitId));
    return {
      assignedUnitIds: assignment.allowedUnitIds,
      submittedUnitIds,
      missingUnitIds: assignment.allowedUnitIds.filter((unitId) => !submitted.has(unitId)),
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

  async submitExtraction(options: { outputRoot: string; runId: string; taskId: string; grant: string; unitId: string; stage: unknown }): Promise<{ unitId: string; candidateCount: number }> {
    await this.authorizeExtractor({ ...options, capability: "extraction:submit", unitId: options.unitId });
    const outputRoot = canonicalOutputRoot(options.outputRoot);
    const stage = await this.assertExtractionStage(outputRoot, options.unitId, options.stage);
    await writeExtractionStage(outputRoot, stage);
    return { unitId: options.unitId, candidateCount: stage.candidates?.length ?? 0 };
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
        if (ref.unitId !== unitId || ref.sourceId !== entry.sourceId) {
          throw new Error(`stage.candidates[${candidateIndex}].provenance[${refIndex}] must cite only assigned unit ${unitId}`);
        }
        try {
          readSlice(unit, ref.startAnchor, ref.endAnchor);
        } catch (error) {
          throw new Error(`stage.candidates[${candidateIndex}].provenance[${refIndex}] has invalid local anchors: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return stage;
  }
}
