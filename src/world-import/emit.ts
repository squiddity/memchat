import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactPacket, MarkdownSection, NormalizedSourceUnit, SourceManifest, SourceSpanRef, WorldImportGroup } from "./types.js";
import { readManifest, readMergeStage, readNormalizedUnit, validateStageEnvelope } from "./staging.js";

const groups: WorldImportGroup[] = ["people", "places", "things", "facts"];
const defaultTypes: Record<WorldImportGroup, string> = {
  people: "Character",
  places: "Location",
  things: "Object",
  facts: "Event",
};

type EmitContext = {
  relatedLinks: Record<string, string>;
  sourceLinks: Record<string, string>;
};

type IndexEntry = {
  title: string;
  path: string;
  description: string;
};

type PlannedArtifactFile = {
  artifact: ArtifactPacket;
  relativePath: string;
  file: string;
};

export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug || "artifact";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function trimInline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function worldPath(path: string): string {
  return `/${path}`;
}

function defaultDescription(artifact: ArtifactPacket): string {
  const summarySection = artifact.sections.find((section) => /^(capsule|summary)$/i.test(section.heading.trim()));
  const source = summarySection?.body ?? artifact.sections[0]?.body ?? artifact.title;
  return trimInline(source).slice(0, 240);
}

function effectiveDescription(artifact: ArtifactPacket): string {
  return trimInline(artifact.description ?? defaultDescription(artifact));
}

function withSummaryFallback(artifact: ArtifactPacket): MarkdownSection[] {
  const hasShortSection = artifact.sections.some((section) => /^(capsule|summary)$/i.test(section.heading.trim()));
  if (hasShortSection || !artifact.description) return artifact.sections;
  return [{ heading: "Summary", body: artifact.description }, ...artifact.sections];
}

function frontmatter(artifact: ArtifactPacket): string {
  const lines = [
    "---",
    `id: ${yamlString(artifact.id)}`,
    `group: ${artifact.group}`,
    `type: ${yamlString(trimInline(artifact.type ?? defaultTypes[artifact.group]))}`,
    `title: ${yamlString(artifact.title)}`,
    `description: ${yamlString(effectiveDescription(artifact))}`,
  ];
  if (artifact.resource) lines.push(`resource: ${yamlString(trimInline(artifact.resource))}`);
  if (artifact.tags?.length) lines.push(`tags: [${artifact.tags.map((tag) => yamlString(trimInline(tag))).join(", ")}]`);
  if (artifact.timestamp) lines.push(`timestamp: ${yamlString(trimInline(artifact.timestamp))}`);
  if (artifact.related?.length) lines.push(`related: [${artifact.related.map(yamlString).join(", ")}]`);
  if (artifact.metadata && Object.keys(artifact.metadata).length > 0) lines.push("metadata: true");
  lines.push("---");
  return lines.join("\n");
}

function renderRelated(related: string[] | undefined, relatedLinks: Record<string, string>): string {
  if (!related || related.length === 0) return "";
  const lines = [
    "## Related",
    ...[...related].sort().map((id) => relatedLinks[id] ? `- [${id}](${relatedLinks[id]})` : `- [[${id}]]`),
  ];
  return `${lines.join("\n")}\n\n`;
}

function provenanceLabel(ref: SourceSpanRef): string {
  return `${ref.sourceId}/${ref.unitId}#${ref.startAnchor}-${ref.endAnchor}`;
}

function sourceAnchorLink(ref: SourceSpanRef, sourceLinks: Record<string, string>): string | undefined {
  const base = sourceLinks[ref.unitId];
  return base ? `${base}#${ref.startAnchor}` : undefined;
}

function renderProvenance(artifact: ArtifactPacket, sourceLinks: Record<string, string>): string {
  const lines = ["## Provenance"];
  for (const [index, ref] of artifact.provenance.entries()) {
    const link = sourceAnchorLink(ref, sourceLinks);
    lines.push(link ? `${index + 1}. [\`${provenanceLabel(ref)}\`](${link})` : `${index + 1}. \`${provenanceLabel(ref)}\``);
    lines.push(`   > ${trimInline(ref.quote)}`);
    if (!link) lines.push("   _(degraded: emitted bundle is missing the retained normalized source target for this citation)_");
  }
  return `${lines.join("\n")}\n`;
}

export function renderArtifactMarkdown(artifact: ArtifactPacket, context: Partial<EmitContext> = {}): string {
  const sections = withSummaryFallback(artifact).map((section) => `## ${section.heading}\n\n${section.body.trim()}\n\n`).join("");
  return `${frontmatter(artifact)}\n\n# ${artifact.title}\n\n${sections}${renderRelated(artifact.related, context.relatedLinks ?? {})}${renderProvenance(artifact, context.sourceLinks ?? {})}`;
}

