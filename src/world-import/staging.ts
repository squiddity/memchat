import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { WORLD_IMPORT_GROUPS, type ArtifactPacket, type CandidateDisposition, type ManifestDiagnostic, type NormalizedSourceUnit, type SourceManifest, type SourceSpanRef, type StageEnvelope, type StagedRepairSummary, type StagedRepairVerification, type StagedReviewCheckpoint, type WorldImportGroup } from "./types.js";

const validGroups = [...WORLD_IMPORT_GROUPS];

export function sourcesDir(outputRoot: string): string {
  return join(outputRoot, "sources");
}

export function normalizedDir(outputRoot: string): string {
  return join(sourcesDir(outputRoot), "normalized");
}

export function extractionDir(outputRoot: string): string {
  return join(outputRoot, "stages", "extraction");
}

export function mergeDir(outputRoot: string): string {
  return join(outputRoot, "stages", "merge");
}

export function checkpointsDir(outputRoot: string): string {
  return join(outputRoot, "stages", "checkpoints");
}

export function checkpointReviewPath(outputRoot: string, checkpointId: string, iteration: number): string {
  return join(checkpointsDir(outputRoot), `${checkpointId}-${String(iteration).padStart(2, "0")}.review.json`);
}

export function checkpointRepairPath(outputRoot: string, checkpointId: string, iteration: number): string {
  return join(checkpointsDir(outputRoot), `${checkpointId}-${String(iteration).padStart(2, "0")}.repair.json`);
}

export function checkpointVerifyPath(outputRoot: string, checkpointId: string, iteration: number): string {
  return join(checkpointsDir(outputRoot), `${checkpointId}-${String(iteration).padStart(2, "0")}.verify.json`);
}

export function manifestPath(outputRoot: string): string {
  return join(sourcesDir(outputRoot), "manifest.json");
}

export function normalizedUnitPath(outputRoot: string, unitId: string): string {
  return join(normalizedDir(outputRoot), `${unitId}.json`);
}

export function extractionStagePath(outputRoot: string, unitId: string): string {
  return join(extractionDir(outputRoot), `${unitId}.json`);
}

export function mergedCandidatesPath(outputRoot: string): string {
  return join(mergeDir(outputRoot), "merged-candidates.json");
}

export async function ensureWorldImportDirs(outputRoot: string): Promise<void> {
  await mkdir(normalizedDir(outputRoot), { recursive: true });
  await mkdir(extractionDir(outputRoot), { recursive: true });
  await mkdir(mergeDir(outputRoot), { recursive: true });
  await mkdir(checkpointsDir(outputRoot), { recursive: true });
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeManifest(manifest: SourceManifest): Promise<void> {
  await mkdir(sourcesDir(manifest.outputRoot), { recursive: true });
  await writeJson(manifestPath(manifest.outputRoot), manifest);
}

export async function readManifest(outputRoot: string): Promise<SourceManifest> {
  return JSON.parse(await readFile(manifestPath(outputRoot), "utf-8")) as SourceManifest;
}

export async function writeNormalizedUnit(outputRoot: string, unit: NormalizedSourceUnit): Promise<void> {
  await writeJson(normalizedUnitPath(outputRoot, unit.unitId), unit);
}

export async function readNormalizedUnit(outputRoot: string, unitId: string): Promise<NormalizedSourceUnit> {
  return JSON.parse(await readFile(normalizedUnitPath(outputRoot, unitId), "utf-8")) as NormalizedSourceUnit;
}

export async function writeExtractionStage(outputRoot: string, stage: StageEnvelope): Promise<void> {
  if (!stage.unitId) throw new Error("extraction stage requires unitId");
  validateStageEnvelope(stage, { requireCandidates: true });
  await writeJson(extractionStagePath(outputRoot, stage.unitId), stage);
}

export async function readExtractionStages(outputRoot: string): Promise<StageEnvelope[]> {
  const dir = extractionDir(outputRoot);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf-8")) as StageEnvelope));
}

export async function writeMergeStage(outputRoot: string, stage: StageEnvelope): Promise<void> {
  validateStageEnvelope(stage, { requireArtifacts: true });
  await writeJson(mergedCandidatesPath(outputRoot), stage);
}

export async function readMergeStage(outputRoot: string): Promise<StageEnvelope> {
  return JSON.parse(await readFile(mergedCandidatesPath(outputRoot), "utf-8")) as StageEnvelope;
}

export async function writeStagedReviewCheckpoint(outputRoot: string, checkpoint: StagedReviewCheckpoint): Promise<string> {
  const path = checkpointReviewPath(outputRoot, checkpoint.checkpointId, checkpoint.iteration);
  await writeJson(path, checkpoint);
  return path;
}

export async function writeStagedRepairSummary(outputRoot: string, summary: StagedRepairSummary): Promise<string> {
  const path = checkpointRepairPath(outputRoot, summary.checkpointId, summary.iteration);
  await writeJson(path, summary);
  return path;
}

export async function writeStagedRepairVerification(outputRoot: string, verification: StagedRepairVerification): Promise<string> {
  const path = checkpointVerifyPath(outputRoot, verification.checkpointId, verification.iteration);
  await writeJson(path, verification);
  return path;
}

export function diagnostic(level: ManifestDiagnostic["level"], message: string, path?: string): ManifestDiagnostic {
  return { level, message, ...(path ? { path } : {}) };
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined) assertString(value, label);
}

