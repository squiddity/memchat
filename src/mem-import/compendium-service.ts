import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readExtractionStages, readManifest, readNormalizedUnit, writeExtractionStage, writeJson, writeManifest, writeNormalizedUnit } from "../world-import/staging.js";
import type { SourceManifest } from "../world-import/types.js";
import { MemImportService, type BeginRunResult, type MemImportActorAudit } from "./service.js";

export type CompendiumRunRecord = {
  runId: string;
  workId: string;
  runRoot: string;
  createdAt: string;
  normalizedAt?: string;
  sourceHash?: string;
  duplicateOfRunId?: string;
};

export type CompendiumRecord = {
  version: 1;
  kind: "mem-import-compendium";
  compendiumId: string;
  root: string;
  createdAt: string;
  runs: CompendiumRunRecord[];
};

function recordPath(root: string): string { return join(root, "stages", "compendium.json"); }

function assertId(value: string, label: string): void {
  if (!value.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens`);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceHash(manifest: SourceManifest): string {
  return hash(manifest.units.map((unit) => ({ unitId: unit.unitId, sourceId: unit.sourceId, contentHash: unit.contentHash })).sort((left, right) => left.unitId.localeCompare(right.unitId)));
}

async function readCompendium(root: string): Promise<CompendiumRecord | undefined> {
  if (!existsSync(recordPath(root))) return undefined;
  const record = JSON.parse(await readFile(recordPath(root), "utf-8")) as Partial<CompendiumRecord>;
  if (record.version !== 1 || record.kind !== "mem-import-compendium" || typeof record.compendiumId !== "string" || record.root !== root || !Array.isArray(record.runs)) throw new Error("Invalid mem-import compendium record");
  return record as CompendiumRecord;
}

/**
 * Compendium registry and run-root allocator. Canonical transaction storage is
 * deliberately introduced separately so this layer never makes semantic merge
 * decisions or silently copies canonical artifacts into a new work run.
 */
export type CompendiumProjection = { compendiumRoot: string; sourceUnits: number; extractionPackets: number; sourceLocatorPath: string };

/** Build a deterministic shared source/extraction projection for checks and Markdown emission. */
export async function projectCompendium(compendiumRootInput: string): Promise<CompendiumProjection> {
  const compendiumRoot = resolve(compendiumRootInput);
  const record = await readCompendium(compendiumRoot);
  if (!record) throw new Error("Mem-import compendium does not exist");
  const entries: SourceManifest["units"] = [];
  const seenUnits = new Map<string, string>();
  const locator: Array<{ unitId: string; sourceId: string; runId: string; runRoot: string; contentHash: string }> = [];
  const extractionUnitIds = new Set<string>();
  for (const run of record.runs) {
    const manifestPath = join(run.runRoot, "sources", "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = await readManifest(run.runRoot);
    for (const entry of manifest.units) {
      const prior = seenUnits.get(entry.unitId);
      if (prior && prior !== entry.contentHash) throw new Error(`Compendium source unit collision for ${entry.unitId}`);
      if (prior) continue;
      seenUnits.set(entry.unitId, entry.contentHash);
      const unit = await readNormalizedUnit(run.runRoot, entry.unitId);
      const order = entries.length;
      await writeNormalizedUnit(compendiumRoot, { ...unit, order });
      entries.push({ ...entry, order, normalizedPath: `sources/normalized/${entry.unitId}.json` });
      locator.push({ unitId: entry.unitId, sourceId: entry.sourceId, runId: run.runId, runRoot: run.runRoot, contentHash: entry.contentHash });
    }
    for (const stage of await readExtractionStages(run.runRoot)) {
      if (!stage.unitId || extractionUnitIds.has(stage.unitId)) continue;
      extractionUnitIds.add(stage.unitId);
      await writeExtractionStage(compendiumRoot, stage);
    }
  }
  await writeManifest({ version: 1, createdAt: new Date().toISOString(), inputRoot: "compendium", outputRoot: compendiumRoot, units: entries, diagnostics: [] });
  const sourceLocatorPath = join(compendiumRoot, "stages", "source-locator.json");
  await writeJson(sourceLocatorPath, { version: 1, kind: "mem-import-source-locator", compendiumId: record.compendiumId, units: locator });
  return { compendiumRoot, sourceUnits: entries.length, extractionPackets: extractionUnitIds.size, sourceLocatorPath: "stages/source-locator.json" };
}

export class MemImportCompendiumService {
  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {}

  async begin(options: { compendiumRoot: string; compendiumId: string; workId: string; audit?: { parent?: MemImportActorAudit } }): Promise<BeginRunResult & { compendiumId: string; workId: string; compendiumRoot: string }> {
    assertId(options.compendiumId, "compendiumId");
    assertId(options.workId, "workId");
    const compendiumRoot = resolve(options.compendiumRoot);
    const existing = await this.read(compendiumRoot);
    if (existing && existing.compendiumId !== options.compendiumId) throw new Error(`Compendium root already belongs to ${existing.compendiumId}`);
    const nonce = randomBytes(8).toString("hex");
    const run = await this.base.begin(join(compendiumRoot, "stages", "runs", `pending-${nonce}`), options.audit, { compendiumRoot });
    const runRoot = run.outputRoot;
    const record: CompendiumRecord = existing ?? { version: 1, kind: "mem-import-compendium", compendiumId: options.compendiumId, root: compendiumRoot, createdAt: this.now().toISOString(), runs: [] };
    record.runs.push({ runId: run.runId, workId: options.workId, runRoot, createdAt: this.now().toISOString() });
    await writeJson(recordPath(compendiumRoot), record);
    return { ...run, compendiumId: record.compendiumId, workId: options.workId, compendiumRoot };
  }

  async normalize(options: { compendiumRoot: string; outputRoot: string; runId: string; coordinatorGrant: string; input: string }): Promise<{ manifest: SourceManifest; sourceHash: string; duplicateOfRunId?: string }> {
    const compendiumRoot = resolve(options.compendiumRoot);
    const record = await this.require(compendiumRoot);
    const run = record.runs.find((item) => item.runId === options.runId && item.runRoot === resolve(options.outputRoot));
    if (!run) throw new Error("Run does not belong to this compendium");
    const manifest = await this.base.normalize(options);
    const nextSourceHash = sourceHash(manifest);
    const duplicate = record.runs.find((item) => item.runId !== run.runId && item.sourceHash === nextSourceHash);
    run.normalizedAt = this.now().toISOString();
    run.sourceHash = nextSourceHash;
    if (duplicate) run.duplicateOfRunId = duplicate.runId;
    await writeJson(recordPath(compendiumRoot), record);
    return { manifest, sourceHash: nextSourceHash, ...(duplicate ? { duplicateOfRunId: duplicate.runId } : {}) };
  }

  async inspect(compendiumRootInput: string): Promise<CompendiumRecord> {
    return this.require(resolve(compendiumRootInput));
  }

  private async read(root: string): Promise<CompendiumRecord | undefined> {
    return readCompendium(root);
  }

  private async require(root: string): Promise<CompendiumRecord> {
    const record = await this.read(root);
    if (!record) throw new Error("Mem-import compendium does not exist");
    return record;
  }
}