function sourceUnitFrontmatter(unit: NormalizedSourceUnit): string {
  const lines = [
    "---",
    'type: "Source Unit"',
    `title: ${yamlString(unit.title ?? unit.unitId)}`,
    `description: ${yamlString(`Normalized source text for ${unit.title ?? unit.unitId}.`)}`,
    `source_id: ${yamlString(unit.sourceId)}`,
    `unit_id: ${yamlString(unit.unitId)}`,
    `input_path: ${yamlString(unit.inputPath)}`,
    `source_hash: ${yamlString(unit.sourceHash)}`,
    `content_hash: ${yamlString(unit.contentHash)}`,
    `normalizer_version: ${unit.normalizerVersion}`,
  ];
  if (unit.archivePath) lines.push(`archive_path: ${yamlString(unit.archivePath)}`);
  lines.push("---");
  return lines.join("\n");
}

export function renderSourceUnitMarkdown(unit: NormalizedSourceUnit): string {
  const blocks = unit.blocks.map((block) => `## ${block.anchor}\n\n${block.text}\n`).join("\n");
  return `${sourceUnitFrontmatter(unit)}\n\n# ${unit.title ?? unit.unitId}\n\n${blocks}`;
}

function renderIndex(title: string, entries: IndexEntry[]): string {
  if (entries.length === 0) return `# ${title}\n\n_No entries._\n`;
  return `# ${title}\n\n${entries.map((entry) => `- [${entry.title}](${entry.path}) - ${entry.description}`).join("\n")}\n`;
}

function renderRootIndex(groupEntries: IndexEntry[], sourceEntry: IndexEntry, coverageEntry: IndexEntry): string {
  return [
    "# World Index",
    "",
    "## Groups",
    ...groupEntries.map((entry) => `- [${entry.title}](${entry.path}) - ${entry.description}`),
    "",
    "## Sources",
    `- [${sourceEntry.title}](${sourceEntry.path}) - ${sourceEntry.description}`,
    "",
    "## Coverage",
    `- [${coverageEntry.title}](${coverageEntry.path}) - ${coverageEntry.description}`,
    "",
  ].join("\n");
}

function renderLog(createdAt: string, artifacts: ArtifactPacket[], sourceCount: number, degradedCitationCount: number): string {
  const date = createdAt.slice(0, 10);
  const groupCounts = groups.map((group) => `${group}: ${artifacts.filter((artifact) => artifact.group === group).length}`).join(", ");
  return [
    "# World Update Log",
    "",
    `## ${date}`,
    `* **Emit**: Generated ${artifacts.length} concept page(s) across ${groupCounts}.`,
    `* **Sources**: Retained ${sourceCount} source-unit page(s) for provenance inspection.`,
    `* **Citations**: ${degradedCitationCount === 0 ? "All emitted provenance links resolved within the bundle." : `${degradedCitationCount} provenance citation(s) were degraded because source targets were unavailable.`}`,
    "",
  ].join("\n");
}

function renderCoverage(entries: Array<{ unitTitle: string; unitPath: string; artifacts: IndexEntry[] }>): string {
  if (entries.length === 0) return "# Source Coverage\n\n_No source coverage entries._\n";
  return [
    "# Source Coverage",
    "",
    ...entries.flatMap((entry) => [
      `## [${entry.unitTitle}](${entry.unitPath})`,
      "",
      ...(entry.artifacts.length > 0 ? entry.artifacts.map((artifact) => `- [${artifact.title}](${artifact.path}) - ${artifact.description}`) : ["- No emitted concept pages cite this source unit."]),
      "",
    ]),
  ].join("\n");
}

async function loadManifestIfPresent(outputRoot: string): Promise<SourceManifest | undefined> {
  if (!existsSync(join(outputRoot, "sources", "manifest.json"))) return undefined;
  return readManifest(outputRoot);
}

function planArtifactFiles(outputRoot: string, artifacts: ArtifactPacket[]): { planned: PlannedArtifactFile[]; relatedLinks: Record<string, string> } {
  const worldRoot = join(outputRoot, "world");
  const used = new Map<string, number>();
  const relatedLinks = new Map<string, string>();
  const planned = [...artifacts]
    .sort((a, b) => `${a.group}:${a.title}`.localeCompare(`${b.group}:${b.title}`))
    .map((artifact) => {
      const base = slugify(artifact.id || artifact.title);
      const count = used.get(`${artifact.group}/${base}`) ?? 0;
      used.set(`${artifact.group}/${base}`, count + 1);
      const relativePath = `${artifact.group}/${count === 0 ? base : `${base}-${count + 1}`}.md`;
      relatedLinks.set(artifact.id, worldPath(relativePath));
      return { artifact, relativePath, file: join(worldRoot, relativePath) };
    });
  return { planned, relatedLinks: Object.fromEntries(relatedLinks) };
}

