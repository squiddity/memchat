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

export type ProvenanceAuditOptions = {
  outputRoot: string;
  artifactId?: string;
  strict?: boolean;
};

export type ProvenanceAuditDiagnostic = LintDiagnostic & {
  suggestion: string;
};

export type ProvenanceAuditResult = {
  passed: boolean;
  summary: {
    artifacts: number;
    warnings: number;
    errors: number;
  };
  diagnostics: ProvenanceAuditDiagnostic[];
};

export type FindTextOptions = SourceSelector & {
  outputRoot: string;
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  groupBodyOnly?: boolean;
  context?: number;
  maxResults?: number;
};

export type FindTextResult = {
  query: string;
  matches: Array<{
    unitId: string;
    sourceId: string;
    order: number;
    title?: string;
    anchor: string;
    kind?: string;
    text: string;
    context: Array<{ anchor: string; kind?: string; text: string }>;
    quoteRefCommand: string;
  }>;
};

export type SuggestRefCandidatesOptions = SourceSelector & {
  outputRoot: string;
  claim: string;
  artifactId?: string;
  maxResults?: number;
  window?: number;
};

export type SuggestRefCandidatesResult = {
  claim: string;
  candidates: Array<{
    score: number;
    unitId: string;
    sourceId: string;
    order: number;
    title?: string;
    startAnchor: string;
    endAnchor: string;
    quote: string;
    matchedTerms: string[];
    quoteRefCommand: string;
  }>;
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
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

export async function writeArtifacts(options: {
  outputRoot: string;
  artifacts: ArtifactPacket[];
  mode: "add" | "replace" | "upsert";
  validate?: boolean;
  allowEmptyQuotes?: boolean;
  plannedIds?: string[];
}): Promise<{ wrote: boolean; mode: string; artifactIds: string[]; artifactCount: number; validations?: ArtifactValidationResult[] }> {
  if (!Array.isArray(options.artifacts) || options.artifacts.length === 0) throw new Error("artifacts must be a non-empty array");
  const duplicateIds = options.artifacts.map((artifact) => artifact.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) throw new Error(`artifact batch contains duplicate ids: ${[...new Set(duplicateIds)].join(", ")}`);

  const stage = await readOptionalMergeStage(options.outputRoot) ?? emptyMergeStage();
  stage.kind = "merge";
  stage.version = 1;
  stage.artifacts ??= [];
  stage.candidateDispositions ??= [];
  stage.diagnostics ??= [];
  const batchIds = options.artifacts.map((artifact) => artifact.id);
  const plannedIds = [...new Set([...(options.plannedIds ?? []), ...batchIds])];
  const validations: ArtifactValidationResult[] = [];

  for (const artifact of options.artifacts) {
    const existingIndex = stage.artifacts.findIndex((item) => item.id === artifact.id);
    if (options.mode === "add" && existingIndex !== -1) throw new Error(`Artifact ${artifact.id} already exists`);
    if (options.mode === "replace" && existingIndex === -1) throw new Error(`Artifact ${artifact.id} does not exist`);
    if (options.validate !== false) {
      const stageForValidation = { ...stage, artifacts: stage.artifacts.filter((item) => item.id !== artifact.id) } satisfies StageEnvelope;
      const validation = await validateArtifact({ outputRoot: options.outputRoot, artifact, allowEmptyQuotes: options.allowEmptyQuotes, plannedIds, existingMerge: stageForValidation });
      validations.push(validation);
      if (!validation.passed) return { wrote: false, mode: options.mode, artifactIds: batchIds, artifactCount: stage.artifacts.length, validations };
    }
  }

  for (const artifact of options.artifacts) {
    const existingIndex = stage.artifacts.findIndex((item) => item.id === artifact.id);
    if (existingIndex === -1) stage.artifacts.push(artifact);
    else stage.artifacts[existingIndex] = artifact;
  }
  await writeMergeStage(options.outputRoot, stage);
  return { wrote: true, mode: options.mode, artifactIds: batchIds, artifactCount: stage.artifacts.length, ...(options.validate === false ? {} : { validations }) };
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

function auditSuggestion(code: string): string {
  switch (code) {
    case "heading-only-provenance":
    case "first-block-provenance":
      return "Use find-text or suggest-ref-candidates to locate narrative evidence, then quote-ref --as-ref to add or replace the heading citation.";
    case "low-information-provenance":
      return "Use quote-ref --as-ref on a more informative source span that supports the artifact claim.";
    case "sparse-provenance-density":
    case "single-ref-many-sections":
      return "Review major sections and add claim-supporting refs with quote-ref --as-ref where evidence is thin.";
    case "repeated-identical-provenance":
      return "Inspect repeated citations; story headings are often useful context but weak sole evidence for detailed artifacts.";
    case "style-under-cited":
      return "Find multiple representative style examples across source blocks and cite them separately.";
    case "event-heading-only-provenance":
      return "Find setup/action/reveal/consequence passages with find-text or suggest-ref-candidates and cite narrative spans.";
    default:
      return "Inspect the citation and add more precise source evidence if needed.";
  }
}

function plainQuote(text: string): string {
  return text.replace(/^\[b\d{4}\]\s*/gm, "").replace(/\s+/g, " ").trim();
}

function isMostlyTitleLike(text: string): boolean {
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 14) return false;
  const titled = words.filter((word) => /^[A-Z0-9]/.test(word));
  return titled.length / words.length >= 0.7;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quoteRefCommand(outputRoot: string, unitId: string, startAnchor: string, endAnchor: string): string {
  return `npm run world-import-helper -- quote-ref --output ${shellQuote(outputRoot)} --unit ${shellQuote(unitId)} --start ${shellQuote(startAnchor)} --end ${shellQuote(endAnchor)} --as-ref`;
}

function markdownDiagnosticList(title: string, diagnostics: ProvenanceAuditDiagnostic[]): string[] {
  const lines = [`## ${title}`, ""];
  if (diagnostics.length === 0) return [...lines, "None.", ""];
  diagnostics.forEach((item, index) => {
    lines.push(`${index + 1}. \`${item.code}\`${item.artifactId ? ` in \`${item.artifactId}\`` : ""}${item.unitId ? ` for unit \`${item.unitId}\`` : ""}`);
    lines.push(`   - ${item.message}`);
    lines.push(`   - Suggested repair: ${item.suggestion}`);
    if (item.path) lines.push(`   - Path: \`${item.path}\``);
    lines.push("");
  });
  return lines;
}

export function renderProvenanceAuditMarkdown(result: ProvenanceAuditResult): string {
  const errors = result.diagnostics.filter((item) => item.level === "error");
  const warnings = result.diagnostics.filter((item) => item.level === "warning");
  const lines = [
    "# World import provenance audit",
    "",
    `Passed: ${result.passed ? "yes" : "no"}`,
    `Artifacts audited: ${result.summary.artifacts}`,
    `Warnings: ${result.summary.warnings}`,
    `Errors: ${result.summary.errors}`,
    "",
    ...markdownDiagnosticList("Errors", errors),
    ...markdownDiagnosticList("Warnings", warnings),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function provenanceAudit(options: ProvenanceAuditOptions): Promise<ProvenanceAuditResult> {
  const stage = await readMergeStage(options.outputRoot);
  const artifacts = (stage.artifacts ?? []).filter((artifact) => !options.artifactId || artifact.id === options.artifactId);
  if (options.artifactId && artifacts.length === 0) throw new Error(`Artifact ${options.artifactId} not found`);
  const unitCache = new Map<string, Awaited<ReturnType<typeof readNormalizedUnit>>>();
  const getUnit = async (unitId: string) => {
    let unit = unitCache.get(unitId);
    if (!unit) {
      unit = await readNormalizedUnit(options.outputRoot, unitId);
      unitCache.set(unitId, unit);
    }
    return unit;
  };
  const diagnostics: ProvenanceAuditDiagnostic[] = [];
  const repeated = new Map<string, Array<{ artifactId: string; index: number }>>();
  const add = (diagnostic: LintDiagnostic) => diagnostics.push({ ...diagnostic, level: options.strict && diagnostic.level === "warning" ? "error" : diagnostic.level, suggestion: auditSuggestion(diagnostic.code) });

  for (const artifact of artifacts) {
    const sectionCount = artifact.sections.filter((section) => section.body.trim().length > 0).length;
    const bodyChars = artifact.sections.reduce((sum, section) => sum + section.body.trim().length, 0);
    const refCount = artifact.provenance.length;
    if (sectionCount >= 4 && refCount < 2) add({ code: "single-ref-many-sections", level: "warning", artifactId: artifact.id, message: `${sectionCount} non-empty sections have only ${refCount} provenance ref(s).` });
    if ((sectionCount >= 4 || bodyChars >= 1600) && (refCount / Math.max(1, sectionCount) < 0.5 || bodyChars / Math.max(1, refCount) > 1200)) add({ code: "sparse-provenance-density", level: "warning", artifactId: artifact.id, message: `${sectionCount} sections, ${bodyChars} body chars, ${refCount} provenance ref(s).` });
    if (artifact.group === "style" && bodyChars >= 80 && refCount < 3) add({ code: "style-under-cited", level: "warning", artifactId: artifact.id, message: `Substantive style artifact has ${refCount} provenance ref(s); multiple examples are usually needed.` });

    let headingOnlyRefs = 0;
    for (const [index, ref] of artifact.provenance.entries()) {
      const key = `${ref.unitId}:${ref.startAnchor}:${ref.endAnchor}`;
      repeated.set(key, [...(repeated.get(key) ?? []), { artifactId: artifact.id, index }]);
      let unit;
      try { unit = await getUnit(ref.unitId); } catch { continue; }
      const start = unit.blocks.findIndex((block) => block.anchor === ref.startAnchor);
      const end = unit.blocks.findIndex((block) => block.anchor === ref.endAnchor);
      if (start === -1 || end === -1 || end < start) continue;
      const blocks = unit.blocks.slice(start, end + 1);
      const quote = plainQuote(ref.quote || blocks.map((block) => block.text).join("\n"));
      const headingOnly = blocks.length > 0 && blocks.every((block) => block.kind === "heading");
      const quoteLooksLikeTitle = Boolean(unit.title && quote.toLowerCase() === unit.title.toLowerCase()) || isMostlyTitleLike(quote);
      if (headingOnly || quoteLooksLikeTitle) {
        headingOnlyRefs++;
        add({ code: "heading-only-provenance", level: "warning", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: "Citation points to a heading/title-like block; detailed claims usually need narrative evidence." });
      }
      if (quote.length > 0 && quote.length < 30) add({ code: "low-information-provenance", level: "warning", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}].quote`, message: `Citation quote is very short (${quote.length} chars).` });
      if (ref.startAnchor === "b0001") add({ code: "first-block-provenance", level: "warning", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: "Citation starts at b0001; first-block refs are often headings or coarse story context." });
    }
    if ((artifact.group === "facts" || artifact.type === "event") && refCount > 0 && headingOnlyRefs === refCount) add({ code: "event-heading-only-provenance", level: "warning", artifactId: artifact.id, message: "Fact/event artifact provenance is only heading/title-like refs; event details likely need narrative body evidence." });
  }

  for (const [key, uses] of repeated.entries()) {
    if (uses.length < 3) continue;
    const [unitId, startAnchor, endAnchor] = key.split(":");
    add({ code: "repeated-identical-provenance", level: "warning", unitId, path: `${unitId}:${startAnchor}-${endAnchor}`, message: `Same source span is cited by ${uses.length} artifacts: ${uses.map((use) => use.artifactId).slice(0, 8).join(", ")}${uses.length > 8 ? ", …" : ""}.` });
  }
  const warnings = diagnostics.filter((item) => item.level === "warning").length;
  const errors = diagnostics.filter((item) => item.level === "error").length;
  return { passed: errors === 0, summary: { artifacts: artifacts.length, warnings, errors }, diagnostics };
}

async function selectedUnits(outputRoot: string, selector: SourceSelector, groupBodyOnly?: boolean) {
  const manifest = await readManifest(outputRoot);
  let units = manifest.units.filter((unit) => unitMatchesSelector(unit, selector));
  const selectorCount = [selector.unit, selector.source, selector.order, selector.entryPath, selector.title].filter((item) => item !== undefined).length;
  if (selectorCount === 0) units = manifest.units;
  if (groupBodyOnly) units = units.filter((unit) => (unit.role ?? "body") === "body");
  return units;
}

export async function findText(options: FindTextOptions): Promise<FindTextResult> {
  const units = await selectedUnits(options.outputRoot, options, options.groupBodyOnly);
  const maxResults = options.maxResults ?? 20;
  const contextSize = options.context ?? 0;
  const matches: FindTextResult["matches"] = [];
  const flags = options.caseSensitive ? "u" : "iu";
  const pattern = options.regex ? new RegExp(options.query, flags) : undefined;
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  for (const entry of units) {
    const unit = await readNormalizedUnit(options.outputRoot, entry.unitId);
    for (const [index, block] of unit.blocks.entries()) {
      const haystack = options.caseSensitive ? block.text : block.text.toLowerCase();
      const ok = pattern ? pattern.test(block.text) : haystack.includes(needle);
      if (!ok) continue;
      const from = Math.max(0, index - contextSize);
      const to = Math.min(unit.blocks.length - 1, index + contextSize);
      matches.push({
        unitId: unit.unitId,
        sourceId: unit.sourceId,
        order: unit.order,
        ...(unit.title ? { title: unit.title } : {}),
        anchor: block.anchor,
        ...(block.kind ? { kind: block.kind } : {}),
        text: block.text,
        context: unit.blocks.slice(from, to + 1).map((item) => ({ anchor: item.anchor, ...(item.kind ? { kind: item.kind } : {}), text: item.text })),
        quoteRefCommand: quoteRefCommand(options.outputRoot, unit.unitId, block.anchor, block.anchor),
      });
      if (matches.length >= maxResults) return { query: options.query, matches };
    }
  }
  return { query: options.query, matches };
}

const stopwords = new Set("a an and are as at be by for from has he her his in into is it its of on or she that the their them they this to was were when where who with without while but not than then there these those through under over upon within across between during after before only very usually can could would should may might will have had do does did".split(" "));

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}'\s-]/gu, " ").split(/[\s-]+/).map((token) => token.replace(/^'+|'+$/g, "")).filter((token) => token.length > 2 && !stopwords.has(token));
}

export async function suggestRefCandidates(options: SuggestRefCandidatesOptions): Promise<SuggestRefCandidatesResult> {
  const claimTokens = [...new Set(tokenize(options.claim))];
  if (claimTokens.length === 0) return { claim: options.claim, candidates: [] };
  const units = await selectedUnits(options.outputRoot, options, true);
  const merge = options.artifactId ? await readMergeStage(options.outputRoot) : undefined;
  const artifact = options.artifactId ? merge?.artifacts?.find((item) => item.id === options.artifactId) : undefined;
  if (options.artifactId && !artifact) throw new Error(`Artifact ${options.artifactId} not found`);
  const citedUnits = new Set((artifact?.provenance ?? []).map((ref) => ref.unitId));
  const citedStarts = new Map<string, number[]>();
  const unitBlockCache = new Map<string, Awaited<ReturnType<typeof readNormalizedUnit>>>();
  for (const ref of artifact?.provenance ?? []) {
    const unit = unitBlockCache.get(ref.unitId) ?? await readNormalizedUnit(options.outputRoot, ref.unitId);
    unitBlockCache.set(ref.unitId, unit);
    const index = unit.blocks.findIndex((block) => block.anchor === ref.startAnchor);
    if (index >= 0) citedStarts.set(ref.unitId, [...(citedStarts.get(ref.unitId) ?? []), index]);
  }
  const docFreq = new Map<string, number>();
  const unitData = [] as Array<{ entry: SourceManifestEntry; unit: Awaited<ReturnType<typeof readNormalizedUnit>>; blockTokens: string[][] }>;
  for (const entry of units) {
    const unit = unitBlockCache.get(entry.unitId) ?? await readNormalizedUnit(options.outputRoot, entry.unitId);
    const blockTokens = unit.blocks.map((block) => tokenize(block.text));
    for (const tokens of blockTokens) for (const token of new Set(tokens)) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    unitData.push({ entry, unit, blockTokens });
  }
  const window = Math.max(1, options.window ?? 1);
  const candidates: SuggestRefCandidatesResult["candidates"] = [];
  const claimPhrase = options.claim.toLowerCase();
  for (const { unit, blockTokens } of unitData) {
    for (let index = 0; index < unit.blocks.length; index++) {
      const endIndex = Math.min(unit.blocks.length - 1, index + window - 1);
      const tokens = new Set(blockTokens.slice(index, endIndex + 1).flat());
      const matchedTerms = claimTokens.filter((token) => tokens.has(token));
      if (matchedTerms.length === 0) continue;
      let score = 0;
      for (const token of matchedTerms) score += 1 / Math.sqrt(docFreq.get(token) ?? 1);
      score = score / Math.max(1, claimTokens.length);
      const quote = unit.blocks.slice(index, endIndex + 1).map((block) => block.text).join("\n\n");
      score += (matchedTerms.length / claimTokens.length) * 0.2;
      if (quote.toLowerCase().includes(claimPhrase)) score += 0.5;
      if (citedUnits.has(unit.unitId)) score += 0.15;
      const starts = citedStarts.get(unit.unitId) ?? [];
      if (starts.some((start) => Math.abs(start - index) <= 3)) score += 0.1;
      if (unit.blocks.slice(index, endIndex + 1).every((block) => block.kind === "heading") || isMostlyTitleLike(quote)) score *= 0.45;
      candidates.push({
        score: Number(score.toFixed(4)),
        unitId: unit.unitId,
        sourceId: unit.sourceId,
        order: unit.order,
        ...(unit.title ? { title: unit.title } : {}),
        startAnchor: unit.blocks[index]!.anchor,
        endAnchor: unit.blocks[endIndex]!.anchor,
        quote,
        matchedTerms,
        quoteRefCommand: quoteRefCommand(options.outputRoot, unit.unitId, unit.blocks[index]!.anchor, unit.blocks[endIndex]!.anchor),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order || a.startAnchor.localeCompare(b.startAnchor));
  return { claim: options.claim, candidates: candidates.slice(0, options.maxResults ?? 10) };
}

export function renderFindTextMarkdown(result: FindTextResult): string {
  const lines = [`# find-text: ${result.query}`, ""];
  if (result.matches.length === 0) lines.push("No matches.", "");
  result.matches.forEach((match, index) => {
    lines.push(`## ${index + 1}. ${match.title ?? match.unitId} ${match.anchor}`, "", match.text, "", "```bash", match.quoteRefCommand, "```", "");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderSuggestRefCandidatesMarkdown(result: SuggestRefCandidatesResult): string {
  const lines = [`# suggest-ref-candidates`, "", `Claim: ${result.claim}`, ""];
  if (result.candidates.length === 0) lines.push("No candidates.", "");
  result.candidates.forEach((candidate, index) => {
    lines.push(`## ${index + 1}. score ${candidate.score} — ${candidate.title ?? candidate.unitId} ${candidate.startAnchor}-${candidate.endAnchor}`, "", `Matched terms: ${candidate.matchedTerms.join(", ")}`, "", candidate.quote, "", "```bash", candidate.quoteRefCommand, "```", "");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeProvenanceAuditFile(outputRoot: string, format: "json" | "markdown", result: ProvenanceAuditResult): Promise<string> {
  const path = join(outputRoot, "stages", `provenance-audit.${format === "json" ? "json" : "md"}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderProvenanceAuditMarkdown(result), "utf-8");
  return path;
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
  const coveragePassed = coverage.recommendations.every((item) => item.level !== "error") && coverage.unitCoverage.every((unit) => unit.diagnostics.every((item) => item.level !== "error"));
  return { passed: lint.passed && coveragePassed, iterations, written, lint, coverage, repairSummaryPath };
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

export async function readArtifactsFromFileOrStdin(file: string | undefined, stdinText: string): Promise<ArtifactPacket[]> {
  const text = file ? await readFile(file, "utf-8") : stdinText;
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("artifact batch must be a JSON array");
  return parsed as ArtifactPacket[];
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
