import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { extractionStagePath, manifestPath, mergedCandidatesPath, readExtractionStages, readManifest, readMergeStage, readNormalizedUnit, writeJson, writeStagedReviewCheckpoint } from "./staging.js";
import { providerAuthEnvKeys, reviewerProvider } from "../local-env.js";
import { isUsableModel, modelLabel, requireResolvedModel } from "../model-selection.js";
import { classifyNarrativeSurface } from "./narrative-surfaces.js";
import { WORLD_IMPORT_GROUPS, type ArtifactPacket, type EvaluationResult, type LintDiagnostic, type ReviewBundle, type ReviewerDimensionScore, type StageEnvelope, type StagedReviewActionType, type StagedReviewCheckpoint, type StagedReviewFinding, type StagedReviewFindingSeverity, type StagedReviewParseStatus, type StagedReviewRequestedAction, type WorldImportLintResult } from "./types.js";

const groups = [...WORLD_IMPORT_GROUPS];

const MAX_SOURCE_CHARS = 60_000; // total source text budget for the review bundle
const MAX_UNIT_CHARS = 12_000;   // per-unit cap so no single unit dominates
const MAX_MARKDOWN_FILE_CHARS = 8_000;
const MAX_SOURCE_PAGE_COUNT = 6;
const QA_QUESTION_COUNT = 5;     // number of QA questions to generate/answer

export type ReviewerEvalDebugOptions = {
  enabled?: boolean;
  showThinking?: boolean;
  showToolUpdates?: boolean;
};

type ReviewerEvalRunOptions = {
  outputRoot: string;
  reviewerModel?: string;
  cwd?: string;
  debug?: ReviewerEvalDebugOptions;
  onStatus?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolEvent?: (text: string) => void;
};

function reviewerStatus(options: ReviewerEvalRunOptions, text: string): void {
  if (options.debug?.enabled) options.onStatus?.(`[world-import eval] ${text}\n`);
}

function stringifyForLog(value: unknown, maxLength = 4000): string {
  let rendered: string;
  try {
    rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    rendered = String(value);
  }
  return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}…` : rendered;
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" ? event as Record<string, unknown> : {};
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

async function countMarkdownFiles(dir: string): Promise<number> {
  return (await listMarkdownFiles(dir)).length;
}

function hasRequiredFrontmatter(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return false;
  return /(^|\n)type: .+/m.test(match[1]) && /(^|\n)description: .+/m.test(match[1]);
}

function sourceLinkTargets(content: string): string[] {
  return [...content.matchAll(/\(([^)#]*sources\/units\/[^)#]+\.md#b\d{4})\)/g)].map((match) => match[1]);
}

function resolveSourceTargetPath(worldRoot: string, conceptFile: string, linkPath: string): string {
  return linkPath.startsWith("/") ? join(worldRoot, linkPath.replace(/^\//, "")) : join(dirname(conceptFile), linkPath);
}

function referencedUnitIdsFromArtifacts(artifacts: ArtifactPacket[] | undefined): string[] {
  return [...new Set((artifacts ?? []).flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)))].sort((a, b) => a.localeCompare(b));
}

function representedCandidateKeys(artifact: ArtifactPacket): string[] {
  const raw = artifact.metadata?.representedCandidateIds ?? artifact.metadata?.candidateIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function candidateKey(unitId: string | undefined, candidateId: string): string {
  return `${unitId ?? ""}:${candidateId}`;
}

function wikilinkTargets(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

function markdownInternalTargets(content: string): string[] {
  return [...content.matchAll(/\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+\.md(?:#[^)]+)?)\)/gi)].map((match) => match[1]);
}

function checkExists(diagnostics: LintDiagnostic[], code: string, path: string, message: string): void {
  if (!existsSync(path)) diagnostics.push({ code, level: "error", path, message });
}

function isPlaceholderQuote(quote: string | undefined): boolean {
  return [
    /^\s*$/,
    /\[\s*source\s+span\b/i,
    /source\s+span\s+b\d{4}/i,
    /TODO\s+quote/i,
    /^\s*quote\s*$/i,
  ].some((pattern) => pattern.test(quote ?? ""));
}

function hasMarkdownHeadingAnchor(content: string, anchor: string): boolean {
  return new RegExp(`^##\\s+${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(content);
}

async function readMarkdownSnippet(path: string, maxChars = MAX_MARKDOWN_FILE_CHARS): Promise<string> {
  return (await readFile(path, "utf-8")).slice(0, maxChars);
}

function isNarrativeCorpus(mergeArtifacts: ArtifactPacket[] | undefined, bodyUnitCount: number): boolean {
  return bodyUnitCount > 1 && (mergeArtifacts?.length ?? 0) > 0;
}

function collectNarrativeRiskSignals(artifacts: ArtifactPacket[] | undefined, bodyUnitCount: number): LintDiagnostic[] {
  if (!isNarrativeCorpus(artifacts, bodyUnitCount)) return [];
  const items = artifacts ?? [];
  const byKind = new Set(items.flatMap((artifact) => classifyNarrativeSurface(artifact)));
  const diagnostics: LintDiagnostic[] = [];
  if (!byKind.has("synopsis")) diagnostics.push({ code: "missing-plot-synopsis", level: "warning", message: "Narrative import is missing a dedicated plot synopsis/corpus synopsis/world overview artifact." });
  if (!byKind.has("timeline")) diagnostics.push({ code: "missing-timeline", level: "warning", message: "Narrative import is missing a dedicated timeline or reading-order artifact." });
  if (!byKind.has("scene-guide")) diagnostics.push({ code: "missing-scene-guide", level: "warning", message: "Narrative import is missing a dedicated scene/chapter/episode guide artifact." });
  if (!items.some((artifact) => artifact.group === "things")) diagnostics.push({ code: "empty-things-group", level: "warning", message: "Narrative import has no emitted things/object artifacts; check plot-critical object coverage." });
  return diagnostics;
}

function isHeadingLikeQuote(quote: string): boolean {
  const normalized = quote.trim();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).length;
  return words <= 10 && normalized === normalized.toUpperCase();
}

