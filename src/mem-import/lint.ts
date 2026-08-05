import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { extractionStagePath, readExtractionStages, readManifest, readMergeStage, readNormalizedUnit } from "./stage-store.js";
import { MEM_IMPORT_GROUPS, type ArtifactPacket, type LintDiagnostic, type MemImportLintResult } from "./contracts.js";
import { authoredMarkdownLinks, authoredMarkdownMarkers } from "./markdown-markers.js";
import { readProjectionOwnership } from "./projection-ownership.js";

const groups = [...MEM_IMPORT_GROUPS];

function checkExists(diagnostics: LintDiagnostic[], code: string, path: string, message: string): void {
  if (!existsSync(path)) diagnostics.push({ code, level: "error", path, message });
}

function hasRequiredFrontmatter(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return false;
  return /(^|\n)type: .+/m.test(match[1]) && /(^|\n)description: .+/m.test(match[1]);
}

function wikilinkTargets(content: string): string[] {
  return authoredMarkdownMarkers(content).map((token) => token.targetId).filter(Boolean);
}

function markdownInternalTargets(content: string): string[] {
  return authoredMarkdownLinks(content)
    .map((token) => token.destination)
    .filter((destination) => Boolean(destination) && !destination.startsWith("#") && !destination.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) && /\.md(?:#.*)?$/i.test(destination));
}

export function resolveMarkdownTargetPath(projectionRoot: string, conceptFile: string, linkPath: string): string {
  return linkPath.startsWith("/") ? resolve(projectionRoot, linkPath.replace(/^\//, "")) : resolve(dirname(conceptFile), linkPath);
}

function isWithinProjectionRoot(projectionRoot: string, targetPath: string): boolean {
  const root = resolve(projectionRoot);
  const relativePath = relative(root, resolve(targetPath));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

async function isCanonicalTargetWithinProjectionRoot(projectionRoot: string, targetPath: string): Promise<boolean> {
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(projectionRoot), realpath(targetPath)]);
  return isWithinProjectionRoot(canonicalRoot, canonicalTarget);
}

function representedCandidateKeys(artifact: ArtifactPacket): string[] {
  const raw = artifact.metadata?.representedCandidateIds ?? artifact.metadata?.candidateIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function candidateKey(unitId: string | undefined, candidateId: string): string {
  return `${unitId ?? ""}:${candidateId}`;
}

/**
 * Validate the deterministic mem-import projection. The projection is rooted at
 * outputRoot; no semantic inference is performed for plain-text mentions.
 */
export async function lintMemImport(outputRoot: string): Promise<MemImportLintResult> {
  const diagnostics: LintDiagnostic[] = [];
  const projectionRoot = outputRoot;
  let manifest;
  let merge;
  try { manifest = await readManifest(outputRoot); } catch { manifest = undefined; }
  try { merge = await readMergeStage(outputRoot); } catch { merge = undefined; }

  checkExists(diagnostics, "missing-index", join(projectionRoot, "index.md"), "Mem-import root index is missing");
  checkExists(diagnostics, "missing-sources-index", join(projectionRoot, "sources", "index.md"), "Sources index is missing");
  checkExists(diagnostics, "missing-coverage", join(projectionRoot, "coverage.md"), "Coverage view is missing");

  const artifacts = merge?.artifacts ?? [];
  const artifactIds = new Set<string>();
  for (const artifact of artifacts) {
    if (artifactIds.has(artifact.id)) diagnostics.push({ code: "duplicate-artifact-id", level: "error", artifactId: artifact.id, message: `Duplicate artifact id ${artifact.id}` });
    artifactIds.add(artifact.id);
  }
  for (const artifact of artifacts) {
    for (const related of artifact.related ?? []) {
      if (!artifactIds.has(related)) diagnostics.push({ code: "unresolved-related", level: "error", artifactId: artifact.id, message: `Artifact ${artifact.id} has unresolved related id ${related}` });
    }
    if (!artifact.description && !artifact.sections.some((section) => /^(summary|capsule)$/i.test(section.heading))) diagnostics.push({ code: "missing-description", level: "warning", artifactId: artifact.id, message: `Artifact ${artifact.id} lacks description or summary/capsule fallback` });
    if (artifact.provenance.length === 0) diagnostics.push({ code: "missing-provenance", level: "error", artifactId: artifact.id, message: `Artifact ${artifact.id} has no provenance` });
    for (const [index, ref] of artifact.provenance.entries()) {
      if (/^\s*$|\[\s*source\s+span\b|source\s+span\s+b\d{4}|TODO\s+quote|^\s*quote\s*$/i.test(ref.quote)) diagnostics.push({ code: "missing-provenance-quote", level: "warning", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}].quote`, message: `Artifact ${artifact.id} provenance ref ${index} has an empty or placeholder quote` });
    }
  }

  let ownership: Awaited<ReturnType<typeof readProjectionOwnership>> | undefined = undefined;
  try {
    ownership = await readProjectionOwnership(projectionRoot);
  } catch (error) {
    diagnostics.push({ code: "invalid-projection-ownership", level: "error", path: join(projectionRoot, ".mem-import-generated.json"), message: error instanceof Error ? error.message : String(error) });
  }
  const ownedFiles = new Set(ownership?.files ?? []);
  if (ownership) {
    for (const relativePath of ownership.files) {
      const ownedPath = resolve(projectionRoot, relativePath);
      try {
        const info = await lstat(ownedPath);
        if (info.isSymbolicLink() || !info.isFile()) diagnostics.push({ code: "invalid-projection-ownership", level: "error", path: ownedPath, message: `Owned projection path is not a regular file: ${relativePath}` });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push({ code: "invalid-projection-ownership", level: "error", path: ownedPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const conceptFiles: string[] = [];
  for (const group of groups) {
    const groupDir = join(projectionRoot, group);
    if (!existsSync(groupDir)) continue;
    const groupFiles = (await readdir(groupDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md" && ownedFiles.has(`${group}/${entry.name}`))
      .map((entry) => join(groupDir, entry.name));
    conceptFiles.push(...groupFiles);
    if (groupFiles.length > 0) checkExists(diagnostics, "missing-group-index", join(groupDir, "index.md"), `${group} index is missing`);
  }

  // Link integrity applies to every owned generated Markdown page, including
  // root/group/source/coverage indexes. Concept frontmatter remains scoped to
  // concept pages only because indexes and source pages have different schemas.
  const generatedFiles = [...ownedFiles]
    .filter((relativePath) => relativePath.endsWith(".md"))
    .map((relativePath) => join(projectionRoot, relativePath));
  const conceptFileSet = new Set(conceptFiles);
  const markdownCache = new Map<string, string>();
  const readMarkdownCached = async (file: string): Promise<string> => {
    const cached = markdownCache.get(file);
    if (cached !== undefined) return cached;
    const content = await readFile(file, "utf-8");
    markdownCache.set(file, content);
    return content;
  };
  for (const file of generatedFiles) {
    let content: string;
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile()) continue;
      content = await readMarkdownCached(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (conceptFileSet.has(file)) {
      if (!hasRequiredFrontmatter(content)) diagnostics.push({ code: "missing-frontmatter", level: "error", path: file, message: "Concept frontmatter must include type and description" });
      for (const target of wikilinkTargets(content)) {
        if (!artifactIds.has(target)) diagnostics.push({ code: "unresolved-wikilink", level: "error", path: file, message: `Unresolved wikilink [[${target}]]` });
      }
    }
    for (const target of markdownInternalTargets(content)) {
      const [pathPart, anchor] = target.split("#");
      const targetPath = resolveMarkdownTargetPath(projectionRoot, file, pathPart);
      if (!isWithinProjectionRoot(projectionRoot, targetPath)) {
        diagnostics.push({ code: "markdown-link-outside-root", level: "error", path: file, message: `Markdown link target escapes the projection root: ${target}` });
        continue;
      }
      if (!existsSync(targetPath)) diagnostics.push({ code: "unresolved-markdown-link", level: "error", path: file, message: `Missing markdown link target ${target}` });
      else {
        let canonicalWithinRoot = false;
        try {
          canonicalWithinRoot = await isCanonicalTargetWithinProjectionRoot(projectionRoot, targetPath);
        } catch (error) {
          diagnostics.push({ code: "markdown-link-outside-root", level: "error", path: file, message: error instanceof Error ? error.message : String(error) });
          continue;
        }
        if (!canonicalWithinRoot) {
          diagnostics.push({ code: "markdown-link-outside-root", level: "error", path: file, message: `Markdown link target resolves outside the projection root: ${target}` });
          continue;
        }
        if (anchor) {
          const linked = await readMarkdownCached(targetPath);
          const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (!new RegExp(`^##\\s+${escaped}\\s*$`, "m").test(linked)) diagnostics.push({ code: "unresolved-anchor", level: "error", path: file, message: `Missing markdown anchor ${target}` });
        }
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
  for (const stage of extractionStages) {
    const seen = new Set<string>();
    for (const candidate of stage.candidates ?? []) {
      const key = candidateKey(stage.unitId, candidate.id);
      if (seen.has(candidate.id)) diagnostics.push({ code: "duplicate-candidate-id", level: "error", unitId: stage.unitId, candidateId: candidate.id, message: `Duplicate candidate id ${candidate.id} in ${stage.unitId}` });
      seen.add(candidate.id);
      allCandidateKeys.add(key);
      keysByCandidateId.set(candidate.id, [...(keysByCandidateId.get(candidate.id) ?? []), key]);
    }
  }
  if (allCandidateKeys.size > 0) {
    const accounted = new Set<string>();
    for (const artifact of artifacts) for (const rawKey of representedCandidateKeys(artifact)) {
      accounted.add(rawKey.includes(":") ? rawKey : candidateKey(undefined, rawKey));
      if (!rawKey.includes(":")) for (const candidate of keysByCandidateId.get(rawKey) ?? []) accounted.add(candidate);
    }
    for (const disposition of merge?.candidateDispositions ?? []) {
      const key = candidateKey(disposition.unitId, disposition.candidateId);
      accounted.add(key);
      if (!disposition.unitId) for (const candidate of keysByCandidateId.get(disposition.candidateId) ?? []) accounted.add(candidate);
      if ((disposition.disposition === "dropped" || disposition.disposition === "deferred") && !disposition.reason) diagnostics.push({ code: "candidate-disposition-missing-reason", level: "error", unitId: disposition.unitId, candidateId: disposition.candidateId, message: `Candidate ${disposition.candidateId} is ${disposition.disposition} without a model-authored reason` });
    }
    for (const key of allCandidateKeys) if (!accounted.has(key)) {
      const [unitId, candidateId] = key.split(":");
      diagnostics.push({ code: "unaccounted-candidate", level: "error", unitId, candidateId, message: `Extraction candidate ${candidateId} from ${unitId} is not represented, merged, deferred, or dropped` });
    }
  }

  const manifestUnitsById = new Map(units.map((unit) => [unit.unitId, unit]));
  const citedUnits = new Set(artifacts.flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)));
  for (const artifact of artifacts) for (const [index, ref] of artifact.provenance.entries()) {
    const manifestUnit = manifestUnitsById.get(ref.unitId);
    if (!manifestUnit) {
      diagnostics.push({ code: "unresolved-provenance-unit", level: "error", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: `Provenance unit ${ref.unitId} is not in the manifest` });
      continue;
    }
    let sourceId = manifestUnit.sourceId;
    let anchors = new Set(manifestUnit.anchors);
    try {
      const unit = await readNormalizedUnit(outputRoot, ref.unitId);
      sourceId = unit.sourceId;
      anchors = new Set(unit.blocks.map((block) => block.anchor));
    } catch {
      // Manifest facts are sufficient for deterministic projection fixtures.
    }
    if (sourceId !== ref.sourceId) diagnostics.push({ code: "provenance-source-mismatch", level: "error", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: `Ref sourceId ${ref.sourceId} does not match normalized unit sourceId ${sourceId}` });
    if (!anchors.has(ref.startAnchor) || !anchors.has(ref.endAnchor)) diagnostics.push({ code: "unresolved-provenance-anchor", level: "error", artifactId: artifact.id, unitId: ref.unitId, path: `artifacts.${artifact.id}.provenance[${index}]`, message: `Ref anchors ${ref.startAnchor}-${ref.endAnchor} do not resolve in ${ref.unitId}` });
  }
  for (const unit of units.filter((entry) => (entry.role ?? "body") === "body")) if (hasExtractionData && extractionByUnit.has(unit.unitId) && !citedUnits.has(unit.unitId)) diagnostics.push({ code: "body-unit-no-emitted-coverage", level: "error", unitId: unit.unitId, message: `Body source unit ${unit.unitId} has extraction data but no emitted artifact provenance` });

  return { passed: diagnostics.every((item) => item.level !== "error"), diagnostics };
}

export { hasRequiredFrontmatter, markdownInternalTargets, wikilinkTargets };
