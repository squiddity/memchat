import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { classifyNarrativeSurface } from "./narrative-surfaces.js";
import { lintMemImport, resolveMarkdownTargetPath } from "./lint.js";
import { collectProvenanceRiskSignals, provenanceAudit } from "./provenance-audit.js";
import { manifestPath, mergedCandidatesPath, readManifest, readMergeStage } from "./stage-store.js";
import { MEM_IMPORT_GROUPS, type ArtifactPacket, type LintDiagnostic, type MemImportLintResult } from "./contracts.js";
import { readProjectionOwnership } from "./projection-ownership.js";

const groups = [...MEM_IMPORT_GROUPS];

export type MemImportChecksResult = {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message?: string; diagnostics?: LintDiagnostic[] }>;
  lint: MemImportLintResult;
  riskSignals: LintDiagnostic[];
  provenanceAudit?: { warnings: number; diagnostics: LintDiagnostic[] };
};

function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return Promise.resolve([]);
  return readdir(dir, { withFileTypes: true }).then(async (entries) => {
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await listMarkdownFiles(path));
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
    return files.sort();
  });
}

function countMarkdownFiles(dir: string): Promise<number> {
  return listMarkdownFiles(dir).then((files) => files.length);
}

function hasRequiredFrontmatter(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  return Boolean(match && /(^|\n)type: .+/m.test(match[1]) && /(^|\n)description: .+/m.test(match[1]));
}

