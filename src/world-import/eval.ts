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
import { extractionStagePath, manifestPath, mergedCandidatesPath, readExtractionStages, readManifest, readMergeStage, readNormalizedUnit, writeJson } from "./staging.js";
import { providerAuthEnvKeys, reviewerProvider } from "../local-env.js";
import { isUsableModel, modelLabel, requireResolvedModel } from "../model-selection.js";
import { WORLD_IMPORT_GROUPS, type ArtifactPacket, type EvaluationResult, type LintDiagnostic, type ReviewBundle, type ReviewerDimensionScore, type WorldImportLintResult } from "./types.js";

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
  try {
    const manifest = await readManifest(outputRoot);
    manifestUnits = manifest.units.length;
    checks.push({ name: "manifest has normalized units", passed: manifest.units.length > 0, message: `${manifest.units.length} unit(s)` });
  } catch (error) {
    checks.push({ name: "manifest parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }

  let artifactCount = 0;
  let referencedUnitIds: string[] = [];
  try {
    const merge = await readMergeStage(outputRoot);
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

  return { passed: checks.every((check) => check.passed), checks, lint };
}

/**
 * Build a rich review bundle that includes:
 * - The source manifest
 * - Normalized source text (budgeted to MAX_SOURCE_CHARS)
 * - The merged artifact packets
 * - The emitted markdown artifacts
 */
export async function buildReviewBundle(outputRoot: string): Promise<ReviewBundle> {
  const manifest = await readManifest(outputRoot);
  const merge = await readMergeStage(outputRoot);

  // Read normalized source units, respecting character budgets
  const sources: ReviewBundle["sources"] = [];
  let totalChars = 0;
  for (const entry of manifest.units) {
    if (totalChars >= MAX_SOURCE_CHARS) break;
    try {
      const unit = await readNormalizedUnit(outputRoot, entry.unitId);
      const content = unit.content.slice(0, Math.min(MAX_UNIT_CHARS, MAX_SOURCE_CHARS - totalChars));
      sources.push({ unitId: unit.unitId, sourceId: unit.sourceId, title: unit.title, order: unit.order, content });
      totalChars += content.length;
    } catch {
      // skip if a unit file is missing — still proceed with what we have
    }
  }

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

  return { manifest, sources, merge, markdown };
}

function parseDimensionScores(text: string): ReviewerDimensionScore[] | undefined {
  // Look for the structured JSON output block
  const jsonStart = text.lastIndexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) return undefined;
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { dimensionScores?: ReviewerDimensionScore[] };
    if (Array.isArray(parsed.dimensionScores) && parsed.dimensionScores.length > 0) {
      return parsed.dimensionScores.filter(
        (d) => typeof d.dimension === "string" && typeof d.score === "number" && typeof d.justification === "string"
      );
    }
  } catch {
    // Structured parsing is optional; fall through to regex extraction
  }
  return undefined;
}

type ReviewerEval = NonNullable<EvaluationResult["reviewer"]>;

function parseQAResults(text: string): ReviewerEval["qaResults"] | undefined {
  const jsonStart = text.lastIndexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) return undefined;
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { qaResults?: ReviewerEval["qaResults"] };
    if (Array.isArray(parsed.qaResults) && parsed.qaResults.length > 0) return parsed.qaResults;
  } catch {
    // optional
  }
  return undefined;
}

function parseReconstructionSummary(text: string): string | undefined {
  // Look for a block between ### Reconstruction Summary and the next ### or end
  const match = text.match(/### Reconstruction Summary\n\n([\s\S]*?)(?=\n### |\n## |\n---|$)/);
  return match?.[1]?.trim();
}

function parseReviewerScore(text: string): number | undefined {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { score?: unknown };
      if (typeof parsed.score === "number") return parsed.score;
    } catch {
      // Reviewer prose is still useful; score is optional.
    }
  }
  const match = text.match(/score\D+(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
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
    .map((s) => `=== UNIT: ${s.title || s.unitId} (order ${s.order}) ===\n\n${s.content}`)
    .join("\n\n");

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

## Normalized Source Text (${bundle.sources.length} units shown)

${sourceSample}

## Merged Artifact Summary

${artifactCount} artifact(s) total: ${groupSummary}

## World Markdown Artifacts (${markdownEntries.length} files shown)

${markdownBlock}

---

## Review Tasks

### Task 1: Reconstruction

Using ONLY the world artifacts above (not the raw source text), write a narrative summary of the source material. Describe the characters, places, events, and plot as they appear in the artifacts. After your reconstruction summary, note what is MISSING or INACCURATE compared to the actual source text above.

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
9. **duplicateNarrativeControl** — Do entity/place artifacts summarize linked events instead of repeating full event narratives unnecessarily?
10. **citationReconstructability** — Can a reader follow emitted provenance links to retained source-unit pages inside the bundle?
11. **droppedCandidateRisk** — Do candidate dispositions and coverage diagnostics make omissions visible, especially major set-pieces that may be missing from the final wiki?
12. **styleToneCoverage** — When useful for the corpus, do style artifacts capture narrative voice, tone, formulae, parody/poem mechanics, and character voices with source evidence?

For Alice-like fiction, specifically note whether the artifacts support reconstructing major set-pieces such as the Caucus-Race, White Rabbit's house, Caterpillar conversation, Mad Tea-Party, croquet game, Mock Turtle story, Lobster Quadrille, trial, and dream frame.

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
    {"dimension": "duplicateNarrativeControl", "score": <1-5>, "justification": "..."},
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
function generateQaQuestions(sources: ReviewBundle["sources"]): string[] {
  const allText = sources.map((s) => s.content).join("\n\n");
  const words = allText.split(/\s+/).filter(Boolean);

  // Extract candidate person-like names (capitalized words that appear multiple times, not at sentence start)
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    const cleaned = word.replace(/[^a-zA-Z]/g, "");
    if (cleaned.length >= 2 && cleaned[0] === cleaned[0].toUpperCase() && cleaned[1] === cleaned[1].toLowerCase()) {
      wordFreq.set(cleaned, (wordFreq.get(cleaned) || 0) + 1);
    }
  }
  const topNames = [...wordFreq.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  // Build a diverse set of questions
  const questions: string[] = [];

  if (topNames.length >= 1) {
    questions.push(`Describe ${topNames[0]}. Who are they, what are their characteristics, what role do they play, and what key events are they involved in?`);
  }
  if (topNames.length >= 2) {
    questions.push(`What is the relationship between ${topNames[0]} and ${topNames[1]}? What events connect them?`);
  }

  questions.push("What is the setting or locations where the narrative takes place? Describe each location's significance.");
  questions.push("What are the key events or plot points that drive the narrative forward? List them in sequence.");
  questions.push("What important objects, items, or things appear in the narrative and what is their significance?");

  // Trim to QA_QUESTION_COUNT
  return questions.slice(0, QA_QUESTION_COUNT);
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
  const dimensionScores = parseDimensionScores(notes);
  const qaResults = parseQAResults(notes);
  const reconstructionSummary = parseReconstructionSummary(notes);
  const score = parseReviewerScore(notes);
  reviewerStatus(options, `parsed review result: score=${score ?? "none"}, dimensions=${dimensionScores?.length ?? 0}, qaResults=${qaResults?.length ?? 0}`);

  return writeEvaluationResult(options.outputRoot, {
    model: options.reviewerModel,
    score,
    dimensionScores,
    qaResults,
    reconstructionSummary,
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