function assertOptionalStringArray(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach((item, index) => assertString(item, `${label}[${index}]`));
}

function validateProvenance(value: unknown, label: string): asserts value is SourceSpanRef[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}.provenance must be a non-empty array`);
  for (const [index, ref] of value.entries()) {
    assertRecord(ref, `${label}.provenance[${index}]`);
    for (const key of ["sourceId", "unitId", "startAnchor", "endAnchor", "quote"]) assertString(ref[key], `${label}.provenance[${index}].${key}`);
  }
}

function validateArtifactPacket(value: unknown, label: string): asserts value is ArtifactPacket {
  assertRecord(value, label);
  assertString(value.id, `${label}.id`);
  if (!validGroups.includes(String(value.group) as WorldImportGroup)) throw new Error(`${label}.group must be one of ${validGroups.join(", ")}`);
  assertOptionalString(value.type, `${label}.type`);
  assertString(value.title, `${label}.title`);
  assertOptionalString(value.description, `${label}.description`);
  assertOptionalString(value.resource, `${label}.resource`);
  assertOptionalStringArray(value.tags, `${label}.tags`);
  assertOptionalString(value.timestamp, `${label}.timestamp`);
  assertOptionalStringArray(value.related, `${label}.related`);
  if (value.metadata !== undefined) assertRecord(value.metadata, `${label}.metadata`);
  if (!Array.isArray(value.sections)) throw new Error(`${label}.sections must be an array`);
  for (const [index, section] of value.sections.entries()) {
    assertRecord(section, `${label}.sections[${index}]`);
    assertString(section.heading, `${label}.sections[${index}].heading`);
    assertString(section.body, `${label}.sections[${index}].body`);
  }
  validateProvenance(value.provenance, label);
}

function validateCandidateEnvelope(value: unknown, label: string): void {
  assertRecord(value, label);
  assertString(value.id, `${label}.id`);
  if (!validGroups.includes(String(value.group) as WorldImportGroup)) throw new Error(`${label}.group must be one of ${validGroups.join(", ")}`);
  assertString(value.title, `${label}.title`);
  validateProvenance(value.provenance, label);
  if (value.metadata !== undefined) assertRecord(value.metadata, `${label}.metadata`);
}

function validateCandidateDispositions(value: unknown): asserts value is CandidateDisposition[] {
  if (!Array.isArray(value)) throw new Error("stage.candidateDispositions must be an array");
  for (const [index, disposition] of value.entries()) {
    assertRecord(disposition, `stage.candidateDispositions[${index}]`);
    assertString(disposition.candidateId, `stage.candidateDispositions[${index}].candidateId`);
    if (disposition.unitId !== undefined) assertString(disposition.unitId, `stage.candidateDispositions[${index}].unitId`);
    if (!["represented", "merged", "deferred", "dropped"].includes(String(disposition.disposition))) throw new Error(`stage.candidateDispositions[${index}].disposition is invalid`);
    if (disposition.artifactId !== undefined) assertString(disposition.artifactId, `stage.candidateDispositions[${index}].artifactId`);
    if ((disposition.disposition === "dropped" || disposition.disposition === "deferred") && typeof disposition.reason !== "string") throw new Error(`stage.candidateDispositions[${index}].reason must explain dropped/deferred candidates`);
    if (disposition.reason !== undefined) assertString(disposition.reason, `stage.candidateDispositions[${index}].reason`);
  }
}

export function validateStageEnvelope(stage: StageEnvelope, options: { requireCandidates?: boolean; requireArtifacts?: boolean } = {}): void {
  assertRecord(stage, "stage");
  if (stage.version !== 1) throw new Error("stage.version must be 1");
  if (!["extraction", "merge", "review"].includes(String(stage.kind))) throw new Error("stage.kind is invalid");
  if (stage.unitId !== undefined) assertString(stage.unitId, "stage.unitId");
  if (stage.sourceId !== undefined) assertString(stage.sourceId, "stage.sourceId");
  if (options.requireCandidates && !Array.isArray(stage.candidates)) throw new Error("stage.candidates must be an array");
  if (stage.candidates !== undefined) {
    if (!Array.isArray(stage.candidates)) throw new Error("stage.candidates must be an array");
    const seenCandidates = new Set<string>();
    stage.candidates.forEach((candidate, index) => {
      validateCandidateEnvelope(candidate, `stage.candidates[${index}]`);
      if (seenCandidates.has(candidate.id)) throw new Error(`duplicate candidate id ${candidate.id}`);
      seenCandidates.add(candidate.id);
    });
  }
  if (stage.candidateDispositions !== undefined) validateCandidateDispositions(stage.candidateDispositions);
  if (options.requireArtifacts && !Array.isArray(stage.artifacts)) throw new Error("stage.artifacts must be an array");
  if (stage.artifacts !== undefined) {
    if (!Array.isArray(stage.artifacts)) throw new Error("stage.artifacts must be an array");
    const seen = new Set<string>();
    stage.artifacts.forEach((artifact, index) => {
      validateArtifactPacket(artifact, `stage.artifacts[${index}]`);
      if (seen.has(artifact.id)) throw new Error(`duplicate artifact id ${artifact.id}`);
      seen.add(artifact.id);
    });
  }
}

export function stageBasename(path: string): string {
  return basename(path).replace(/\.json$/i, "");
}