async function collectProvenanceAuditWarnings(outputRoot: string, artifacts: ArtifactPacket[] | undefined): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const items = artifacts ?? [];
  for (const artifact of items) {
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
      let headingLike = isHeadingLikeQuote(ref.quote);
      try {
        const unit = await readNormalizedUnit(outputRoot, ref.unitId);
        const block = unit.blocks.find((item) => item.anchor === ref.startAnchor);
        if (block?.kind === "heading") headingLike = true;
      } catch {
        // fall back to quote heuristic when normalized JSON is unavailable
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

export async function lintWorldImport(outputRoot: string): Promise<WorldImportLintResult> {
  const diagnostics: LintDiagnostic[] = [];
  const worldRoot = join(outputRoot, "world");
  let manifest;
  let merge;
  try { manifest = await readManifest(outputRoot); } catch { manifest = undefined; }
  try { merge = await readMergeStage(outputRoot); } catch { merge = undefined; }

  checkExists(diagnostics, "missing-index", join(worldRoot, "index.md"), "World root index is missing");
  checkExists(diagnostics, "missing-sources-index", join(worldRoot, "sources", "index.md"), "Sources index is missing");
  checkExists(diagnostics, "missing-coverage", join(worldRoot, "coverage.md"), "Coverage view is missing");

  const artifactIds = new Set<string>();
  for (const artifact of merge?.artifacts ?? []) {
    if (artifactIds.has(artifact.id)) diagnostics.push({ code: "duplicate-artifact-id", level: "error", artifactId: artifact.id, message: `Duplicate artifact id ${artifact.id}` });
    artifactIds.add(artifact.id);
    for (const related of artifact.related ?? []) {
      if (!artifactIds.has(related) && !(merge?.artifacts ?? []).some((item) => item.id === related)) {
        diagnostics.push({ code: "unresolved-related", level: "error", artifactId: artifact.id, message: `Artifact ${artifact.id} has unresolved related id ${related}` });
      }
    }
    if (!artifact.description && !artifact.sections.some((section) => /^(summary|capsule)$/i.test(section.heading))) {
      diagnostics.push({ code: "missing-description", level: "warning", artifactId: artifact.id, message: `Artifact ${artifact.id} lacks description or summary/capsule fallback` });
    }
    if (artifact.provenance.length === 0) diagnostics.push({ code: "missing-provenance", level: "error", artifactId: artifact.id, message: `Artifact ${artifact.id} has no provenance` });
    artifact.provenance.forEach((ref, index) => {
      if (isPlaceholderQuote(ref.quote)) diagnostics.push({ code: "missing-provenance-quote", level: "warning", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}].quote`, message: `Artifact ${artifact.id} provenance ref ${index} has an empty or placeholder quote` });
    });
  }

  const conceptFiles: string[] = [];
  for (const group of groups) {
    const groupDir = join(worldRoot, group);
    if (!existsSync(groupDir)) continue;
    const groupFiles = (await readdir(groupDir)).filter((name) => name.endsWith(".md") && name !== "index.md").map((name) => join(groupDir, name));
    conceptFiles.push(...groupFiles);
    if (groupFiles.length > 0) checkExists(diagnostics, "missing-group-index", join(groupDir, "index.md"), `${group} index is missing`);
  }

  const markdownCache = new Map<string, string>();
  const readMarkdownCached = async (file: string): Promise<string> => {
    const cached = markdownCache.get(file);
    if (cached !== undefined) return cached;
    const content = await readFile(file, "utf-8");
    markdownCache.set(file, content);
    return content;
  };

  for (const file of conceptFiles) {
    const content = await readMarkdownCached(file);
    if (!hasRequiredFrontmatter(content)) diagnostics.push({ code: "missing-frontmatter", level: "error", path: file, message: "Concept frontmatter must include type and description" });
    for (const target of wikilinkTargets(content)) {
      if (!artifactIds.has(target)) diagnostics.push({ code: "unresolved-wikilink", level: "error", path: file, message: `Unresolved wikilink [[${target}]]` });
    }
    for (const target of markdownInternalTargets(content)) {
      const [pathPart, anchor] = target.split("#");
      const targetPath = resolveSourceTargetPath(worldRoot, file, pathPart);
      if (!existsSync(targetPath)) diagnostics.push({ code: "unresolved-markdown-link", level: "error", path: file, message: `Missing markdown link target ${target}` });
      else if (anchor) {
        const linked = await readMarkdownCached(targetPath);
        if (!hasMarkdownHeadingAnchor(linked, anchor)) diagnostics.push({ code: "unresolved-anchor", level: "error", path: file, message: `Missing markdown anchor ${target}` });
      }
    }
  }

  const units = manifest?.units ?? [];
  const extractionStages = await readExtractionStages(outputRoot);
  const extractionByUnit = new Map(extractionStages.map((stage) => [stage.unitId, stage]));
  const hasExtractionData = extractionStages.length > 0;
  if (hasExtractionData) {
    for (const unit of units.filter((entry) => (entry.role ?? "body") === "body")) {
      if (!extractionByUnit.has(unit.unitId)) diagnostics.push({ code: "body-unit-missing-extraction", level: "error", unitId: unit.unitId, path: extractionStagePath(outputRoot, unit.unitId), message: `Body source unit ${unit.unitId} has no extraction stage` });
    }
  }

  const allCandidateKeys = new Set<string>();
  const keysByCandidateId = new Map<string, string[]>();
  const addCandidateKey = (key: string, id: string): void => {
    allCandidateKeys.add(key);
    keysByCandidateId.set(id, [...(keysByCandidateId.get(id) ?? []), key]);
  };
  for (const stage of extractionStages) {
    const seen = new Set<string>();
    for (const candidate of stage.candidates ?? []) {
      const key = candidateKey(stage.unitId, candidate.id);
      if (seen.has(candidate.id)) diagnostics.push({ code: "duplicate-candidate-id", level: "error", unitId: stage.unitId, candidateId: candidate.id, message: `Duplicate candidate id ${candidate.id} in ${stage.unitId}` });
      seen.add(candidate.id);
      addCandidateKey(key, candidate.id);
    }
  }
  if (allCandidateKeys.size > 0) {
    const accounted = new Set<string>();
    for (const artifact of merge?.artifacts ?? []) {
      for (const rawKey of representedCandidateKeys(artifact)) {
        const key = rawKey.includes(":") ? rawKey : candidateKey(undefined, rawKey);
        accounted.add(key);
        if (rawKey.includes(":") === false) for (const candidate of keysByCandidateId.get(rawKey) ?? []) accounted.add(candidate);
      }
    }
    for (const disposition of merge?.candidateDispositions ?? []) {
      const key = candidateKey(disposition.unitId, disposition.candidateId);
      accounted.add(key);
      if (!disposition.unitId) for (const candidate of keysByCandidateId.get(disposition.candidateId) ?? []) accounted.add(candidate);
      if ((disposition.disposition === "dropped" || disposition.disposition === "deferred") && !disposition.reason) {
        diagnostics.push({ code: "candidate-disposition-missing-reason", level: "error", unitId: disposition.unitId, candidateId: disposition.candidateId, message: `Candidate ${disposition.candidateId} is ${disposition.disposition} without a model-authored reason` });
      }
    }
    for (const key of allCandidateKeys) {
      if (!accounted.has(key)) {
        const [unitId, candidateId] = key.split(":");
        diagnostics.push({ code: "unaccounted-candidate", level: "error", unitId, candidateId, message: `Extraction candidate ${candidateId} from ${unitId} is not represented, merged, deferred, or dropped` });
      }
    }
  }

  const manifestUnitsById = new Map(units.map((unit) => [unit.unitId, unit]));
  const citedUnits = new Set((merge?.artifacts ?? []).flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)));
  for (const artifact of merge?.artifacts ?? []) {
    for (const [index, ref] of artifact.provenance.entries()) {
      const manifestUnit = manifestUnitsById.get(ref.unitId);
      if (!manifestUnit) diagnostics.push({ code: "unresolved-provenance-unit", level: "error", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: `Provenance unit ${ref.unitId} is not in the manifest` });
      else {
        let sourceId = manifestUnit.sourceId;
        let anchors = new Set(manifestUnit.anchors);
        try {
          const unit = await readNormalizedUnit(outputRoot, ref.unitId);
          sourceId = unit.sourceId;
          anchors = new Set(unit.blocks.map((block) => block.anchor));
        } catch {
          // Some deterministic eval fixtures provide manifest + emitted source pages
          // without normalized JSON. The manifest still carries sourceId/anchor facts.
        }
        if (sourceId !== ref.sourceId) diagnostics.push({ code: "provenance-source-mismatch", level: "error", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: `Ref sourceId ${ref.sourceId} does not match normalized unit sourceId ${sourceId}` });
        if (!anchors.has(ref.startAnchor) || !anchors.has(ref.endAnchor)) diagnostics.push({ code: "unresolved-provenance-anchor", level: "error", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: `Ref anchors ${ref.startAnchor}-${ref.endAnchor} do not resolve in ${ref.unitId}` });
      }
    }
  }
  for (const unit of units.filter((entry) => (entry.role ?? "body") === "body")) {
    if (hasExtractionData && extractionByUnit.has(unit.unitId) && !citedUnits.has(unit.unitId)) {
      diagnostics.push({ code: "body-unit-no-emitted-coverage", level: "error", unitId: unit.unitId, message: `Body source unit ${unit.unitId} has extraction data but no emitted artifact provenance` });
    }
  }

  return { passed: diagnostics.every((item) => item.level !== "error"), diagnostics };
}

export async function deterministicWorldImportChecks(outputRoot: string): Promise<EvaluationResult["deterministic"]> {
  const checks: EvaluationResult["deterministic"]["checks"] = [];
  checks.push({ name: "manifest exists", passed: existsSync(manifestPath(outputRoot)) });
  checks.push({ name: "merge stage exists", passed: existsSync(mergedCandidatesPath(outputRoot)) });

  let manifestUnits = 0;
  let bodyUnitCount = 0;
  try {
    const manifest = await readManifest(outputRoot);
    manifestUnits = manifest.units.length;
    bodyUnitCount = manifest.units.filter((unit) => (unit.role ?? "body") === "body").length;
    checks.push({ name: "manifest has normalized units", passed: manifest.units.length > 0, message: `${manifest.units.length} unit(s)` });
  } catch (error) {
    checks.push({ name: "manifest parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }

  let artifactCount = 0;
  let referencedUnitIds: string[] = [];
  let mergeArtifacts: ArtifactPacket[] | undefined;
  try {
    const merge = await readMergeStage(outputRoot);
    mergeArtifacts = merge.artifacts;
    artifactCount = merge.artifacts?.length ?? 0;
    referencedUnitIds = referencedUnitIdsFromArtifacts(merge.artifacts);
    checks.push({ name: "merge has artifact packets", passed: artifactCount > 0, message: `${artifactCount} artifact(s)` });
  } catch (error) {
    checks.push({ name: "merge parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }

  const worldRoot = join(outputRoot, "world");
  const markdownCount = await countMarkdownFiles(worldRoot);
  checks.push({ name: "world markdown emitted", passed: markdownCount > 0, message: `${markdownCount} markdown file(s)` });

  const conceptFiles: string[] = [];
  for (const group of groups) {
    const groupDir = join(worldRoot, group);
    if (!existsSync(groupDir)) continue;
    const groupFiles = (await readdir(groupDir)).filter((name) => name.endsWith(".md") && name !== "index.md").map((name) => join(groupDir, name));
    conceptFiles.push(...groupFiles);
    if (groupFiles.length > 0) checks.push({ name: `${group} index exists`, passed: existsSync(join(groupDir, "index.md")) });
  }

  checks.push({ name: "root index exists", passed: existsSync(join(worldRoot, "index.md")) });
  checks.push({ name: "sources index exists", passed: existsSync(join(worldRoot, "sources", "index.md")) });
  checks.push({ name: "coverage exists", passed: existsSync(join(worldRoot, "coverage.md")) });
  checks.push({ name: "log exists", passed: existsSync(join(worldRoot, "log.md")) });

  if (conceptFiles.length > 0) {
    const conceptContents = await Promise.all(conceptFiles.map(async (path) => ({ path, content: await readFile(path, "utf-8") })));
    checks.push({
      name: "concept frontmatter includes type and description",
      passed: conceptContents.every(({ content }) => hasRequiredFrontmatter(content)),
      message: `${conceptFiles.length} concept file(s) checked`,
    });

    const targets = conceptContents.flatMap(({ path, content }) => sourceLinkTargets(content).map((target) => ({ conceptPath: path, target })));
    const unresolved: string[] = [];
    for (const { conceptPath, target } of targets) {
      const [pathPart, anchor] = target.split("#");
      const file = resolveSourceTargetPath(worldRoot, conceptPath, pathPart);
      if (!existsSync(file)) {
        unresolved.push(target);
        continue;
      }
      const content = await readFile(file, "utf-8");
      if (!hasMarkdownHeadingAnchor(content, anchor)) unresolved.push(target);
    }
    checks.push({
      name: "provenance source-target resolvability",
      passed: targets.length > 0 && unresolved.length === 0,
      message: targets.length > 0 ? `${targets.length - unresolved.length}/${targets.length} resolved` : "no source links found",
    });
  }

  if (manifestUnits > 0) {
    const emittedReferencedSourcePages = referencedUnitIds.filter((unitId) => existsSync(join(worldRoot, "sources", "units", `${unitId}.md`))).length;
    checks.push({
      name: "retained source pages emitted",
      passed: referencedUnitIds.length === 0 ? existsSync(join(worldRoot, "sources", "units")) : emittedReferencedSourcePages === referencedUnitIds.length,
      message: referencedUnitIds.length === 0 ? `${manifestUnits} manifest unit(s); no artifact citations yet` : `${emittedReferencedSourcePages}/${referencedUnitIds.length} referenced source page(s) emitted`,
    });
  }
  if (artifactCount > 0) checks.push({ name: "concept pages emitted", passed: conceptFiles.length > 0, message: `${conceptFiles.length} concept page(s)` });

  const lint = await lintWorldImport(outputRoot);
  checks.push({
    name: "world wiki lint",
    passed: lint.passed,
    message: lint.diagnostics.length === 0 ? "no diagnostics" : `${lint.diagnostics.filter((item) => item.level === "error").length} error(s), ${lint.diagnostics.filter((item) => item.level === "warning").length} warning(s)`,
    diagnostics: lint.diagnostics,
  });

  const riskSignals = collectNarrativeRiskSignals(mergeArtifacts, bodyUnitCount);
  if (riskSignals.length > 0) {
    checks.push({
      name: "narrative surface risks",
      passed: true,
      message: `${riskSignals.length} warning(s)`,
      diagnostics: riskSignals,
    });
  }

  const provenanceAudit = mergeArtifacts ? {
    diagnostics: await collectProvenanceAuditWarnings(outputRoot, mergeArtifacts),
    warnings: 0,
  } : undefined;
  if (provenanceAudit) {
    provenanceAudit.warnings = provenanceAudit.diagnostics.length;
    if (provenanceAudit.warnings > 0) {
      checks.push({
        name: "provenance audit warnings",
        passed: true,
        message: `${provenanceAudit.warnings} warning(s)`,
        diagnostics: provenanceAudit.diagnostics,
      });
    }
  }

  return { passed: checks.every((check) => check.passed), checks, lint, riskSignals, provenanceAudit };
}

/**
 * Build a rich review bundle that includes:
 * - The source manifest
 * - Normalized source text (budgeted to MAX_SOURCE_CHARS)
 * - The merged artifact packets
 * - The emitted markdown artifacts
 */
function balancedSourceSample(content: string, snippetChars: number): string {
  if (content.length <= snippetChars * 3) return content;
  const middleStart = Math.max(0, Math.floor(content.length / 2) - Math.floor(snippetChars / 2));
  return [
    `[[start]]\n${content.slice(0, snippetChars)}`,
    `[[middle]]\n${content.slice(middleStart, middleStart + snippetChars)}`,
    `[[end]]\n${content.slice(-snippetChars)}`,
  ].join("\n\n");
}

function reviewBundleCandidateAccounting(extractions: Awaited<ReturnType<typeof readExtractionStages>>, merge: StageEnvelope): ReviewBundle["candidateAccounting"] {
  const candidates = extractions.flatMap((stage) => (stage.candidates ?? []).map((candidate) => ({ unitId: stage.unitId, candidate })));
  const represented = new Set<string>();
  for (const artifact of merge.artifacts ?? []) for (const candidateId of representedCandidateKeys(artifact)) represented.add(candidateId);
  const dispositions = merge.candidateDispositions ?? [];
  const dispositionByKey = new Map(dispositions.map((item) => [candidateKey(item.unitId, item.candidateId), item]));
  const counts = { represented: 0, merged: 0, deferred: 0, dropped: 0, unaccounted: 0 };
  for (const { unitId, candidate } of candidates) {
    const disposition = dispositionByKey.get(candidateKey(unitId, candidate.id)) ?? dispositionByKey.get(candidateKey(undefined, candidate.id));
    if (disposition) counts[disposition.disposition] += 1;
    else if (represented.has(candidateKey(unitId, candidate.id)) || represented.has(candidate.id)) counts.represented += 1;
    else counts.unaccounted += 1;
  }
  return {
    extractionCandidateCount: candidates.length,
    counts,
    droppedOrDeferred: dispositions.filter((item): item is typeof item & { disposition: "deferred" | "dropped" } => item.disposition === "deferred" || item.disposition === "dropped").slice(0, 30).map(({ unitId, candidateId, disposition, reason }) => ({ unitId, candidateId, disposition, reason })),
  };
}

export async function buildReviewBundle(outputRoot: string): Promise<ReviewBundle> {
  const manifest = await readManifest(outputRoot);
  const merge = await readMergeStage(outputRoot);
  const extractions = await readExtractionStages(outputRoot);

  // Allocate evidence fairly before optional detail: no late body unit can vanish
  // merely because an early unit consumed the shared budget.
  const bodyEntries = manifest.units.filter((entry) => (entry.role ?? "body") === "body");
  const minimumSnippetChars = 80;
  const preferredSnippetChars = 240;
  const canCoverAllBodies = bodyEntries.length * minimumSnippetChars * 3 <= MAX_SOURCE_CHARS;
  const snippetChars = canCoverAllBodies
    ? Math.min(preferredSnippetChars, Math.floor(MAX_SOURCE_CHARS / Math.max(1, bodyEntries.length * 3)))
    : 0;
  const sources: ReviewBundle["sources"] = [];
  for (const entry of bodyEntries) {
    try {
      const unit = await readNormalizedUnit(outputRoot, entry.unitId);
      const sourcePagePath = `sources/units/${unit.unitId}.md`;
      const content = canCoverAllBodies
        ? balancedSourceSample(unit.content, snippetChars)
        : "[Source text omitted: review bundle coverage is truncated; inspect the retained source page before treating this unit as missing evidence.]";
      sources.push({ unitId: unit.unitId, sourceId: unit.sourceId, title: unit.title, order: unit.order, content, sourcePagePath });
    } catch {
      // Preserve the unit's identity in the bundle even when its normalized file is missing.
      sources.push({ unitId: entry.unitId, sourceId: entry.sourceId, title: entry.title, order: entry.order, content: canCoverAllBodies ? "[Normalized source unit unavailable.]" : "[Normalized source unit unavailable; source-text coverage is truncated.]", sourcePagePath: `sources/units/${entry.unitId}.md` });
    }
  }
  const sourceCoverage = { bodyUnitCount: bodyEntries.length, sampledBodyUnitCount: sources.length, coverageTruncated: !canCoverAllBodies };
  const candidateAccounting = reviewBundleCandidateAccounting(extractions, merge);
  const artifactInventory = (merge.artifacts ?? []).map((artifact) => ({
    id: artifact.id,
    group: artifact.group,
    title: artifact.title,
    sectionCount: artifact.sections.filter((section) => section.body.trim()).length,
    bodyChars: artifact.sections.reduce((total, section) => total + section.body.trim().length, 0),
    provenanceCount: artifact.provenance.length,
    relatedCount: artifact.related?.length ?? 0,
  }));

  // Read markdown artifacts and navigational files
  const worldRoot = join(outputRoot, "world");
  const markdown: Record<string, string> = {};
  if (existsSync(worldRoot)) {
    const addMarkdown = async (relativePath: string): Promise<void> => {
      const file = join(worldRoot, relativePath);
      if (!existsSync(file) || markdown[relativePath]) return;
      markdown[relativePath] = await readMarkdownSnippet(file);
    };

    await addMarkdown("index.md");
    await addMarkdown("coverage.md");
    await addMarkdown("log.md");
    await addMarkdown("sources/index.md");

    for (const group of groups) {
      const groupDir = join(worldRoot, group);
      if (!existsSync(groupDir)) continue;
      for (const file of (await readdir(groupDir)).filter((name) => name.endsWith(".md")).slice(0, 20)) {
        await addMarkdown(`${group}/${file}`);
      }
    }

    for (const unitId of referencedUnitIdsFromArtifacts(merge.artifacts).slice(0, MAX_SOURCE_PAGE_COUNT)) {
      await addMarkdown(`sources/units/${unitId}.md`);
    }
  }

  return { manifest, sources, sourceCoverage, candidateAccounting, artifactInventory, merge, markdown };
}

type ReviewerEval = NonNullable<EvaluationResult["reviewer"]>;

type ParsedReviewerOutput = {
  score?: number;
  dimensionScores?: ReviewerDimensionScore[];
  qaResults?: ReviewerEval["qaResults"];
  parseStatus: NonNullable<ReviewerEval["parseStatus"]>;
  parseErrors: string[];
  authoritativeScore: boolean;
};

const REVIEW_DIMENSIONS = new Set([
  "entityRecall",
  "detailRichness",
  "sourceCoverage",
  "provenance",
  "mergeQuality",
  "answerability",
  "navigability",
  "progressiveDisclosure",
  "plotSynopsisQuality",
  "timelineCompleteness",
  "sourceStructureCoverage",
  "objectPropCoverage",
  "omissionVisibility",
  "citationReconstructability",
  "droppedCandidateRisk",
  "styleToneCoverage",
]);

function extractFinalJsonObject(text: string): string | undefined {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fenced.length > 0) return fenced[fenced.length - 1]?.[1]?.trim();

  let depth = 0;
  let end = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === "}") {
      if (end === -1) end = i;
      depth += 1;
    } else if (char === "{") {
      depth -= 1;
      if (depth === 0 && end !== -1) return text.slice(i, end + 1);
    }
  }
  return undefined;
}

export function parseStructuredReviewerOutput(text: string): ParsedReviewerOutput {
  const jsonText = extractFinalJsonObject(text);
  if (!jsonText) return { parseStatus: "missing", parseErrors: ["No final JSON object found in reviewer output."], authoritativeScore: false };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    return {
      parseStatus: "invalid",
      parseErrors: [`Final JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
      authoritativeScore: false,
    };
  }

  const parseErrors: string[] = [];
  const score = typeof parsed.score === "number" ? parsed.score : undefined;
  if (score === undefined) parseErrors.push("Missing numeric overall score.");
  else if (score < 1 || score > 5) parseErrors.push(`Overall score ${score} is out of range 1-5.`);

  const rawDimensions = Array.isArray(parsed.dimensionScores) ? parsed.dimensionScores : undefined;
  const dimensionScores = rawDimensions?.filter((item): item is ReviewerDimensionScore => (
    item !== null
    && typeof item === "object"
    && typeof (item as ReviewerDimensionScore).dimension === "string"
    && typeof (item as ReviewerDimensionScore).score === "number"
    && typeof (item as ReviewerDimensionScore).justification === "string"
  ));
  if (!rawDimensions) parseErrors.push("Missing dimensionScores array.");
  else {
    const seen = new Set<string>();
    for (const item of dimensionScores ?? []) {
      if (item.score < 1 || item.score > 5) parseErrors.push(`Dimension ${item.dimension} score ${item.score} is out of range 1-5.`);
      if (!REVIEW_DIMENSIONS.has(item.dimension)) parseErrors.push(`Unexpected dimension ${item.dimension}.`);
      seen.add(item.dimension);
    }
    for (const dimension of REVIEW_DIMENSIONS) {
      if (!seen.has(dimension)) parseErrors.push(`Missing dimension ${dimension}.`);
    }
  }

  const qaResults = Array.isArray(parsed.qaResults)
    ? parsed.qaResults.filter((item): item is NonNullable<ReviewerEval["qaResults"]>[number] => (
      item !== null
      && typeof item === "object"
      && typeof item.question === "string"
      && typeof item.answerable === "boolean"
      && typeof item.answer === "string"
      && (item.confidence === "high" || item.confidence === "medium" || item.confidence === "low")
    ))
    : undefined;
  if (!Array.isArray(parsed.qaResults)) parseErrors.push("Missing qaResults array.");
  else if ((qaResults?.length ?? 0) !== parsed.qaResults.length) parseErrors.push("Some qaResults entries were malformed.");

  const parseStatus: ParsedReviewerOutput["parseStatus"] =
    parseErrors.length === 0 ? "valid"
      : (dimensionScores?.length || qaResults?.length || typeof score === "number") ? "partial"
        : "invalid";

  return {
    score,
    dimensionScores,
    qaResults,
    parseStatus,
    parseErrors,
    authoritativeScore: parseStatus === "valid",
  };
}

function parseReconstructionSummary(text: string): string | undefined {
  // Look for a block between ### Reconstruction Summary and the next ### or end
  const match = text.match(/### Reconstruction Summary\n\n([\s\S]*?)(?=\n### |\n## |\n---|$)/);
  return match?.[1]?.trim();
}


/**
 * Build the structured reviewer prompt with:
 * 1. Reconstruction task — use world artifacts to write a narrative summary, compare to source
 * 2. QA task — answer questions about the source using only the artifacts
 * 3. Dimension scoring — per-dimension scores + evidence
 */
export function buildReviewerPrompt(bundle: ReviewBundle): string {
  const sourceOverview = bundle.manifest.units
    .map((u, i) => `${i + 1}. ${u.title || u.unitId} (${u.blockCount} blocks)`)
    .join("\n");

  const sourceSample = bundle.sources
    .map((s) => `=== UNIT: ${s.title || s.unitId} (order ${s.order}; retained page ${s.sourcePagePath ?? `sources/units/${s.unitId}.md`}) ===\n\n${s.content}`)
    .join("\n\n");
  const coverageNotice = bundle.sourceCoverage.coverageTruncated
    ? "WARNING: source-text coverage was truncated by the configured budget. Every body unit is listed, but omitted text is insufficient evidence of a source omission; inspect retained source pages before making that claim."
    : "Every body unit has balanced start/middle/end source excerpts and a retained source-page reference.";
  const candidateAccounting = bundle.candidateAccounting;
  const candidateSummary = `Extracted candidates: ${candidateAccounting.extractionCandidateCount}. ` +
    Object.entries(candidateAccounting.counts).map(([status, count]) => `${status}: ${count}`).join(", ");
  const candidateDetails = candidateAccounting.droppedOrDeferred.length > 0
    ? candidateAccounting.droppedOrDeferred.map((item) => `- ${item.unitId ?? "unknown unit"}/${item.candidateId}: ${item.disposition}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")
    : "(no dropped or deferred candidates)";
  const artifactInventory = bundle.artifactInventory.length > 0
    ? bundle.artifactInventory.map((item) => `- ${item.id} (${item.group}): ${item.title}; sections=${item.sectionCount}; bodyChars=${item.bodyChars}; provenance=${item.provenanceCount}; related=${item.relatedCount}`).join("\n")
    : "(no emitted artifacts)";

  const artifactCount = bundle.merge.artifacts?.length ?? 0;
  const groupCounts = bundle.merge.artifacts?.reduce<Record<string, number>>((acc, a) => {
    acc[a.group] = (acc[a.group] || 0) + 1;
    return acc;
  }, {}) ?? {};
  const groupSummary = Object.entries(groupCounts)
    .map(([g, c]) => `${c} ${g}`)
    .join(", ");

  const markdownEntries = Object.entries(bundle.markdown);
  const markdownBlock = markdownEntries.length > 0
    ? markdownEntries.map(([path, content]) => `--- ${path} ---\n${content}`).join("\n\n")
    : "(no markdown artifacts)";

  // Generate questions from source content for the QA task
  const questions = generateQaQuestions(bundle.sources);

  return `You are a world-import quality reviewer. Assess how well the world artifacts capture the source material.

## Source Overview

The source corpus has ${bundle.manifest.units.length} unit(s) in this order:

${sourceOverview}

## Normalized Source Text (${bundle.sources.length}/${bundle.sourceCoverage.bodyUnitCount} body units shown)

${coverageNotice}

${sourceSample}

## Candidate Accounting

${candidateSummary}

Dropped/deferred candidates (bounded list):
${candidateDetails}

Candidate accounting records dispositions for extracted candidates; it does not prove extraction recall. Review source excerpts for independently visible omissions.

## Artifact Inventory

${artifactInventory}

## Merged Artifact Summary

${artifactCount} artifact(s) total: ${groupSummary}

## World Markdown Artifacts (${markdownEntries.length} files shown)

${markdownBlock}

---

## Review Tasks

### Task 1: Reconstruction

Using ONLY the world artifacts above (not the raw source text), first write an artifact-only reconstruction of the story/world as a reader would understand it from the wiki bundle. Then compare that reconstruction to the raw source text and note what is MISSING, structurally under-covered, or INACCURATE.

### Task 2: Question Answering

Answer these questions about the source material using ONLY the world artifacts:

${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

For each question, state:
- Whether it can be answered from the artifacts (answerable: yes/no/partial)
- The answer if answerable
- Confidence: high / medium / low

### Task 3: Dimension Scoring

Score the world library 1-5 (5 = best) on each dimension:

1. **entityRecall** — Are important characters, places, things, and events represented?
2. **detailRichness** — Do artifacts have meaningful detail (descriptions, traits, narrative context) or are they too brief?
3. **sourceCoverage** — Do artifacts span the key narrative content? Can you reconstruct the story?
4. **provenance** — Are source span references and quotes accurate and useful?
5. **mergeQuality** — Are aliases handled? Is detail preserved rather than over-summarized across sources?
6. **answerability** — Can someone answer substantive questions about the source using only the artifacts?
7. **navigability** — Do indexes, summaries, and links make the bundle easy to browse?
8. **progressiveDisclosure** — Do artifacts balance concise top-level summaries with richer detail below?
9. **plotSynopsisQuality** — Is there a useful start-here synopsis/corpus overview that helps a reader understand the plot without browsing every entity page?
10. **timelineCompleteness** — Does the bundle expose the story's sequence of events in source order well enough to reconstruct major plot beats?
11. **sourceStructureCoverage** — Does the bundle surface the source structure (scene/chapter/episode/act guide) and preserve major units or omission reasons?
12. **objectPropCoverage** — Are plot-critical objects/props/documents captured as durable artifacts when they materially affect the story?
13. **omissionVisibility** — If important narrative surfaces, objects, or set-pieces are missing, is that obvious from the bundle and review data rather than hidden behind structurally clean output?
14. **citationReconstructability** — Can a reader follow emitted provenance links to retained source-unit pages inside the bundle?
15. **droppedCandidateRisk** — Do candidate dispositions and coverage diagnostics make omissions visible, especially major set-pieces that may be missing from the final wiki?
16. **styleToneCoverage** — When useful for the corpus, do style artifacts capture narrative voice, tone, formulae, parody/poem mechanics, and character voices with source evidence?

Score caps / hard rubric:
- If the bundle lacks a usable plot synopsis/corpus synopsis, overall score must be **3 or lower**.
- If the bundle lacks both a timeline and a scene/chapter/episode guide for a multi-unit narrative source, overall score must be **2 or lower**.
- If major plot-critical objects or source-structure omissions are hard to discover from the wiki, omissionVisibility and objectPropCoverage must be **2 or lower**, and the overall score must not exceed **3**.
- Do not award a high overall score merely because frontmatter, links, or provenance structure are clean.

For narrative fiction or drama, specifically note whether the artifacts let a reader walk the story in order, identify major set-pieces, and find plot-critical objects without reading every character page.

Provide evidence from the artifacts and source text for each score.

If the bundle looks like a maintained-world update rather than a one-shot import, also comment on whether existing artifacts appear to be enriched instead of duplicated and whether continuity changes remain visible.

---

Return your results as a JSON object at the very end of your response with this exact structure:

\`\`\`json
{
  "score": <overall 1-5>,
  "dimensionScores": [
    {"dimension": "entityRecall", "score": <1-5>, "justification": "..."},
    {"dimension": "detailRichness", "score": <1-5>, "justification": "..."},
    {"dimension": "sourceCoverage", "score": <1-5>, "justification": "..."},
    {"dimension": "provenance", "score": <1-5>, "justification": "..."},
    {"dimension": "mergeQuality", "score": <1-5>, "justification": "..."},
    {"dimension": "answerability", "score": <1-5>, "justification": "..."},
    {"dimension": "navigability", "score": <1-5>, "justification": "..."},
    {"dimension": "progressiveDisclosure", "score": <1-5>, "justification": "..."},
    {"dimension": "plotSynopsisQuality", "score": <1-5>, "justification": "..."},
    {"dimension": "timelineCompleteness", "score": <1-5>, "justification": "..."},
    {"dimension": "sourceStructureCoverage", "score": <1-5>, "justification": "..."},
    {"dimension": "objectPropCoverage", "score": <1-5>, "justification": "..."},
    {"dimension": "omissionVisibility", "score": <1-5>, "justification": "..."},
    {"dimension": "citationReconstructability", "score": <1-5>, "justification": "..."},
    {"dimension": "droppedCandidateRisk", "score": <1-5>, "justification": "..."},
    {"dimension": "styleToneCoverage", "score": <1-5>, "justification": "..."}
  ],
  "qaResults": [
    {"question": "...", "answerable": true, "answer": "...", "confidence": "high|medium|low"}
  ]
}
\`\`\`
`;
}

/**
 * Generate a diverse set of questions from the source text for QA evaluation.
 * Questions target characters, places, events, and narrative details.
 */
const STAGED_REVIEW_SEVERITIES = new Set(["info", "warning", "repair", "critical"] as const);
const STAGED_REVIEW_ACTION_TYPES = new Set(["add-artifact", "strengthen-artifact", "add-narrative-surface", "record-omission", "strengthen-provenance", "repair-candidate-disposition", "other"] as const);
const STAGED_REVIEW_CATEGORIES = new Set(["narrative-surface", "object-coverage", "omission-visibility", "provenance", "candidate-disposition", "other"] as const);
const STAGED_REVIEW_CONFIDENCES = new Set(["low", "medium", "high"] as const);

type StagedReviewCategory = StagedReviewFinding["category"];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asSetValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}

function asSeverity(value: unknown): StagedReviewFindingSeverity {
  return asSetValue(value, STAGED_REVIEW_SEVERITIES, "warning");
}

function asActionType(value: unknown): StagedReviewActionType {
  return asSetValue(value, STAGED_REVIEW_ACTION_TYPES, "other");
}

function asCategory(value: unknown): StagedReviewCategory {
  return asSetValue(value, STAGED_REVIEW_CATEGORIES, "other");
}

function asConfidence(value: unknown): StagedReviewRequestedAction["confidence"] {
  return typeof value === "string" && STAGED_REVIEW_CONFIDENCES.has(value as NonNullable<StagedReviewRequestedAction["confidence"]>) ? value as NonNullable<StagedReviewRequestedAction["confidence"]> : undefined;
}

function parseSourceRefs(value: unknown): StagedReviewRequestedAction["sourceRefs"] {
  if (!Array.isArray(value)) return undefined;
  const refs = value.filter((item): item is NonNullable<StagedReviewRequestedAction["sourceRefs"]>[number] => (
    item !== null
    && typeof item === "object"
    && typeof item.sourceId === "string"
    && typeof item.unitId === "string"
    && typeof item.startAnchor === "string"
    && typeof item.endAnchor === "string"
    && typeof item.quote === "string"
  ));
  return refs.length > 0 ? refs : undefined;
}

export type ParsedPostMergeReviewOutput = Pick<StagedReviewCheckpoint, "repairRecommended" | "findings" | "requestedActions"> & {
  parseStatus: StagedReviewParseStatus;
  parseErrors: string[];
};

export function parseStructuredPostMergeReviewOutput(text: string): ParsedPostMergeReviewOutput {
  const jsonText = extractFinalJsonObject(text);
  if (!jsonText) return { repairRecommended: false, findings: [], requestedActions: [], parseStatus: "missing", parseErrors: ["No final JSON object found in post-merge review output."] };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    return { repairRecommended: false, findings: [], requestedActions: [], parseStatus: "invalid", parseErrors: [`Final JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const parseErrors: string[] = [];
  const rawActions = Array.isArray(parsed.requestedActions) ? parsed.requestedActions : [];
  if (!Array.isArray(parsed.requestedActions)) parseErrors.push("Missing requestedActions array.");
  const requestedActions: StagedReviewRequestedAction[] = rawActions.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      parseErrors.push(`requestedActions[${index}] is malformed.`);
      return [];
    }
    const record = item as Record<string, unknown>;
    const summary = asString(record.summary);
    if (!summary) {
      parseErrors.push(`requestedActions[${index}].summary is required.`);
      return [];
    }
    return [{
      id: asString(record.id) ?? `action-${index + 1}`,
      type: asActionType(record.type),
      severity: asSeverity(record.severity),
      summary,
      rationale: asString(record.rationale),
      targetArtifactId: asString(record.targetArtifactId),
      targetArtifactPath: asString(record.targetArtifactPath),
      candidateId: asString(record.candidateId),
      unitId: asString(record.unitId),
      sourceRefs: parseSourceRefs(record.sourceRefs),
      confidence: asConfidence(record.confidence),
      rereadSource: typeof record.rereadSource === "boolean" ? record.rereadSource : undefined,
    }];
  });

  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  if (!Array.isArray(parsed.findings)) parseErrors.push("Missing findings array.");
  const findings: StagedReviewFinding[] = rawFindings.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      parseErrors.push(`findings[${index}] is malformed.`);
      return [];
    }
    const record = item as Record<string, unknown>;
    const summary = asString(record.summary);
    if (!summary) {
      parseErrors.push(`findings[${index}].summary is required.`);
      return [];
    }
    return [{
      id: asString(record.id) ?? `finding-${index + 1}`,
      severity: asSeverity(record.severity),
      category: asCategory(record.category),
      summary,
      evidence: asString(record.evidence),
      targetArtifactId: asString(record.targetArtifactId),
      targetArtifactPath: asString(record.targetArtifactPath),
      candidateId: asString(record.candidateId),
      unitId: asString(record.unitId),
      sourceRefs: parseSourceRefs(record.sourceRefs),
      requestedActionIds: Array.isArray(record.requestedActionIds) ? record.requestedActionIds.filter((value): value is string => typeof value === "string") : undefined,
    }];
  });

  const repairRecommended = typeof parsed.repairRecommended === "boolean" ? parsed.repairRecommended : requestedActions.length > 0;
  if (typeof parsed.repairRecommended !== "boolean") parseErrors.push("Missing boolean repairRecommended.");
  const parseStatus: StagedReviewParseStatus = parseErrors.length === 0 ? "valid" : (findings.length > 0 || requestedActions.length > 0 ? "partial" : "invalid");
  return { repairRecommended: parseStatus === "invalid" ? false : repairRecommended, findings, requestedActions, parseStatus, parseErrors };
}

export function buildPostMergeReviewPrompt(bundle: ReviewBundle, options: { checkpointId: string; iteration: number }): string {
  const markdownBlock = Object.entries(bundle.markdown).map(([path, content]) => `--- ${path} ---\n${content}`).join("\n\n") || "(no markdown artifacts)";
  const artifactSummary = (bundle.merge.artifacts ?? []).map((artifact) => `- ${artifact.id} (${artifact.group}): ${artifact.title}; provenance=${artifact.provenance.length}; sections=${artifact.sections.map((section) => section.heading).join(", ")}`).join("\n") || "(no merge artifacts)";
  const dispositions = (bundle.merge.candidateDispositions ?? []).map((item) => `- ${item.unitId ?? "?"}:${item.candidateId} -> ${item.disposition}${item.artifactId ? ` (${item.artifactId})` : ""}${item.reason ? `: ${item.reason}` : ""}`).join("\n") || "(no candidate dispositions)";
  const narrativeSurfaceKinds = new Set((bundle.merge.artifacts ?? []).flatMap((artifact) => classifyNarrativeSurface(artifact)));
  const narrativeSurfaces = ["synopsis", "timeline", "scene-guide"].map((kind) => `${kind}: ${narrativeSurfaceKinds.has(kind as ReturnType<typeof classifyNarrativeSurface>[number]) ? "present" : "missing"}`).join("; ");
  const candidateCounts = Object.entries(bundle.candidateAccounting.counts).map(([status, count]) => `${status}=${count}`).join(", ");
  const provenanceWarnings = bundle.artifactInventory
    .filter((artifact) => artifact.bodyChars >= 1600 && (artifact.provenanceCount === 0 || artifact.bodyChars / artifact.provenanceCount > 1200))
    .map((artifact) => `${artifact.id}: ${artifact.provenanceCount} ref(s) across ${artifact.bodyChars} body chars`)
    .join("\n") || "(no deterministic long-form provenance warnings)";
  const sourceSample = bundle.sources.map((source) => `=== UNIT: ${source.title || source.unitId} (order ${source.order}) ===\n${source.content}`).join("\n\n");

  return `You are a focused world-import intermediate reviewer for checkpoint ${options.checkpointId}, iteration ${options.iteration}.

Review the post-merge/emitted world bundle before final eval. Stay focused on repairable semantic gaps that a bounded repair model can address from the persisted source and merge artifacts. Do not rewrite artifacts yourself.

## Deterministic pre-review inventory

Narrative surfaces: ${narrativeSurfaces}

Candidate accounting: extracted=${bundle.candidateAccounting.extractionCandidateCount}; ${candidateCounts}

Long-form provenance warnings:
${provenanceWarnings}

Treat this inventory as authoritative for whether an artifact exists. A present narrative surface may still need strengthening, but do not claim it is missing. If source text is marked truncated, inspect its retained source page before treating absence in the sample as an omission.

## Source sample

${sourceSample}

## Merge artifacts

${artifactSummary}

## Candidate dispositions

${dispositions}

## Emitted markdown

${markdownBlock}

## Focus rubric

Look only for high-value, actionable gaps:
- missing narrative surfaces such as synopsis, timeline, or scene/chapter/act guide, but only after checking the deterministic inventory above;
- existing narrative surfaces that need strengthening rather than replacement;
- missing plot-critical objects, props, letters, weapons, documents, or durable thing pages;
- important omissions hidden from candidate dispositions or coverage views;
- sparse or weak provenance on synthesis pages whose claims need source grounding.

Use the most precise requested action type: add-narrative-surface only for an actually missing surface, strengthen-artifact for a present but weak surface, record-omission for a documented decision, and strengthen-provenance for evidence gaps.

Recommend repair only when the requested action is grounded, bounded, and likely to improve the current bundle before final eval. If the bundle is good enough or findings are speculative, set repairRecommended to false and leave requestedActions empty.

Return a JSON object at the very end of your response with this exact structure:

\`\`\`json
{
  "repairRecommended": true,
  "findings": [
    {
      "id": "finding-1",
      "severity": "warning|repair|critical|info",
      "category": "narrative-surface|object-coverage|omission-visibility|provenance|candidate-disposition|other",
      "summary": "Missing durable thing artifact for a plot-critical letter.",
      "evidence": "Brief evidence from source/artifacts.",
      "targetArtifactId": "optional-existing-id",
      "targetArtifactPath": "optional/path.md",
      "candidateId": "optional-candidate-id",
      "unitId": "optional-unit-id",
      "sourceRefs": [{"sourceId":"s","unitId":"u","startAnchor":"b0001","endAnchor":"b0002","quote":"short source quote"}],
      "requestedActionIds": ["action-1"]
    }
  ],
  "requestedActions": [
    {
      "id": "action-1",
      "type": "add-artifact|strengthen-artifact|add-narrative-surface|record-omission|strengthen-provenance|repair-candidate-disposition|other",
      "severity": "repair",
      "summary": "Add a things artifact for the letter and cite the source span.",
      "rationale": "Why this is repairable and important.",
      "targetArtifactId": "optional-existing-or-proposed-id",
      "targetArtifactPath": "optional/path.md",
      "candidateId": "optional-candidate-id",
      "unitId": "optional-unit-id",
      "sourceRefs": [{"sourceId":"s","unitId":"u","startAnchor":"b0001","endAnchor":"b0002","quote":"short source quote"}],
      "confidence": "low|medium|high",
      "rereadSource": true
    }
  ]
}
\`\`\`
`;
}

export async function writePostMergeReviewResult(outputRoot: string, checkpoint: Omit<StagedReviewCheckpoint, "version" | "kind" | "createdAt" | "outputRoot"> & { createdAt?: string }): Promise<StagedReviewCheckpoint> {
  const result: StagedReviewCheckpoint = {
    version: 1,
    kind: "post-merge-review",
    createdAt: checkpoint.createdAt ?? new Date().toISOString(),
    outputRoot,
    ...checkpoint,
  };
  await writeStagedReviewCheckpoint(outputRoot, result);
  return result;
}

export function generateQaQuestions(sources: ReviewBundle["sources"]): string[] {
  const allText = sources.map((s) => s.content).join("\n\n");
  const stopwords = new Set([
    "The", "And", "But", "For", "With", "From", "Into", "Over", "Under", "After", "Before", "Then", "When", "Where", "What", "Why", "How", "Act", "Scene", "Chapter", "Book", "Part", "Volume", "Mr", "Mrs", "Miss", "Sir",
  ]);
  const stageDirectionWords = new Set([
    "Enter", "Exit", "Exeunt", "Reenter", "Within", "Aside", "Alarum", "Flourish", "Sennet", "Trumpet", "Drum", "Drums", "Music", "Song", "Songs", "Knocking",
  ]);
  const blockedWords = new Set([...stopwords, ...stageDirectionWords]);
  const wordFreq = new Map<string, number>();
  for (const match of allText.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    const word = match[0];
    if (blockedWords.has(word)) continue;
    wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
  }
  const topNames = [...wordFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([name]) => name);

  const questions: string[] = [];
  if (topNames.length >= 1) questions.push(`Describe ${topNames[0]}. Who are they, what role do they play, and what key events involve them?`);
  if (topNames.length >= 2) questions.push(`How do ${topNames[0]} and ${topNames[1]} relate to each other, and what plot events connect them?`);
  questions.push("Walk through the major plot events in source order. What happens first, what turning points follow, and how does the story progress?");
  questions.push("How is the source structured (for example scenes, chapters, acts, or episodes), and what major events happen in those units?");
  questions.push("What important objects, props, letters, weapons, documents, or other things materially affect the plot, and why do they matter?");
  return [...new Set(questions)].slice(0, QA_QUESTION_COUNT);
}

export async function runPostMergeReviewEvaluation(options: ReviewerEvalRunOptions & { checkpointId?: string; iteration?: number }): Promise<StagedReviewCheckpoint> {
  const checkpointId = options.checkpointId ?? "post-merge";
  const iteration = options.iteration ?? 1;
  reviewerStatus(options, `post-merge checkpoint=${checkpointId}; iteration=${iteration}; output=${resolve(options.outputRoot)}`);
  if (!options.reviewerModel) {
    return writePostMergeReviewResult(options.outputRoot, {
      checkpointId,
      iteration,
      status: "skipped",
      repairRecommended: false,
      findings: [],
      requestedActions: [],
      reviewer: { skipped: true, reason: "no reviewer model configured" },
    });
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const agentDir = getAgentDir();
  const authPath = resolve(agentDir, "auth.json");
  const modelsPath = resolve(agentDir, "models.json");
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const bundle = await buildReviewBundle(options.outputRoot);
  reviewerStatus(options, `post-merge bundle=${bundle.sources.length} source unit(s), ${bundle.merge.artifacts?.length ?? 0} artifact(s), ${Object.keys(bundle.markdown).length} markdown file(s)`);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    systemPrompt: "You are a focused world-import intermediate reviewer. Return structured JSON repair findings only; do not rewrite semantic artifacts.",
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "builtin",
    thinkingLevel: "off",
  });
  let notes = "";
  let thinkingStarted = false;
  try {
    await session.setModel(requireResolvedModel(options.reviewerModel, session.modelRegistry));
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        const messageEvent = event.assistantMessageEvent;
        if (messageEvent.type === "text_delta") notes += messageEvent.delta;
        else if (messageEvent.type === "thinking_delta" && options.debug?.showThinking) {
          if (!thinkingStarted) {
            thinkingStarted = true;
            options.onThinking?.("\n[world-import post-merge review thinking]\n");
          }
          options.onThinking?.(messageEvent.delta);
        }
      }
      if (options.debug?.enabled && event.type === "tool_execution_start") options.onToolEvent?.(`\n[world-import post-merge review tool/start] ${event.toolName} ${stringifyForLog(event.args)}\n`);
      if (options.debug?.enabled && options.debug?.showToolUpdates && event.type === "tool_execution_update") options.onToolEvent?.(`\n[world-import post-merge review tool/update] ${stringifyForLog(eventRecord(event))}\n`);
      if (options.debug?.enabled && event.type === "tool_execution_end") {
        const record = eventRecord(event);
        options.onToolEvent?.(`\n[world-import post-merge review tool/end] ${event.toolName} ${event.isError ? "error" : "ok"} ${stringifyForLog(record.details ?? record.result ?? record, 8000)}\n`);
      }
    });
    try {
      await session.prompt(buildPostMergeReviewPrompt(bundle, { checkpointId, iteration }));
    } finally {
      unsubscribe();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return writePostMergeReviewResult(options.outputRoot, {
      checkpointId,
      iteration,
      status: "skipped",
      repairRecommended: false,
      findings: [],
      requestedActions: [],
      reviewer: { model: options.reviewerModel, skipped: true, reason },
    });
  } finally {
    session.dispose();
  }

  const parsed = parseStructuredPostMergeReviewOutput(notes);
  const status = parsed.repairRecommended && parsed.requestedActions.length > 0 ? "repair-requested" : "no-action";
  return writePostMergeReviewResult(options.outputRoot, {
    checkpointId,
    iteration,
    status,
    repairRecommended: parsed.repairRecommended,
    findings: parsed.findings,
    requestedActions: parsed.requestedActions,
    reviewer: {
      model: options.reviewerModel,
      parseStatus: parsed.parseStatus,
      parseErrors: parsed.parseErrors.length > 0 ? parsed.parseErrors : undefined,
      notes: notes.trim(),
    },
  });
}

export async function runReviewerModelEvaluation(options: ReviewerEvalRunOptions): Promise<EvaluationResult> {
  reviewerStatus(options, `output=${resolve(options.outputRoot)}`);
  reviewerStatus(options, `reviewerModel=${options.reviewerModel ?? "none"}`);
  const deterministic = await deterministicWorldImportChecks(options.outputRoot);
  reviewerStatus(options, `deterministic=${deterministic.passed ? "passed" : "failed"}`);
  if (!options.reviewerModel) return writeEvaluationResult(options.outputRoot, { skipped: true, reason: "no reviewer model configured" });
  if (!deterministic.passed) return writeEvaluationResult(options.outputRoot, { model: options.reviewerModel, skipped: true, reason: "deterministic checks failed" });

  const cwd = resolve(options.cwd ?? process.cwd());
  const agentDir = getAgentDir();
  const authPath = resolve(agentDir, "auth.json");
  const modelsPath = resolve(agentDir, "models.json");
  reviewerStatus(options, `cwd=${cwd}`);
  reviewerStatus(options, `agentDir=${agentDir}`);
  reviewerStatus(options, `authPath=${authPath} (${existsSync(authPath) ? "exists" : "missing"})`);
  reviewerStatus(options, `modelsPath=${modelsPath} (${existsSync(modelsPath) ? "exists" : "missing"})`);
  const provider = reviewerProvider(options.reviewerModel);
  const envKeys = providerAuthEnvKeys(provider);
  if (provider) reviewerStatus(options, `provider=${provider}`);
  if (envKeys.length > 0) reviewerStatus(options, `providerAuthEnv=${envKeys.map((key) => `${key}=${process.env[key] ? "set" : "missing"}`).join(", ")}`);

  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });

  // Build the rich review bundle BEFORE creating the session (I/O first)
  const bundle = await buildReviewBundle(options.outputRoot);
  reviewerStatus(options, `bundle=${bundle.sources.length} source unit(s), ${bundle.merge.artifacts?.length ?? 0} artifact(s), ${Object.keys(bundle.markdown).length} markdown file(s)`);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    systemPrompt: "You are a world-import reviewer. Score semantic output quality against source/provenance evidence. Return structured JSON with dimension scores, QA results, and a reconstruction summary.",
  });
  await resourceLoader.reload();
  reviewerStatus(options, "resource loader ready; creating reviewer session");
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "builtin",
    thinkingLevel: "off",
  });
  let notes = "";
  let thinkingStarted = false;
  try {
    reviewerStatus(options, `session created; initial model=${isUsableModel(session.model) ? modelLabel(session.model) : "none"}; thinking=${session.thinkingLevel}`);
    reviewerStatus(options, `resolving requested reviewer model=${options.reviewerModel}`);
    await session.setModel(requireResolvedModel(options.reviewerModel, session.modelRegistry));
    if (isUsableModel(session.model)) reviewerStatus(options, `active reviewer model=${modelLabel(session.model)}; thinking=${session.thinkingLevel}`);
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        const messageEvent = event.assistantMessageEvent;
        if (messageEvent.type === "text_delta") notes += messageEvent.delta;
        else if (messageEvent.type === "thinking_delta" && options.debug?.showThinking) {
          if (!thinkingStarted) {
            thinkingStarted = true;
            options.onThinking?.("\n[world-import eval thinking]\n");
          }
          options.onThinking?.(messageEvent.delta);
        }
      }
      if (options.debug?.enabled && event.type === "tool_execution_start") {
        options.onToolEvent?.(`\n[world-import eval tool/start] ${event.toolName} ${stringifyForLog(event.args)}\n`);
      }
      if (options.debug?.enabled && options.debug?.showToolUpdates && event.type === "tool_execution_update") {
        options.onToolEvent?.(`\n[world-import eval tool/update] ${stringifyForLog(eventRecord(event))}\n`);
      }
      if (options.debug?.enabled && event.type === "tool_execution_end") {
        const record = eventRecord(event);
        options.onToolEvent?.(`\n[world-import eval tool/end] ${event.toolName} ${event.isError ? "error" : "ok"} ${stringifyForLog(record.details ?? record.result ?? record, 8000)}\n`);
      }
    });
    try {
      reviewerStatus(options, "invoking reviewer model");
      await session.prompt(buildReviewerPrompt(bundle));
      reviewerStatus(options, `reviewer model completed; responseChars=${notes.length}`);
    } finally {
      unsubscribe();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    reviewerStatus(options, `reviewer skipped: ${reason}`);
    return writeEvaluationResult(options.outputRoot, { model: options.reviewerModel, skipped: true, reason });
  } finally {
    reviewerStatus(options, "disposing reviewer session");
    session.dispose();
  }

  // Parse structured results from reviewer output
  const parsed = parseStructuredReviewerOutput(notes);
  const reconstructionSummary = parseReconstructionSummary(notes);
  reviewerStatus(options, `parsed review result: status=${parsed.parseStatus}, score=${parsed.score ?? "none"}, dimensions=${parsed.dimensionScores?.length ?? 0}, qaResults=${parsed.qaResults?.length ?? 0}`);

  return writeEvaluationResult(options.outputRoot, {
    model: options.reviewerModel,
    score: parsed.score,
    dimensionScores: parsed.dimensionScores,
    qaResults: parsed.qaResults,
    reconstructionSummary,
    parseStatus: parsed.parseStatus,
    parseErrors: parsed.parseErrors.length > 0 ? parsed.parseErrors : undefined,
    authoritativeScore: parsed.authoritativeScore,
    notes: notes.trim(),
  });
}

export async function writeEvaluationResult(outputRoot: string, reviewer?: EvaluationResult["reviewer"]): Promise<EvaluationResult> {
  const result: EvaluationResult = {
    version: 1,
    createdAt: new Date().toISOString(),
    outputRoot,
    deterministic: await deterministicWorldImportChecks(outputRoot),
    reviewer,
  };
  await writeJson(join(outputRoot, "stages", "review.json"), result);
  return result;
}
