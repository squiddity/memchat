import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { emitWorldLibrary } from "./emit.js";
import { lintWorldImport } from "./eval.js";
import { readSlice } from "./spans.js";
import {
  mergedCandidatesPath,
  readExtractionStages,
  readManifest,
  readMergeStage,
  readNormalizedUnit,
  writeJson,
  writeMergeStage,
} from "./staging.js";
import {
  WORLD_IMPORT_GROUPS,
  type ArtifactPacket,
  type CandidateDisposition,
  type LintDiagnostic,
  type SourceManifestEntry,
  type SourceSpanRef,
  type StageEnvelope,
  type WorldImportGroup,
} from "./types.js";

const validGroups = new Set<string>(WORLD_IMPORT_GROUPS);
const placeholderQuotePatterns = [
  /^\s*$/,
  /\[\s*source\s+span\b/i,
  /source\s+span\s+b\d{4}/i,
  /TODO\s+quote/i,
  /^\s*quote\s*$/i,
];

export type SourceSelector = {
  unit?: string;
  source?: string;
  unitIndex?: number;
  order?: number;
  entryPath?: string;
  title?: string;
};

export type ResolveRefOptions = SourceSelector & {
  outputRoot: string;
  start: string;
  end: string;
};

export type QuoteRefOptions = ResolveRefOptions & {
  maxChars?: number;
  joiner?: string;
  plain?: boolean;
  asRef?: boolean;
};

export type ArtifactValidationOptions = {
  outputRoot: string;
  artifact: ArtifactPacket;
  allowEmptyQuotes?: boolean;
  plannedIds?: string[];
  existingMerge?: StageEnvelope;
};

export type ArtifactValidationResult = {
  passed: boolean;
  diagnostics: LintDiagnostic[];
};

export type CoveragePlan = {
  sourceUnits: number;
  extractionStages: number;
  artifacts: number;
  groups: Record<WorldImportGroup, number>;
  unitCoverage: Array<{
    unitId: string;
    sourceId: string;
    order: number;
    title?: string;
    role?: string;
    hasExtraction: boolean;
    representedByArtifacts: string[];
    sourcePageEmitted: boolean;
    diagnostics: LintDiagnostic[];
  }>;
  candidateAccounting: {
    totalCandidates: number;
    represented: number;
    merged: number;
    deferred: number;
    dropped: number;
    unaccounted: Array<{ unitId?: string; candidateId: string }>;
  };
  recommendations: LintDiagnostic[];
};

export function isPlaceholderQuote(quote: string | undefined): boolean {
  return placeholderQuotePatterns.some((pattern) => pattern.test(quote ?? ""));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseNumber(value: string | true | undefined, label: string): number | undefined {
  if (value === undefined || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

export function selectorFromOptions(options: Record<string, string | true>): SourceSelector {
  return {
    unit: typeof options.unit === "string" ? options.unit : undefined,
    source: typeof options.source === "string" ? options.source : undefined,
    unitIndex: parseNumber(options["unit-index"], "--unit-index"),
    order: parseNumber(options.order, "--order"),
    entryPath: typeof options["entry-path"] === "string" ? options["entry-path"] : undefined,
    title: typeof options.title === "string" ? options.title : undefined,
  };
}

async function sourcePageExists(outputRoot: string, unitId: string): Promise<boolean> {
  const worldUnitPath = join(outputRoot, "world", "sources", "units", `${unitId}.md`);
  return existsSync(worldUnitPath);
}

function unitMatchesSelector(unit: SourceManifestEntry, selector: SourceSelector): boolean {
  if (selector.unit && unit.unitId !== selector.unit) return false;
  if (selector.source && unit.sourceId !== selector.source) return false;
  if (selector.order !== undefined && unit.order !== selector.order) return false;
  if (selector.entryPath) {
    const haystacks = [unit.sourceEntryPath, unit.inputPath, unit.normalizedPath].filter((item): item is string => typeof item === "string");
    if (!haystacks.some((item) => item.includes(selector.entryPath!))) return false;
  }
  if (selector.title) {
    if (!unit.title?.toLowerCase().includes(selector.title.toLowerCase())) return false;
  }
  return true;
}

export async function resolveUnit(outputRoot: string, selector: SourceSelector): Promise<SourceManifestEntry> {
  const manifest = await readManifest(outputRoot);
  const selectorCount = [selector.unit, selector.source, selector.order, selector.entryPath, selector.title].filter((item) => item !== undefined).length;
  if (selectorCount === 0) throw new Error("Provide one source selector: --unit, --source, --order, --entry-path, or --title");
  let matches = manifest.units.filter((unit) => unitMatchesSelector(unit, selector));
  if (selector.unitIndex !== undefined) matches = matches.filter((_unit, index) => index + 1 === selector.unitIndex);
  if (matches.length === 0) throw new Error(`No normalized unit matched selector ${JSON.stringify(selector)}`);
  if (matches.length > 1) {
    const rendered = matches.slice(0, 10).map((unit) => `${unit.order}: ${unit.unitId}${unit.title ? ` (${unit.title})` : ""}`).join("\n");
    throw new Error(`Selector matched ${matches.length} units; refine it. First matches:\n${rendered}`);
  }
  return matches[0]!;
}

export async function resolveRef(options: ResolveRefOptions): Promise<SourceSpanRef> {
  const unitEntry = await resolveUnit(options.outputRoot, options);
  const unit = await readNormalizedUnit(options.outputRoot, unitEntry.unitId);
  readSlice(unit, options.start, options.end);
  return {
    sourceId: unit.sourceId,
    unitId: unit.unitId,
    startAnchor: options.start,
    endAnchor: options.end,
    quote: "",
  };
}

function stripBlockPrefixes(text: string): string {
  return text.replace(/^\[b\d{4}\]\s*/gm, "");
}

function truncateText(text: string, maxChars?: number): { text: string; truncated: boolean } {
  if (maxChars === undefined || text.length <= maxChars) return { text, truncated: false };
  if (maxChars < 20) return { text: text.slice(0, maxChars), truncated: true };
  return { text: `${text.slice(0, maxChars - 1)}…`, truncated: true };
}

export async function quoteRef(options: QuoteRefOptions): Promise<SourceSpanRef & { text: string; blockCount: number; truncated: boolean }> {
  const base = await resolveRef(options);
  const unit = await readNormalizedUnit(options.outputRoot, base.unitId);
  const start = unit.blocks.findIndex((block) => block.anchor === base.startAnchor);
  const end = unit.blocks.findIndex((block) => block.anchor === base.endAnchor);
  const joiner = options.joiner ?? "\n\n";
  let text = unit.blocks.slice(start, end + 1).map((block) => block.text).join(joiner);
  if (options.plain) text = stripBlockPrefixes(text);
  const truncated = truncateText(text, options.maxChars);
  return { ...base, quote: truncated.text, text: truncated.text, blockCount: end - start + 1, truncated: truncated.truncated };
}

async function validateSourceRef(outputRoot: string, ref: SourceSpanRef, path: string, diagnostics: LintDiagnostic[], allowEmptyQuotes: boolean): Promise<void> {
  let unit;
  try {
    unit = await readNormalizedUnit(outputRoot, ref.unitId);
  } catch {
    diagnostics.push({ code: "unresolved-provenance-unit", level: "error", path, unitId: ref.unitId, message: `Provenance unit ${ref.unitId} does not exist` });
    return;
  }
  if (unit.sourceId !== ref.sourceId) diagnostics.push({ code: "provenance-source-mismatch", level: "error", path, unitId: ref.unitId, message: `Ref sourceId ${ref.sourceId} does not match unit sourceId ${unit.sourceId}` });
  try {
    readSlice(unit, ref.startAnchor, ref.endAnchor);
  } catch (error) {
    diagnostics.push({ code: "unresolved-provenance-anchor", level: "error", path, unitId: ref.unitId, message: error instanceof Error ? error.message : String(error) });
  }
  if (!allowEmptyQuotes && isPlaceholderQuote(ref.quote)) diagnostics.push({ code: "missing-provenance-quote", level: "warning", path: `${path}.quote`, unitId: ref.unitId, message: "Provenance quote is empty or placeholder; use quote-ref --as-ref to populate it" });
}

function requireStringField(value: Record<string, unknown>, key: string, path: string, diagnostics: LintDiagnostic[]): void {
  if (typeof value[key] !== "string" || String(value[key]).length === 0) diagnostics.push({ code: "invalid-artifact-field", level: "error", path: `${path}.${key}`, message: `${path}.${key} must be a non-empty string` });
}

export async function validateArtifact(options: ArtifactValidationOptions): Promise<ArtifactValidationResult> {
  const diagnostics: LintDiagnostic[] = [];
  const artifact = options.artifact;
  const raw = artifact as unknown;
  const record = asRecord(raw);
  if (!record) return { passed: false, diagnostics: [{ code: "invalid-artifact", level: "error", message: "Artifact must be an object" }] };

  requireStringField(record, "id", "artifact", diagnostics);
  requireStringField(record, "title", "artifact", diagnostics);
  if (typeof record.group !== "string" || !validGroups.has(record.group)) diagnostics.push({ code: "invalid-artifact-group", level: "error", path: "artifact.group", artifactId: artifact.id, message: `group must be one of ${WORLD_IMPORT_GROUPS.join(", ")}` });
  if (!Array.isArray(record.sections) || record.sections.length === 0) diagnostics.push({ code: "invalid-artifact-sections", level: "error", path: "artifact.sections", artifactId: artifact.id, message: "sections must be a non-empty array" });
  else record.sections.forEach((section, index) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord || typeof sectionRecord.heading !== "string" || sectionRecord.heading.length === 0) diagnostics.push({ code: "invalid-artifact-section", level: "error", path: `artifact.sections[${index}].heading`, artifactId: artifact.id, message: "section heading must be non-empty" });
    if (!sectionRecord || typeof sectionRecord.body !== "string" || sectionRecord.body.length === 0) diagnostics.push({ code: "invalid-artifact-section", level: "error", path: `artifact.sections[${index}].body`, artifactId: artifact.id, message: "section body must be non-empty" });
  });

  const existing = options.existingMerge ?? await readOptionalMergeStage(options.outputRoot);
  const existingArtifacts = existing?.artifacts ?? [];
  const duplicate = existingArtifacts.find((item) => item.id === artifact.id);
  if (duplicate) diagnostics.push({ code: "duplicate-artifact-id", level: "warning", path: "artifact.id", artifactId: artifact.id, message: `Artifact id ${artifact.id} already exists; use write-artifact --mode replace or --mode upsert intentionally` });

  const knownIds = new Set<string>([...existingArtifacts.map((item) => item.id), ...(options.plannedIds ?? []), artifact.id]);
  if (Array.isArray(artifact.related)) {
    for (const related of artifact.related) if (!knownIds.has(related)) diagnostics.push({ code: "unresolved-related", level: "error", artifactId: artifact.id, message: `Related artifact id ${related} is not known; pass --planned-ids or write the target first` });
  }

  if (!Array.isArray(artifact.provenance) || artifact.provenance.length === 0) diagnostics.push({ code: "missing-provenance", level: "error", artifactId: artifact.id, message: "Artifact must have at least one provenance ref" });
  else {
    for (const [index, ref] of artifact.provenance.entries()) {
      await validateSourceRef(options.outputRoot, ref, `artifact.provenance[${index}]`, diagnostics, options.allowEmptyQuotes ?? false);
    }
  }

  return { passed: diagnostics.every((item) => item.level !== "error"), diagnostics };
}

async function readOptionalMergeStage(outputRoot: string): Promise<StageEnvelope | undefined> {
  try {
    return await readMergeStage(outputRoot);
  } catch {
    return undefined;
  }
}

function emptyMergeStage(): StageEnvelope {
  return { version: 1, kind: "merge", artifacts: [], candidateDispositions: [], diagnostics: [] };
}

export async function writeArtifact(options: {
  outputRoot: string;
  artifact: ArtifactPacket;
  mode: "add" | "replace" | "upsert";
  validate?: boolean;
  allowEmptyQuotes?: boolean;
  plannedIds?: string[];
}): Promise<{ wrote: boolean; mode: string; artifactId: string; artifactCount: number; validation?: ArtifactValidationResult }> {
  const stage = await readOptionalMergeStage(options.outputRoot) ?? emptyMergeStage();
  stage.kind = "merge";
  stage.version = 1;
  stage.artifacts ??= [];
  stage.candidateDispositions ??= [];
  stage.diagnostics ??= [];
  const existingIndex = stage.artifacts.findIndex((item) => item.id === options.artifact.id);
  if (options.mode === "add" && existingIndex !== -1) throw new Error(`Artifact ${options.artifact.id} already exists`);
  if (options.mode === "replace" && existingIndex === -1) throw new Error(`Artifact ${options.artifact.id} does not exist`);

  let validation: ArtifactValidationResult | undefined;
  if (options.validate !== false) {
    const stageForValidation = { ...stage, artifacts: stage.artifacts.filter((item) => item.id !== options.artifact.id) } satisfies StageEnvelope;
    validation = await validateArtifact({ outputRoot: options.outputRoot, artifact: options.artifact, allowEmptyQuotes: options.allowEmptyQuotes, plannedIds: options.plannedIds, existingMerge: stageForValidation });
    if (!validation.passed) return { wrote: false, mode: options.mode, artifactId: options.artifact.id, artifactCount: stage.artifacts.length, validation };
  }

  if (existingIndex === -1) stage.artifacts.push(options.artifact);
  else stage.artifacts[existingIndex] = options.artifact;
  await writeMergeStage(options.outputRoot, stage);
  return { wrote: true, mode: options.mode, artifactId: options.artifact.id, artifactCount: stage.artifacts.length, ...(validation ? { validation } : {}) };
}

function candidateKey(unitId: string | undefined, candidateId: string): string {
  return `${unitId ?? ""}:${candidateId}`;
}

function representedCandidateKeys(artifact: ArtifactPacket): string[] {
  const raw = artifact.metadata?.representedCandidateIds ?? artifact.metadata?.candidateIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

export async function buildCoveragePlan(outputRoot: string): Promise<CoveragePlan> {
  const manifest = await readManifest(outputRoot);
  const extractionStages = await readExtractionStages(outputRoot);
  const merge = await readOptionalMergeStage(outputRoot);
  const artifacts = merge?.artifacts ?? [];
  const groups = Object.fromEntries(WORLD_IMPORT_GROUPS.map((group) => [group, 0])) as Record<WorldImportGroup, number>;
  for (const artifact of artifacts) groups[artifact.group]++;

  const artifactsByUnit = new Map<string, Set<string>>();
  for (const artifact of artifacts) for (const ref of artifact.provenance) {
    const set = artifactsByUnit.get(ref.unitId) ?? new Set<string>();
    set.add(artifact.id);
    artifactsByUnit.set(ref.unitId, set);
  }
  const extractionByUnit = new Map(extractionStages.map((stage) => [stage.unitId, stage]));

  const unitCoverage = await Promise.all(manifest.units.map(async (unit) => {
    const diagnostics: LintDiagnostic[] = [];
    const representedByArtifacts = [...(artifactsByUnit.get(unit.unitId) ?? new Set<string>())].sort();
    const hasExtraction = extractionByUnit.has(unit.unitId);
    if ((unit.role ?? "body") === "body" && extractionStages.length > 0 && !hasExtraction) diagnostics.push({ code: "body-unit-missing-extraction", level: "error", unitId: unit.unitId, message: "Body source unit has no extraction stage" });
    if ((unit.role ?? "body") === "body" && hasExtraction && representedByArtifacts.length === 0) diagnostics.push({ code: "body-unit-no-emitted-coverage", level: "error", unitId: unit.unitId, message: "Body source unit has extraction but no artifact provenance" });
    return {
      unitId: unit.unitId,
      sourceId: unit.sourceId,
      order: unit.order,
      ...(unit.title ? { title: unit.title } : {}),
      ...(unit.role ? { role: unit.role } : {}),
      hasExtraction,
      representedByArtifacts,
      sourcePageEmitted: await sourcePageExists(outputRoot, unit.unitId),
      diagnostics,
    };
  }));

  const allCandidateKeys = new Set<string>();
  const keysByCandidateId = new Map<string, string[]>();
  for (const stage of extractionStages) for (const candidate of stage.candidates ?? []) {
    const key = candidateKey(stage.unitId, candidate.id);
    allCandidateKeys.add(key);
    keysByCandidateId.set(candidate.id, [...(keysByCandidateId.get(candidate.id) ?? []), key]);
  }
  const represented = new Set<string>();
  for (const artifact of artifacts) for (const rawKey of representedCandidateKeys(artifact)) {
    const key = rawKey.includes(":") ? rawKey : candidateKey(undefined, rawKey);
    represented.add(key);
    if (!rawKey.includes(":")) for (const candidate of keysByCandidateId.get(rawKey) ?? []) represented.add(candidate);
  }
  const dispositionCounts: Record<CandidateDisposition["disposition"], number> = { represented: 0, merged: 0, deferred: 0, dropped: 0 };
  const accounted = new Set<string>(represented);
  for (const disposition of merge?.candidateDispositions ?? []) {
    dispositionCounts[disposition.disposition]++;
    const key = candidateKey(disposition.unitId, disposition.candidateId);
    accounted.add(key);
    if (!disposition.unitId) for (const candidate of keysByCandidateId.get(disposition.candidateId) ?? []) accounted.add(candidate);
  }
  const unaccounted = [...allCandidateKeys].filter((key) => !accounted.has(key)).map((key) => {
    const [unitId, candidateId] = key.split(":");
    return { ...(unitId ? { unitId } : {}), candidateId: candidateId ?? "" };
  });

  const recommendations: LintDiagnostic[] = [];
  for (const group of WORLD_IMPORT_GROUPS) if (groups[group] === 0) recommendations.push({ code: `no-${group}-artifacts`, level: "warning", message: `No artifacts exist in group ${group}` });
  if (unaccounted.length > 0) recommendations.push({ code: "unaccounted-candidates", level: "error", message: `${unaccounted.length} extraction candidate(s) lack representation or disposition` });

  return {
    sourceUnits: manifest.units.length,
    extractionStages: extractionStages.length,
    artifacts: artifacts.length,
    groups,
    unitCoverage,
    candidateAccounting: {
      totalCandidates: allCandidateKeys.size,
      represented: represented.size,
      merged: dispositionCounts.merged,
      deferred: dispositionCounts.deferred,
      dropped: dispositionCounts.dropped,
      unaccounted,
    },
    recommendations,
  };
}

function repairSuggestion(code: string): string {
  switch (code) {
    case "unresolved-provenance-unit":
    case "unresolved-provenance-anchor":
    case "provenance-source-mismatch":
    case "unresolved-anchor":
      return "Use resolve-ref to find the canonical source/unit/anchor values, then patch the artifact provenance.";
    case "missing-provenance-quote":
      return "Use quote-ref --as-ref to populate an exact quote for the source span.";
    case "unresolved-related":
    case "unresolved-wikilink":
      return "Create the missing artifact with write-artifact or remove/fix the related/wiki link.";
    case "unaccounted-candidate":
    case "unaccounted-candidates":
      return "Add metadata.representedCandidateIds to an artifact or add a model-authored candidateDisposition.";
    case "body-unit-missing-extraction":
      return "Run/read the unit and write an extraction stage, or document why the body unit should be excluded.";
    case "body-unit-no-emitted-coverage":
      return "Add artifact provenance covering this unit or explicitly account for its candidates.";
    default:
      return "Inspect the diagnostic and repair the merge packet or emitted markdown as appropriate.";
  }
}

export async function buildRepairSummary(outputRoot: string, format: "json" | "markdown" = "markdown"): Promise<unknown> {
  const lint = await lintWorldImport(outputRoot);
  const coverage = await buildCoveragePlan(outputRoot);
  const diagnostics = [...lint.diagnostics, ...coverage.recommendations, ...coverage.unitCoverage.flatMap((unit) => unit.diagnostics)];
  const items = diagnostics.map((diagnostic) => ({ ...diagnostic, suggestion: repairSuggestion(diagnostic.code) }));
  if (format === "json") return { passed: lint.passed && items.every((item) => item.level !== "error"), items };

  const errors = items.filter((item) => item.level === "error");
  const warnings = items.filter((item) => item.level === "warning");
  const lines: string[] = ["# World import repair summary", ""];
  lines.push("## Errors to fix before declaring success", "");
  if (errors.length === 0) lines.push("None.", "");
  else errors.forEach((item, index) => lines.push(`${index + 1}. \`${item.code}\`${item.artifactId ? ` in artifact \`${item.artifactId}\`` : ""}${item.unitId ? ` for unit \`${item.unitId}\`` : ""}`, `   - ${item.message}`, `   - Suggested repair: ${item.suggestion}`, ""));
  lines.push("## Warnings to inspect", "");
  if (warnings.length === 0) lines.push("None.", "");
  else warnings.forEach((item, index) => lines.push(`${index + 1}. \`${item.code}\`${item.artifactId ? ` in artifact \`${item.artifactId}\`` : ""}${item.unitId ? ` for unit \`${item.unitId}\`` : ""}`, `   - ${item.message}`, `   - Suggested repair: ${item.suggestion}`, ""));
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function emitLintRepairLoop(outputRoot: string, maxIterations = 1): Promise<{ passed: boolean; iterations: number; written: string[]; lint: unknown; coverage: CoveragePlan; repairSummaryPath: string }> {
  let written: string[] = [];
  let lint = await lintWorldImport(outputRoot);
  let coverage = await buildCoveragePlan(outputRoot);
  const repairSummaryPath = join(outputRoot, "stages", "repair-summary.md");
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    written = await emitWorldLibrary(outputRoot);
    lint = await lintWorldImport(outputRoot);
    coverage = await buildCoveragePlan(outputRoot);
    const summary = await buildRepairSummary(outputRoot, "markdown") as string;
    await mkdir(dirname(repairSummaryPath), { recursive: true });
    await writeFile(repairSummaryPath, summary, "utf-8");
    if (lint.passed && coverage.recommendations.every((item) => item.level !== "error") && coverage.unitCoverage.every((unit) => unit.diagnostics.every((item) => item.level !== "error"))) {
      iterations++;
      break;
    }
  }
  return { passed: lint.passed, iterations, written, lint, coverage, repairSummaryPath };
}

export async function patchMerge(outputRoot: string, operations: unknown[]): Promise<{ patched: boolean; artifactCount: number; backupPath: string; validation: { passed: boolean; diagnostics: LintDiagnostic[] } }> {
  if (!Array.isArray(operations)) throw new Error("patch must be an array of operations");
  const stage = await readMergeStage(outputRoot);
  const backupPath = join(outputRoot, "stages", "merge", "backups", `merged-candidates-${Date.now()}.json`);
  await writeJson(backupPath, stage);
  stage.artifacts ??= [];
  for (const [index, operation] of operations.entries()) {
    const op = asRecord(operation);
    if (!op || typeof op.op !== "string") throw new Error(`patch[${index}].op must be a string`);
    if (op.op === "replace-provenance") {
      if (typeof op.artifactId !== "string") throw new Error(`patch[${index}].artifactId is required`);
      if (!Number.isInteger(op.index)) throw new Error(`patch[${index}].index must be an integer`);
      const artifact = stage.artifacts.find((item) => item.id === op.artifactId);
      if (!artifact) throw new Error(`artifact ${op.artifactId} not found`);
      const ref = op.value as SourceSpanRef;
      artifact.provenance[op.index as number] = ref;
    } else if (op.op === "remove-provenance") {
      if (typeof op.artifactId !== "string") throw new Error(`patch[${index}].artifactId is required`);
      if (!Number.isInteger(op.index)) throw new Error(`patch[${index}].index must be an integer`);
      const artifact = stage.artifacts.find((item) => item.id === op.artifactId);
      if (!artifact) throw new Error(`artifact ${op.artifactId} not found`);
      artifact.provenance.splice(op.index as number, 1);
    } else if (op.op === "add-disposition") {
      stage.candidateDispositions ??= [];
      stage.candidateDispositions.push(op.value as CandidateDisposition);
    } else {
      throw new Error(`Unsupported patch operation ${op.op}`);
    }
  }
  const diagnostics: LintDiagnostic[] = [];
  for (const artifact of stage.artifacts) {
    const result = await validateArtifact({ outputRoot, artifact, existingMerge: { ...stage, artifacts: stage.artifacts.filter((item) => item.id !== artifact.id) } });
    diagnostics.push(...result.diagnostics);
  }
  const validation = { passed: diagnostics.every((item) => item.level !== "error"), diagnostics };
  if (validation.passed) await writeMergeStage(outputRoot, stage);
  return { patched: validation.passed, artifactCount: stage.artifacts.length, backupPath, validation };
}

export async function readArtifactFromFileOrStdin(file: string | undefined, stdinText: string): Promise<ArtifactPacket> {
  const text = file ? await readFile(file, "utf-8") : stdinText;
  return JSON.parse(text) as ArtifactPacket;
}

export async function readPatchFromFileOrStdin(file: string | undefined, stdinText: string): Promise<unknown[]> {
  const text = file ? await readFile(file, "utf-8") : stdinText;
  return JSON.parse(text) as unknown[];
}

export function parsePlannedIds(value: string | true | undefined): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseMaxIterations(value: string | true | undefined): number {
  if (typeof value !== "string") return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--max-iterations must be a positive integer");
  return parsed;
}

export function parseMaxChars(value: string | true | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--max-chars must be a positive integer");
  return parsed;
}

export function parseWriteMode(value: string | true | undefined): "add" | "replace" | "upsert" {
  if (value === undefined || value === true) return "upsert";
  if (value === "add" || value === "replace" || value === "upsert") return value;
  throw new Error("--mode must be add, replace, or upsert");
}

export async function writeRepairSummaryFile(outputRoot: string, content: string): Promise<string> {
  const path = join(outputRoot, "stages", "repair-summary.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
  return path;
}

export { mergedCandidatesPath };
