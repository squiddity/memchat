import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { WORLD_IMPORT_GROUPS, type ArtifactPacket, type MarkdownSection, type NormalizedSourceUnit, type SourceManifest, type SourceSpanRef, type WorldImportGroup } from "./types.js";
import { classifyNarrativeSurface } from "./narrative-surfaces.js";
import { readManifest, readMergeStage, readNormalizedUnit, validateStageEnvelope } from "./staging.js";

const groups = [...WORLD_IMPORT_GROUPS];
const defaultTypes: Record<WorldImportGroup, string> = {
  people: "Character",
  places: "Location",
  things: "Object",
  facts: "Event",
  style: "Style Guide",
};

type EmitContext = {
  relatedTargets: Record<string, string>;
  sourceTargets: Record<string, string>;
  currentRelativePath: string;
  currentArtifactId?: string;
};

type IndexEntry = {
  title: string;
  targetPath: string;
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

function relativeLink(fromRelativePath: string, toRelativePath: string): string {
  const link = relative(dirname(fromRelativePath), toRelativePath).split("\\").join("/");
  return link || "./";
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

function renderRelated(related: string[] | undefined, context: EmitContext): string {
  if (!related || related.length === 0) return "";
  const lines = [
    "## Related",
    ...[...related].sort().map((id) => context.relatedTargets[id] ? `- [${id}](${relativeLink(context.currentRelativePath, context.relatedTargets[id])})` : `- [[${id}]]`),
  ];
  return `${lines.join("\n")}\n\n`;
}

function findProtectedMarkdownEnd(text: string, start: number): number | undefined {
  let depth = 0;
  for (let index = start; index < text.length && text[index] !== "\n"; index += 1) {
    if (text[index] === "[") depth += 1;
    else if (text[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        if (text[index + 1] !== "(") return undefined;
        const end = text.indexOf(")", index + 2);
        return end === -1 ? undefined : end + 1;
      }
    }
  }
  return undefined;
}

function findInlineCodeEnd(text: string, start: number): number | undefined {
  let runLength = 0;
  while (text[start + runLength] === "`") runLength += 1;
  const fence = "`".repeat(runLength);
  const end = text.indexOf(fence, start + runLength);
  return end === -1 ? undefined : end + runLength;
}

function findBareUrlEnd(text: string, start: number): number | undefined {
  if (!/^https?:\/\//i.test(text.slice(start))) return undefined;
  if (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) return undefined;
  let end = start;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return end;
}

function renderInlineArtifactLinks(text: string, context: EmitContext): string {
  let output = "";
  let index = 0;
  let inFence: string | undefined;

  while (index < text.length) {
    if (index === 0 || text[index - 1] === "\n") {
      const fenceMatch = text.slice(index).match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const fence = fenceMatch[1];
        if (!inFence) inFence = fence[0];
        else if (fence[0] === inFence) inFence = undefined;
        const lineEnd = text.indexOf("\n", index);
        const end = lineEnd === -1 ? text.length : lineEnd + 1;
        output += text.slice(index, end);
        index = end;
        continue;
      }
    }

    if (inFence) {
      output += text[index++];
      continue;
    }

    if (text[index] === "`") {
      const end = findInlineCodeEnd(text, index);
      if (end !== undefined) {
        output += text.slice(index, end);
        index = end;
        continue;
      }
    }

    const urlEnd = findBareUrlEnd(text, index);
    if (urlEnd !== undefined) {
      output += text.slice(index, urlEnd);
      index = urlEnd;
      continue;
    }

    if (text.startsWith("[[", index)) {
      const end = text.indexOf("]]", index + 2);
      if (end !== -1) {
        const marker = text.slice(index + 2, end);
        const separator = marker.indexOf("|");
        const targetId = (separator === -1 ? marker : marker.slice(0, separator)).trim();
        const label = (separator === -1 ? targetId : marker.slice(separator + 1)).trim();
        const targetPath = context.relatedTargets[targetId];
        if (targetId && label && targetPath) {
          output += context.currentArtifactId === targetId
            ? label
            : `[${label}](${relativeLink(context.currentRelativePath, targetPath)})`;
          index = end + 2;
          continue;
        }
      }
    }

    if (text[index] === "[") {
      const end = findProtectedMarkdownEnd(text, index);
      if (end !== undefined) {
        output += text.slice(index, end);
        index = end;
        continue;
      }
    }

    output += text[index++];
  }

  return output;
}

function provenanceLabel(ref: SourceSpanRef): string {
  return `${ref.sourceId}/${ref.unitId}#${ref.startAnchor}-${ref.endAnchor}`;
}

function sourceAnchorLink(ref: SourceSpanRef, context: EmitContext): string | undefined {
  const target = context.sourceTargets[ref.unitId];
  return target ? `${relativeLink(context.currentRelativePath, target)}#${ref.startAnchor}` : undefined;
}

function renderProvenance(artifact: ArtifactPacket, context: EmitContext): string {
  const lines = ["## Provenance"];
  for (const [index, ref] of artifact.provenance.entries()) {
    const link = sourceAnchorLink(ref, context);
    lines.push(link ? `${index + 1}. [\`${provenanceLabel(ref)}\`](${link})` : `${index + 1}. \`${provenanceLabel(ref)}\``);
    lines.push(`   > ${trimInline(ref.quote)}`);
    if (!link) lines.push("   _(degraded: emitted bundle is missing the retained normalized source target for this citation)_");
  }
  return `${lines.join("\n")}\n`;
}

export function renderArtifactMarkdown(artifact: ArtifactPacket, context?: EmitContext): string {
  const safeContext = context ?? {
    relatedTargets: {},
    sourceTargets: {},
    currentRelativePath: `${artifact.group}/${slugify(artifact.id || artifact.title)}.md`,
    currentArtifactId: artifact.id,
  };
  const sections = withSummaryFallback(artifact)
    .map((section) => `## ${section.heading}\n\n${renderInlineArtifactLinks(section.body.trim(), { ...safeContext, currentArtifactId: artifact.id })}\n\n`)
    .join("");
  return `${frontmatter(artifact)}\n\n# ${artifact.title}\n\n${sections}${renderRelated(artifact.related, safeContext)}${renderProvenance(artifact, safeContext)}`;
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
  if (unit.role) lines.push(`role: ${yamlString(unit.role)}`);
  if (unit.sourceEntryPath) lines.push(`source_entry_path: ${yamlString(unit.sourceEntryPath)}`);
  if (unit.portableSourceKey) lines.push(`portable_source_key: ${yamlString(unit.portableSourceKey)}`);
  if (unit.archiveContentHash) lines.push(`archive_content_hash: ${yamlString(unit.archiveContentHash)}`);
  if (unit.archivePath) lines.push(`archive_path_diagnostic: ${yamlString(unit.archivePath)}`);
  lines.push("---");
  return lines.join("\n");
}

export function renderSourceUnitMarkdown(unit: NormalizedSourceUnit): string {
  const blocks = unit.blocks.map((block) => {
    const meta = [block.kind ? `kind=${block.kind}` : undefined, block.sourceTag ? `tag=${block.sourceTag}` : undefined, block.sourceClass ? `class=${block.sourceClass}` : undefined].filter(Boolean).join(", ");
    return `## ${block.anchor}\n\n${meta ? `_${meta}_\n\n` : ""}${block.text}\n`;
  }).join("\n");
  return `${sourceUnitFrontmatter(unit)}\n\n# ${unit.title ?? unit.unitId}\n\n${blocks}`;
}

function renderIndex(title: string, entries: IndexEntry[], currentRelativePath: string): string {
  if (entries.length === 0) return `# ${title}\n\n_No entries._\n`;
  return `# ${title}\n\n${entries.map((entry) => `- [${entry.title}](${relativeLink(currentRelativePath, entry.targetPath)}) - ${entry.description}`).join("\n")}\n`;
}

function renderRootIndex(groupEntries: IndexEntry[], narrativeEntries: IndexEntry[], sourceEntry: IndexEntry, coverageEntry: IndexEntry, currentRelativePath: string): string {
  return [
    "# World Index",
    "",
    ...(narrativeEntries.length > 0
      ? [
          "## Plot and Reading Order",
          ...narrativeEntries.map((entry) => `- [${entry.title}](${relativeLink(currentRelativePath, entry.targetPath)}) - ${entry.description}`),
          "",
        ]
      : []),
    "## Groups",
    ...groupEntries.map((entry) => `- [${entry.title}](${relativeLink(currentRelativePath, entry.targetPath)}) - ${entry.description}`),
    "",
    "## Sources",
    `- [${sourceEntry.title}](${relativeLink(currentRelativePath, sourceEntry.targetPath)}) - ${sourceEntry.description}`,
    "",
    "## Coverage",
    `- [${coverageEntry.title}](${relativeLink(currentRelativePath, coverageEntry.targetPath)}) - ${coverageEntry.description}`,
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

function renderCoverage(entries: Array<{ unitTitle: string; unitTargetPath: string; artifacts: IndexEntry[] }>, currentRelativePath: string): string {
  if (entries.length === 0) return "# Source Coverage\n\n_No source coverage entries._\n";
  return [
    "# Source Coverage",
    "",
    ...entries.flatMap((entry) => [
      `## [${entry.unitTitle}](${relativeLink(currentRelativePath, entry.unitTargetPath)})`,
      "",
      ...(entry.artifacts.length > 0 ? entry.artifacts.map((artifact) => `- [${artifact.title}](${relativeLink(currentRelativePath, artifact.targetPath)}) - ${artifact.description}`) : ["- No emitted concept pages cite this source unit."]),
      "",
    ]),
  ].join("\n");
}

async function loadManifestIfPresent(outputRoot: string): Promise<SourceManifest | undefined> {
  if (!existsSync(join(outputRoot, "sources", "manifest.json"))) return undefined;
  return readManifest(outputRoot);
}

function narrativeSurfacePriority(entry: IndexEntry): number {
  const label = entry.title.toLowerCase();
  if (label.includes("plot synopsis") || label.includes("corpus synopsis") || label.includes("world overview")) return 0;
  if (label.includes("timeline")) return 1;
  return 2;
}

function collectNarrativeIndexEntries(planned: PlannedArtifactFile[]): IndexEntry[] {
  const entriesByKind = new Map<string, IndexEntry>();
  for (const entry of planned) {
    for (const kind of classifyNarrativeSurface(entry.artifact)) {
      if (entriesByKind.has(kind)) continue;
      entriesByKind.set(kind, {
        title: entry.artifact.title,
        targetPath: entry.relativePath,
        description: effectiveDescription(entry.artifact),
      });
    }
  }
  return [...entriesByKind.values()].sort((a, b) => narrativeSurfacePriority(a) - narrativeSurfacePriority(b) || a.title.localeCompare(b.title));
}

function planArtifactFiles(outputRoot: string, artifacts: ArtifactPacket[]): { planned: PlannedArtifactFile[]; relatedTargets: Record<string, string> } {
  const worldRoot = join(outputRoot, "world");
  const used = new Map<string, number>();
  const relatedTargets = new Map<string, string>();
  const planned = [...artifacts]
    .sort((a, b) => `${a.group}:${a.title}`.localeCompare(`${b.group}:${b.title}`))
    .map((artifact) => {
      const base = slugify(artifact.id || artifact.title);
      const count = used.get(`${artifact.group}/${base}`) ?? 0;
      used.set(`${artifact.group}/${base}`, count + 1);
      const relativePath = `${artifact.group}/${count === 0 ? base : `${base}-${count + 1}`}.md`;
      relatedTargets.set(artifact.id, relativePath);
      return { artifact, relativePath, file: join(worldRoot, relativePath) };
    });
  return { planned, relatedTargets: Object.fromEntries(relatedTargets) };
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

  const { planned: artifactFiles, relatedTargets } = planArtifactFiles(outputRoot, artifacts);
  const narrativeEntries = collectNarrativeIndexEntries(artifactFiles);
  const referencedUnitIds = new Set(artifacts.flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)));
  const sourceTargets = new Map<string, string>();
  const sourceEntries: Array<{ unitId: string; title: string; targetPath: string; description: string }> = [];
  const written: string[] = [];

  if (manifest) {
    for (const entry of manifest.units.filter((unit) => referencedUnitIds.has(unit.unitId))) {
      try {
        const unit = await readNormalizedUnit(outputRoot, entry.unitId);
        const relativePath = `sources/units/${entry.unitId}.md`;
        const file = join(worldRoot, relativePath);
        await writeFile(file, renderSourceUnitMarkdown(unit), "utf-8");
        sourceTargets.set(entry.unitId, relativePath);
        sourceEntries.push({
          unitId: entry.unitId,
          title: unit.title ?? unit.unitId,
          targetPath: relativePath,
          description: `Normalized source text for ${unit.title ?? unit.unitId}.`,
        });
        written.push(file);
      } catch {
        // Leave citations degraded if the normalized unit is unavailable.
      }
    }
  }

  const baseContext = {
    relatedTargets,
    sourceTargets: Object.fromEntries(sourceTargets),
  };

  const artifactEntriesByGroup = new Map<WorldImportGroup, IndexEntry[]>();
  for (const entry of artifactFiles) {
    await writeFile(entry.file, renderArtifactMarkdown(entry.artifact, { ...baseContext, currentRelativePath: entry.relativePath, currentArtifactId: entry.artifact.id }), "utf-8");
    const groupEntries = artifactEntriesByGroup.get(entry.artifact.group) ?? [];
    groupEntries.push({
      title: entry.artifact.title,
      targetPath: entry.relativePath,
      description: effectiveDescription(entry.artifact),
    });
    artifactEntriesByGroup.set(entry.artifact.group, groupEntries);
    written.push(entry.file);
  }

  const groupIndexEntries: IndexEntry[] = [];
  for (const group of groups) {
    const entries = artifactEntriesByGroup.get(group) ?? [];
    const relativePath = `${group}/index.md`;
    await writeFile(join(worldRoot, relativePath), renderIndex(group[0].toUpperCase() + group.slice(1), entries, relativePath), "utf-8");
    written.push(join(worldRoot, relativePath));
    groupIndexEntries.push({
      title: group[0].toUpperCase() + group.slice(1),
      targetPath: relativePath,
      description: `${entries.length} concept page(s).`,
    });
  }

  const sourcesIndexPath = join(worldRoot, "sources", "index.md");
  await writeFile(sourcesIndexPath, renderIndex("Sources", sourceEntries.map((entry) => ({ title: entry.title, targetPath: entry.targetPath, description: entry.description })), "sources/index.md"), "utf-8");
  written.push(sourcesIndexPath);

  const coverageEntries = sourceEntries.map((source) => ({
    unitTitle: source.title,
    unitTargetPath: source.targetPath,
    artifacts: artifactFiles
      .filter((entry) => entry.artifact.provenance.some((ref) => ref.unitId === source.unitId))
      .map((entry) => ({
        title: entry.artifact.title,
        targetPath: entry.relativePath,
        description: effectiveDescription(entry.artifact),
      })),
  }));
  const coveragePath = join(worldRoot, "coverage.md");
  await writeFile(coveragePath, renderCoverage(coverageEntries, "coverage.md"), "utf-8");
  written.push(coveragePath);

  const rootIndexPath = join(worldRoot, "index.md");
  await writeFile(rootIndexPath, renderRootIndex(groupIndexEntries, narrativeEntries, {
    title: "Sources",
    targetPath: "sources/index.md",
    description: `${sourceEntries.length} retained source-unit page(s).`,
  }, {
    title: "Source Coverage",
    targetPath: "coverage.md",
    description: "Maps retained source units to emitted concept pages.",
  }, "index.md"), "utf-8");
  written.push(rootIndexPath);

  const degradedCitationCount = artifacts.reduce((count, artifact) => count + artifact.provenance.filter((ref) => !sourceTargets.has(ref.unitId)).length, 0);
  const logPath = join(worldRoot, "log.md");
  await writeFile(logPath, renderLog(manifest?.createdAt ?? new Date().toISOString(), artifacts, sourceEntries.length, degradedCitationCount), "utf-8");
  written.push(logPath);

  return written;
}
