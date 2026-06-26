import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ArtifactPacket, ManifestDiagnostic, NormalizedSourceUnit, SourceManifest, SourceSpanRef, StageEnvelope } from "./types.js";

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
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
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

export function diagnostic(level: ManifestDiagnostic["level"], message: string, path?: string): ManifestDiagnostic {
  return { level, message, ...(path ? { path } : {}) };
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
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
  if (!["people", "places", "things", "facts"].includes(String(value.group))) throw new Error(`${label}.group must be people, places, things, or facts`);
  assertString(value.title, `${label}.title`);
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
  if (!["people", "places", "things", "facts"].includes(String(value.group))) throw new Error(`${label}.group must be people, places, things, or facts`);
  assertString(value.title, `${label}.title`);
  validateProvenance(value.provenance, label);
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
    stage.candidates.forEach((candidate, index) => validateCandidateEnvelope(candidate, `stage.candidates[${index}]`));
  }
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