export async function emitWorldLibrary(outputRoot: string): Promise<string[]> {
  const merge = await readMergeStage(outputRoot);
  validateStageEnvelope(merge, { requireArtifacts: true });
  const artifacts = merge.artifacts ?? [];
  const manifest = await loadManifestIfPresent(outputRoot);
  const worldRoot = join(outputRoot, "world");
  await rm(worldRoot, { recursive: true, force: true });
  for (const group of groups) await mkdir(join(worldRoot, group), { recursive: true });
  await mkdir(join(worldRoot, "sources", "units"), { recursive: true });

  const { planned: artifactFiles, relatedLinks } = planArtifactFiles(outputRoot, artifacts);
  const referencedUnitIds = new Set(artifacts.flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)));
  const sourceLinks = new Map<string, string>();
  const sourceEntries: Array<{ unitId: string; title: string; path: string; description: string }> = [];
  const written: string[] = [];

  if (manifest) {
    for (const entry of manifest.units.filter((unit) => referencedUnitIds.has(unit.unitId))) {
      try {
        const unit = await readNormalizedUnit(outputRoot, entry.unitId);
        const relativePath = `sources/units/${entry.unitId}.md`;
        const file = join(worldRoot, relativePath);
        await writeFile(file, renderSourceUnitMarkdown(unit), "utf-8");
        sourceLinks.set(entry.unitId, worldPath(relativePath));
        sourceEntries.push({
          unitId: entry.unitId,
          title: unit.title ?? unit.unitId,
          path: worldPath(relativePath),
          description: `Normalized source text for ${unit.title ?? unit.unitId}.`,
        });
        written.push(file);
      } catch {
        // Leave citations degraded if the normalized unit is unavailable.
      }
    }
  }

  const context: EmitContext = {
    relatedLinks,
    sourceLinks: Object.fromEntries(sourceLinks),
  };

  const artifactEntriesByGroup = new Map<WorldImportGroup, IndexEntry[]>();
  for (const entry of artifactFiles) {
    await writeFile(entry.file, renderArtifactMarkdown(entry.artifact, context), "utf-8");
    const groupEntries = artifactEntriesByGroup.get(entry.artifact.group) ?? [];
    groupEntries.push({
      title: entry.artifact.title,
      path: worldPath(entry.relativePath),
      description: effectiveDescription(entry.artifact),
    });
    artifactEntriesByGroup.set(entry.artifact.group, groupEntries);
    written.push(entry.file);
  }

  const groupIndexEntries: IndexEntry[] = [];
  for (const group of groups) {
    const entries = artifactEntriesByGroup.get(group) ?? [];
    const relativePath = `${group}/index.md`;
    await writeFile(join(worldRoot, relativePath), renderIndex(group[0].toUpperCase() + group.slice(1), entries), "utf-8");
    written.push(join(worldRoot, relativePath));
    groupIndexEntries.push({
      title: group[0].toUpperCase() + group.slice(1),
      path: worldPath(relativePath),
      description: `${entries.length} concept page(s).`,
    });
  }

  const sourcesIndexPath = join(worldRoot, "sources", "index.md");
  await writeFile(sourcesIndexPath, renderIndex("Sources", sourceEntries.map((entry) => ({ title: entry.title, path: entry.path, description: entry.description }))), "utf-8");
  written.push(sourcesIndexPath);

  const coverageEntries = sourceEntries.map((source) => ({
    unitTitle: source.title,
    unitPath: source.path,
    artifacts: artifactFiles
      .filter((entry) => entry.artifact.provenance.some((ref) => ref.unitId === source.unitId))
      .map((entry) => ({
        title: entry.artifact.title,
        path: worldPath(entry.relativePath),
        description: effectiveDescription(entry.artifact),
      })),
  }));
  const coveragePath = join(worldRoot, "coverage.md");
  await writeFile(coveragePath, renderCoverage(coverageEntries), "utf-8");
  written.push(coveragePath);

  const rootIndexPath = join(worldRoot, "index.md");
  await writeFile(rootIndexPath, renderRootIndex(groupIndexEntries, {
    title: "Sources",
    path: worldPath("sources/index.md"),
    description: `${sourceEntries.length} retained source-unit page(s).`,
  }, {
    title: "Source Coverage",
    path: worldPath("coverage.md"),
    description: "Maps retained source units to emitted concept pages.",
  }), "utf-8");
  written.push(rootIndexPath);

  const degradedCitationCount = artifacts.reduce((count, artifact) => count + artifact.provenance.filter((ref) => !sourceLinks.has(ref.unitId)).length, 0);
  const logPath = join(worldRoot, "log.md");
  await writeFile(logPath, renderLog(manifest?.createdAt ?? new Date().toISOString(), artifacts, sourceEntries.length, degradedCitationCount), "utf-8");
  written.push(logPath);

  return written;
}
