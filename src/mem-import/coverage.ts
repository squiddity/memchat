import { existsSync } from "node:fs";
import { join } from "node:path";
import { MEM_IMPORT_GROUPS, type CandidateDisposition, type LintDiagnostic, type MemImportGroup } from "./contracts.js";
import { readExtractionStages, readManifest, readMergeStage } from "./stage-store.js";

export type CoveragePlan = {
  sourceUnits: number;
  extractionStages: number;
  artifacts: number;
  groups: Record<MemImportGroup, number>;
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

function candidateKey(unitId: string | undefined, candidateId: string): string {
  return `${unitId ?? ""}:${candidateId}`;
}

function representedCandidateKeys(artifact: { metadata?: Record<string, unknown> }): string[] {
  const raw = artifact.metadata?.representedCandidateIds ?? artifact.metadata?.candidateIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

async function sourcePageExists(outputRoot: string, unitId: string): Promise<boolean> {
  return existsSync(join(outputRoot, "sources", "units", `${unitId}.md`));
}

/** Build reusable source-unit and candidate coverage data for the compendium projection. */
export async function buildCoveragePlan(outputRoot: string): Promise<CoveragePlan> {
  const manifest = await readManifest(outputRoot);
  const extractionStages = await readExtractionStages(outputRoot);
  let merge;
  try { merge = await readMergeStage(outputRoot); } catch { merge = undefined; }
  const artifacts = merge?.artifacts ?? [];
  const groups = Object.fromEntries(MEM_IMPORT_GROUPS.map((group) => [group, 0])) as Record<MemImportGroup, number>;
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
    represented.add(rawKey.includes(":") ? rawKey : candidateKey(undefined, rawKey));
    if (!rawKey.includes(":")) for (const candidate of keysByCandidateId.get(rawKey) ?? []) represented.add(candidate);
  }
  const dispositionByKey = new Map<string, CandidateDisposition["disposition"]>();
  for (const disposition of merge?.candidateDispositions ?? []) {
    const key = candidateKey(disposition.unitId, disposition.candidateId);
    dispositionByKey.set(key, disposition.disposition);
    if (!disposition.unitId) for (const candidate of keysByCandidateId.get(disposition.candidateId) ?? []) dispositionByKey.set(candidate, disposition.disposition);
  }
  const dispositionCounts: Record<CandidateDisposition["disposition"], number> = { represented: 0, merged: 0, deferred: 0, dropped: 0 };
  const unaccounted: Array<{ unitId?: string; candidateId: string }> = [];
  for (const key of allCandidateKeys) {
    const disposition = dispositionByKey.get(key);
    if (disposition) dispositionCounts[disposition]++;
    else if (represented.has(key)) dispositionCounts.represented++;
    else {
      const [unitId, candidateId] = key.split(":");
      unaccounted.push({ ...(unitId ? { unitId } : {}), candidateId: candidateId ?? "" });
    }
  }

  const recommendations: LintDiagnostic[] = [];
  for (const group of MEM_IMPORT_GROUPS) if (groups[group] === 0) recommendations.push({ code: `no-${group}-artifacts`, level: "warning", message: `No artifacts exist in group ${group}` });
  if (unaccounted.length > 0) recommendations.push({ code: "unaccounted-candidates", level: "error", message: `${unaccounted.length} extraction candidate(s) lack representation or disposition` });
  return {
    sourceUnits: manifest.units.length,
    extractionStages: extractionStages.length,
    artifacts: artifacts.length,
    groups,
    unitCoverage,
    candidateAccounting: { totalCandidates: allCandidateKeys.size, represented: dispositionCounts.represented, merged: dispositionCounts.merged, deferred: dispositionCounts.deferred, dropped: dispositionCounts.dropped, unaccounted },
    recommendations,
  };
}

export function renderCoverageMarkdown(plan: CoveragePlan): string {
  const lines = ["# Mem-import coverage", "", `Source units: ${plan.sourceUnits}`, `Extraction stages: ${plan.extractionStages}`, `Artifacts: ${plan.artifacts}`, "", "## Candidate accounting", "", `- Total: ${plan.candidateAccounting.totalCandidates}`, `- Represented: ${plan.candidateAccounting.represented}`, `- Merged: ${plan.candidateAccounting.merged}`, `- Deferred: ${plan.candidateAccounting.deferred}`, `- Dropped: ${plan.candidateAccounting.dropped}`, `- Unaccounted: ${plan.candidateAccounting.unaccounted.length}`, "", "## Source units", ""];
  for (const unit of plan.unitCoverage) lines.push(`- ${unit.unitId}: ${unit.representedByArtifacts.length} artifact(s); extraction=${unit.hasExtraction ? "yes" : "no"}; source page=${unit.sourcePageEmitted ? "yes" : "no"}`);
  if (plan.recommendations.length > 0) {
    lines.push("", "## Recommendations", "");
    for (const diagnostic of plan.recommendations) lines.push("- `" + diagnostic.code + "`: " + diagnostic.message);
  }
  return `${lines.join("\n")}\n`;
}
