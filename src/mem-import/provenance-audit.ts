import { readMergeStage, readNormalizedUnit } from "./stage-store.js";
import { classifyNarrativeSurface } from "./narrative-surfaces.js";
import { readSlice } from "./source-spans.js";
import { MEM_IMPORT_GROUPS, type ArtifactPacket, type LintDiagnostic, type SourceSpanRef, type StageEnvelope } from "./contracts.js";

const validGroups = new Set<string>(MEM_IMPORT_GROUPS);
const placeholderQuotePatterns = [
  /^\s*$/,
  /\[\s*source\s+span\b/i,
  /source\s+span\s+b\d{4}/i,
  /TODO\s+quote/i,
  /^\s*quote\s*$/i,
];

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

export type SourceSpanValidationOptions = {
  outputRoot: string;
  allowEmptyQuotes?: boolean;
};

export function isPlaceholderQuote(quote: string | undefined): boolean {
  return placeholderQuotePatterns.some((pattern) => pattern.test(quote ?? ""));
}

/** Validate a source span against the normalized source ledger. */
export async function validateSourceSpan(
  options: SourceSpanValidationOptions,
  ref: SourceSpanRef,
  path: string,
  diagnostics: LintDiagnostic[],
): Promise<void> {
  let unit;
  try {
    unit = await readNormalizedUnit(options.outputRoot, ref.unitId);
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
  if (!options.allowEmptyQuotes && isPlaceholderQuote(ref.quote)) diagnostics.push({ code: "missing-provenance-quote", level: "warning", path: `${path}.quote`, unitId: ref.unitId, message: "Provenance quote is empty or placeholder" });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requireStringField(value: Record<string, unknown>, key: string, path: string, diagnostics: LintDiagnostic[]): void {
  if (typeof value[key] !== "string" || String(value[key]).length === 0) diagnostics.push({ code: "invalid-artifact-field", level: "error", path: `${path}.${key}`, message: `${path}.${key} must be a non-empty string` });
}

/** Validate a model artifact, including every referenced source span. */
export async function validateArtifact(options: ArtifactValidationOptions): Promise<ArtifactValidationResult> {
  const diagnostics: LintDiagnostic[] = [];
  const record = asRecord(options.artifact as unknown);
  if (!record) return { passed: false, diagnostics: [{ code: "invalid-artifact", level: "error", message: "Artifact must be an object" }] };

  requireStringField(record, "id", "artifact", diagnostics);
  requireStringField(record, "title", "artifact", diagnostics);
  if (typeof record.group !== "string" || !validGroups.has(record.group)) diagnostics.push({ code: "invalid-artifact-group", level: "error", path: "artifact.group", artifactId: options.artifact.id, message: `group must be one of ${MEM_IMPORT_GROUPS.join(", ")}` });
  if (!Array.isArray(record.sections) || record.sections.length === 0) diagnostics.push({ code: "invalid-artifact-sections", level: "error", path: "artifact.sections", artifactId: options.artifact.id, message: "sections must be a non-empty array" });
  else record.sections.forEach((section, index) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord || typeof sectionRecord.heading !== "string" || sectionRecord.heading.length === 0) diagnostics.push({ code: "invalid-artifact-section", level: "error", path: `artifact.sections[${index}].heading`, artifactId: options.artifact.id, message: "section heading must be non-empty" });
    if (!sectionRecord || typeof sectionRecord.body !== "string" || sectionRecord.body.length === 0) diagnostics.push({ code: "invalid-artifact-section", level: "error", path: `artifact.sections[${index}].body`, artifactId: options.artifact.id, message: "section body must be non-empty" });
  });

  const existingArtifacts = options.existingMerge?.artifacts ?? [];
  const duplicate = existingArtifacts.find((item) => item.id === options.artifact.id);
  if (duplicate) diagnostics.push({ code: "duplicate-artifact-id", level: "warning", path: "artifact.id", artifactId: options.artifact.id, message: `Artifact id ${options.artifact.id} already exists; use write-artifact --mode replace or --mode upsert intentionally` });

  const knownIds = new Set<string>([...existingArtifacts.map((item) => item.id), ...(options.plannedIds ?? []), options.artifact.id]);
  if (Array.isArray(options.artifact.related)) {
    for (const related of options.artifact.related) if (!knownIds.has(related)) diagnostics.push({ code: "unresolved-related", level: "error", artifactId: options.artifact.id, message: `Related artifact id ${related} is not known; pass --planned-ids or write the target first` });
  }

  if (!Array.isArray(options.artifact.provenance) || options.artifact.provenance.length === 0) diagnostics.push({ code: "missing-provenance", level: "error", artifactId: options.artifact.id, message: "Artifact must have at least one provenance ref" });
  else {
    for (const [index, ref] of options.artifact.provenance.entries()) {
      await validateSourceSpan({ outputRoot: options.outputRoot, allowEmptyQuotes: options.allowEmptyQuotes }, ref, `artifact.provenance[${index}]`, diagnostics);
    }
  }

  return { passed: diagnostics.every((item) => item.level !== "error"), diagnostics };
}

function auditSuggestion(code: string): string {
  switch (code) {
    case "heading-only-provenance":
    case "first-block-provenance":
      return "Inspect the source and replace the heading citation with narrative evidence.";
    case "low-information-provenance":
      return "Use a more informative source span that supports the artifact claim.";
    case "sparse-provenance-density":
    case "single-ref-many-sections":
      return "Review major sections and add claim-supporting source refs where evidence is thin.";
    case "repeated-identical-provenance":
      return "Inspect repeated citations; headings are often weak sole evidence for detailed artifacts.";
    case "style-under-cited":
      return "Find multiple representative style examples across source blocks and cite them separately.";
    case "event-heading-only-provenance":
      return "Find setup, action, reveal, and consequence passages with narrative evidence.";
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

/** Non-gating provenance risk signals used in canonical checks. */
export async function collectProvenanceRiskSignals(outputRoot: string, artifacts: ArtifactPacket[] | undefined): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  for (const artifact of artifacts ?? []) {
    const sectionCount = artifact.sections.filter((section) => section.body.trim().length > 0).length;
    const bodyChars = artifact.sections.reduce((sum, section) => sum + section.body.trim().length, 0);
    const refCount = artifact.provenance.length;
    if (sectionCount >= 4 && refCount < 2) diagnostics.push({ code: "single-ref-many-sections", level: "warning", artifactId: artifact.id, message: `${sectionCount} non-empty sections have only ${refCount} provenance ref(s).` });
    if ((sectionCount >= 4 || bodyChars >= 1600) && (refCount / Math.max(1, sectionCount) < 0.5 || bodyChars / Math.max(1, refCount) > 1200)) diagnostics.push({ code: "sparse-provenance-density", level: "warning", artifactId: artifact.id, message: `${sectionCount} sections, ${bodyChars} body chars, ${refCount} provenance ref(s).` });
    if (artifact.group === "style" && bodyChars >= 80 && refCount < 3) diagnostics.push({ code: "style-under-cited", level: "warning", artifactId: artifact.id, message: `Substantive style artifact has ${refCount} provenance ref(s); multiple examples are usually needed.` });
    const isLongSynthesisSurface = classifyNarrativeSurface(artifact).length > 0 && bodyChars >= 2500;
    const sparseSynthesisSignals: string[] = [];
    if (isLongSynthesisSurface && refCount < 3) sparseSynthesisSignals.push(`only ${refCount} resolved ref(s)`);
    if (isLongSynthesisSurface && bodyChars / Math.max(1, refCount) > 1200) sparseSynthesisSignals.push(`${bodyChars} body chars per ${refCount} ref(s)`);
    let headingOnlyRefs = 0;
    for (const [index, ref] of artifact.provenance.entries()) {
      let headingLike = /^\s*[A-Z0-9][^\n]{0,120}\s*$/.test(ref.quote) && ref.quote.trim() === ref.quote.trim().toUpperCase();
      try {
        const unit = await readNormalizedUnit(outputRoot, ref.unitId);
        const block = unit.blocks.find((item) => item.anchor === ref.startAnchor);
        if (block?.kind === "heading") headingLike = true;
      } catch {
        // Keep quote-based diagnostics useful when normalized JSON is unavailable.
      }
      if (headingLike) {
        headingOnlyRefs += 1;
        diagnostics.push({ code: "heading-only-provenance", level: "warning", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: "Citation points to a heading/title-like block; detailed claims usually need narrative evidence." });
      }
    }
    if (isLongSynthesisSurface && refCount > 0 && headingOnlyRefs === refCount) sparseSynthesisSignals.push("all refs are heading/title-like");
    if (sparseSynthesisSignals.length > 0) diagnostics.push({ code: "sparse-synthesis-provenance", level: "warning", artifactId: artifact.id, message: `Long synthesis artifact has sparse provenance: ${sparseSynthesisSignals.join("; ")}.` });
  }
  return diagnostics;
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
    "# Mem-import provenance audit",
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