function sourceLinkTargets(content: string): string[] {
  return [...content.matchAll(/\(([^)#]*sources\/units\/[^)#]+\.md#b\d{4})\)/g)].map((match) => match[1]);
}

function referencedUnitIdsFromArtifacts(artifacts: ArtifactPacket[] | undefined): string[] {
  return [...new Set((artifacts ?? []).flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)))].sort((a, b) => a.localeCompare(b));
}

function isNarrativeCorpus(artifacts: ArtifactPacket[] | undefined, bodyUnitCount: number): boolean {
  return bodyUnitCount > 1 && (artifacts?.length ?? 0) > 0;
}

export function collectNarrativeRiskSignals(artifacts: ArtifactPacket[] | undefined, bodyUnitCount: number): LintDiagnostic[] {
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

/** Run deterministic structural checks against the root-level mem-import projection. */
export async function deterministicMemImportChecks(outputRoot: string): Promise<MemImportChecksResult> {
  const projectionRoot = outputRoot;
  const checks: MemImportChecksResult["checks"] = [];
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

  const ownership = await readProjectionOwnership(projectionRoot).catch(() => undefined);
  const ownedFiles = new Set(ownership?.files ?? []);
  const markdownCount = ownership ? [...ownedFiles].filter((relativePath) => existsSync(join(projectionRoot, relativePath))).length : await countMarkdownFiles(projectionRoot);
  checks.push({ name: "mem-import markdown emitted", passed: markdownCount > 0, message: `${markdownCount} markdown file(s)` });
  const conceptFiles: string[] = [];
  for (const group of groups) {
    const groupDir = join(projectionRoot, group);
    if (!existsSync(groupDir)) continue;
    const groupFiles = (await readdir(groupDir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md" && ownedFiles.has(`${group}/${entry.name}`)).map((entry) => join(groupDir, entry.name));
    conceptFiles.push(...groupFiles);
    if (groupFiles.length > 0) checks.push({ name: `${group} index exists`, passed: existsSync(join(groupDir, "index.md")) });
  }
  checks.push({ name: "root index exists", passed: existsSync(join(projectionRoot, "index.md")) });
  checks.push({ name: "sources index exists", passed: existsSync(join(projectionRoot, "sources", "index.md")) });
  checks.push({ name: "coverage exists", passed: existsSync(join(projectionRoot, "coverage.md")) });
  checks.push({ name: "log exists", passed: existsSync(join(projectionRoot, "log.md")) });

  if (conceptFiles.length > 0) {
    const conceptContents = await Promise.all(conceptFiles.map(async (path) => ({ path, content: await readFile(path, "utf-8") })));
    checks.push({ name: "concept frontmatter includes type and description", passed: conceptContents.every(({ content }) => hasRequiredFrontmatter(content)), message: `${conceptFiles.length} concept file(s) checked` });
    const targets = conceptContents.flatMap(({ path, content }) => sourceLinkTargets(content).map((target) => ({ conceptPath: path, target })));
    const unresolved: string[] = [];
    for (const { conceptPath, target } of targets) {
      const [pathPart, anchor] = target.split("#");
      const file = resolveMarkdownTargetPath(projectionRoot, conceptPath, pathPart);
      if (!existsSync(file)) { unresolved.push(target); continue; }
      const content = await readFile(file, "utf-8");
      const escaped = anchor?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!anchor || !new RegExp(`^##\\s+${escaped}\\s*$`, "m").test(content)) unresolved.push(target);
    }
    checks.push({ name: "provenance source-target resolvability", passed: targets.length > 0 && unresolved.length === 0, message: targets.length > 0 ? `${targets.length - unresolved.length}/${targets.length} resolved` : "no source links found" });
  }
  if (manifestUnits > 0) {
    const emitted = referencedUnitIds.filter((unitId) => existsSync(join(projectionRoot, "sources", "units", `${unitId}.md`))).length;
    checks.push({ name: "retained source pages emitted", passed: referencedUnitIds.length === 0 ? existsSync(join(projectionRoot, "sources", "units")) : emitted === referencedUnitIds.length, message: referencedUnitIds.length === 0 ? `${manifestUnits} manifest unit(s); no artifact citations yet` : `${emitted}/${referencedUnitIds.length} referenced source page(s) emitted` });
  }
  if (artifactCount > 0) checks.push({ name: "concept pages emitted", passed: conceptFiles.length > 0, message: `${conceptFiles.length} concept page(s)` });

  const lint = await lintMemImport(outputRoot);
  checks.push({ name: "mem-import wiki lint", passed: lint.passed, message: lint.diagnostics.length === 0 ? "no diagnostics" : `${lint.diagnostics.filter((item) => item.level === "error").length} error(s), ${lint.diagnostics.filter((item) => item.level === "warning").length} warning(s)`, diagnostics: lint.diagnostics });
  const riskSignals = collectNarrativeRiskSignals(mergeArtifacts, bodyUnitCount);
  if (riskSignals.length > 0) checks.push({ name: "narrative surface risks", passed: true, message: `${riskSignals.length} warning(s)`, diagnostics: riskSignals });

  const audit = mergeArtifacts ? await provenanceAudit({ outputRoot }) : undefined;
  const provenanceWarnings = mergeArtifacts ? await collectProvenanceRiskSignals(outputRoot, mergeArtifacts) : [];
  const auditDiagnostics = [...provenanceWarnings, ...(audit?.diagnostics ?? [])];
  const provenance = mergeArtifacts ? { warnings: auditDiagnostics.length, diagnostics: auditDiagnostics } : undefined;
  if (provenance && provenance.warnings > 0) checks.push({ name: "provenance audit warnings", passed: true, message: `${provenance.warnings} warning(s)`, diagnostics: provenance.diagnostics });
  const checksWithDiagnostics = checks.map((check) => check.passed || (check.diagnostics?.some((diagnostic) => diagnostic.level === "error") ?? false)
    ? check
    : {
        ...check,
        diagnostics: [{ code: "deterministic-check-failed", level: "error" as const, message: `Deterministic mem-import check failed: ${check.name}${check.message ? ` (${check.message})` : ""}` }],
      });
  return { passed: checksWithDiagnostics.every((check) => check.passed), checks: checksWithDiagnostics, lint, riskSignals, provenanceAudit: provenance };
}

export const deterministicChecks = deterministicMemImportChecks;
