import { existsSync } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { MEM_IMPORT_GROUPS, type ArtifactPacket, type MarkdownSection, type MemImportRunAudit, type NormalizedSourceUnit, type SourceManifest, type SourceSpanRef, type MemImportGroup } from "./contracts.js";
import { classifyNarrativeSurface } from "./narrative-surfaces.js";
import { readImportRun, readManifest, readMergeStage, readNormalizedUnit, validateStageEnvelope } from "./stage-store.js";
import { authoredMarkdownMarkers } from "./markdown-markers.js";
import { PROJECTION_OWNERSHIP_FILENAME, readProjectionOwnership, validateProjectionOwnership } from "./projection-ownership.js";
import { assertNoSymlinkedPathComponents } from "./path-safety.js";

const groups = [...MEM_IMPORT_GROUPS];
const defaultTypes: Record<MemImportGroup, string> = {
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

function assertRelativeProjectionPath(projectionRoot: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error(`Invalid projected path ${relativePath}`);
  const file = resolve(projectionRoot, relativePath);
  if (file !== resolve(projectionRoot) && !file.startsWith(`${resolve(projectionRoot)}/`)) throw new Error(`Projected path escapes output root: ${relativePath}`);
  return file;
}

async function assertNoSymlinkedProjectionAncestors(projectionRoot: string): Promise<void> {
  await assertNoSymlinkedPathComponents(projectionRoot, {
    includeLeaf: false,
    onSymlink: (path) => new Error(`Refusing symlinked managed projection ancestor: ${path}`),
  });
}

async function assertProjectionRoot(projectionRoot: string): Promise<void> {
  const root = resolve(projectionRoot);
  await assertNoSymlinkedProjectionAncestors(root);
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new Error(`Refusing symlinked managed projection root: ${projectionRoot}`);
  if (!info.isDirectory()) throw new Error(`Projection root is not a directory: ${projectionRoot}`);
}

/**
 * The retired emitter wrote concept pages below outputRoot/world/. The current
 * projection owns only root-level generated paths, so unknown content there
 * must be migrated or removed explicitly rather than copied, traversed, or
 * deleted by cleanup.
 */
async function assertNoRetiredNestedProjection(projectionRoot: string): Promise<void> {
  const retiredPath = join(resolve(projectionRoot), "world");
  try {
    await lstat(retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing to use output root with retired nested projection at ${retiredPath}. Migrate any needed content, then remove this directory (or symlink) manually; mem-import will not follow or delete it.`);
}

async function assertNoSymlinkPath(projectionRoot: string, relativePath: string, includeLeaf = true): Promise<void> {
  const path = resolve(projectionRoot, relativePath);
  await assertNoSymlinkedPathComponents(path, {
    includeLeaf,
    requireDirectories: true,
    onSymlink: (component) => new Error(`Refusing symlinked managed projection path component: ${component}`),
    onNonDirectory: (component) => new Error(`Managed projection path component is not a directory: ${component}`),
  });
}

async function ensureManagedDirectory(projectionRoot: string, relativePath: string): Promise<void> {
  assertRelativeProjectionPath(projectionRoot, relativePath);
  const parts = relativePath.split("/");
  let current = resolve(projectionRoot);
  await assertNoSymlinkPath(projectionRoot, relativePath, false);
  for (const part of parts) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Refusing symlinked managed projection directory: ${current}`);
      if (!info.isDirectory()) throw new Error(`Managed projection path is not a directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { recursive: false });
    }
  }
}

async function writeAtomicProjectionFile(projectionRoot: string, relativePath: string, content: string): Promise<string> {
  const file = assertRelativeProjectionPath(projectionRoot, relativePath);
  await assertNoSymlinkPath(projectionRoot, relativePath, true);
  const parentRelativePath = dirname(relativePath);
  if (parentRelativePath === ".") {
    await assertProjectionRoot(projectionRoot);
  } else {
    await ensureManagedDirectory(projectionRoot, parentRelativePath);
  }
  // Re-check the actual parent immediately before creating a temp.
  const parent = dirname(file);
  await assertNoSymlinkPath(projectionRoot, relativePath, false);
  const temporary = join(parent, `.${relativePath.split("/").pop()!}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // rename replaces a destination entry; it never follows a destination
    // symlink. The lstat check above rejects one already present.
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return file;
}

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

/** Render model-authored index metadata as text, never as additional Markdown. */
function safeInlineText(text: string): string {
  return text.replace(/[\\`*_[\]<>~()]/g, (character) => `\\${character}`).replace(/\r?\n/g, " ");
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

function renderInlineArtifactLinks(text: string, context: EmitContext): string {
  let output = "";
  let cursor = 0;
  for (const token of authoredMarkdownMarkers(text)) {
    output += text.slice(cursor, token.start);
    const targetPath = context.relatedTargets[token.targetId];
    if (!targetPath) output += token.text;
    else if (context.currentArtifactId === token.targetId) output += token.label;
    else output += `[${token.label}](${relativeLink(context.currentRelativePath, targetPath)})`;
    cursor = token.end;
  }
  return output + text.slice(cursor);
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
  if (entries.length === 0) return `# ${safeInlineText(title)}\n\n_No entries._\n`;
  return `# ${safeInlineText(title)}\n\n${entries.map((entry) => `- [${safeInlineText(entry.title)}](${relativeLink(currentRelativePath, entry.targetPath)}) - ${safeInlineText(entry.description)}`).join("\n")}\n`;
}

function renderRootIndex(groupEntries: IndexEntry[], narrativeEntries: IndexEntry[], sourceEntry: IndexEntry, coverageEntry: IndexEntry, currentRelativePath: string): string {
  return [
    "# Compendium Index",
    "",
    ...(narrativeEntries.length > 0
      ? [
          "## Plot and Reading Order",
          ...narrativeEntries.map((entry) => `- [${safeInlineText(entry.title)}](${relativeLink(currentRelativePath, entry.targetPath)}) - ${safeInlineText(entry.description)}`),
          "",
        ]
      : []),
    "## Groups",
    ...groupEntries.map((entry) => `- [${safeInlineText(entry.title)}](${relativeLink(currentRelativePath, entry.targetPath)}) - ${safeInlineText(entry.description)}`),
    "",
    "## Sources",
    `- [${safeInlineText(sourceEntry.title)}](${relativeLink(currentRelativePath, sourceEntry.targetPath)}) - ${safeInlineText(sourceEntry.description)}`,
    "",
    "## Coverage",
    `- [${safeInlineText(coverageEntry.title)}](${relativeLink(currentRelativePath, coverageEntry.targetPath)}) - ${safeInlineText(coverageEntry.description)}`,
    "",
  ].join("\n");
}

function renderAuditLog(audit: MemImportRunAudit | undefined, auditPathPrefix: string): string[] {
  if (!audit) return [];
  return [
    "## Import Details",
    "",
    `- **Run:** \`${audit.runId}\``,
    `- **Source units:** ${audit.source.normalizedUnits}`,
    ...(audit.merge ? [`- **Canonical merge:** revision ${audit.merge.revision}, \`${audit.merge.contentHash}\``] : []),
    `- **Result:** ${audit.status}${audit.finalization ? `; ${audit.finalization.errorCount} error(s), ${audit.finalization.warningCount} warning(s)` : ""}`,
    ...(audit.usage ? [`- **Model usage:** ${audit.usage.availability}; ${audit.usage.totals.totalTokens ?? "unavailable"} total tokens; ${audit.usage.totals.cost.total ?? "unavailable"} provider-reported cost across ${audit.usage.recordCount} session record(s)`] : []),
    `- **Audit record:** [\`stages/import-run.json\`](${auditPathPrefix}/import-run.json)`,
    "",
    "## Durable Evidence",
    "",
    ...audit.effects.map((effect) => `- \`${effect.kind}\`: [\`${effect.path}\`](${auditPathPrefix === "stages" ? effect.path : `${auditPathPrefix}/${effect.path}`}) — \`${effect.contentHash}\``),
    "",
  ];
}

function renderLog(createdAt: string, artifacts: ArtifactPacket[], sourceCount: number, degradedCitationCount: number, audit?: MemImportRunAudit, auditPathPrefix = "../stages"): string {
  const date = createdAt.slice(0, 10);
  const groupCounts = groups.map((group) => `${group}: ${artifacts.filter((artifact) => artifact.group === group).length}`).join(", ");
  return [
    "# Compendium Update Log",
    "",
    `## ${date}`,
    `* **Emit**: Generated ${artifacts.length} concept page(s) across ${groupCounts}.`,
    `* **Sources**: Retained ${sourceCount} source-unit page(s) for provenance inspection.`,
    `* **Citations**: ${degradedCitationCount === 0 ? "All emitted provenance links resolved within the bundle." : `${degradedCitationCount} provenance citation(s) were degraded because source targets were unavailable.`}`,
    "",
    ...renderAuditLog(audit, auditPathPrefix),
  ].join("\n");
}

function renderCoverage(entries: Array<{ unitTitle: string; unitTargetPath: string; artifacts: IndexEntry[] }>, currentRelativePath: string): string {
  if (entries.length === 0) return "# Source Coverage\n\n_No source coverage entries._\n";
  return [
    "# Source Coverage",
    "",
    ...entries.flatMap((entry) => [
      `## [${safeInlineText(entry.unitTitle)}](${relativeLink(currentRelativePath, entry.unitTargetPath)})`,
      "",
      ...(entry.artifacts.length > 0 ? entry.artifacts.map((artifact) => `- [${safeInlineText(artifact.title)}](${relativeLink(currentRelativePath, artifact.targetPath)}) - ${safeInlineText(artifact.description)}`) : ["- No emitted concept pages cite this source unit."]),
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

function planArtifactFiles(projectionRoot: string, artifacts: ArtifactPacket[]): { planned: PlannedArtifactFile[]; relatedTargets: Record<string, string> } {
  const used = new Map<MemImportGroup, Set<string>>(groups.map((group) => [group, new Set(["index"])]));
  const relatedTargets = new Map<string, string>();
  const planned = [...artifacts]
    .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((artifact) => {
      const names = used.get(artifact.group)!;
      const base = slugify(artifact.id || artifact.title);
      let candidate = base;
      let suffix = 2;
      while (names.has(candidate)) candidate = `${base}-${suffix++}`;
      names.add(candidate);
      const relativePath = `${artifact.group}/${candidate}.md`;
      relatedTargets.set(artifact.id, relativePath);
      return { artifact, relativePath, file: join(projectionRoot, relativePath) };
    });
  return { planned, relatedTargets: Object.fromEntries(relatedTargets) };
}

async function removeOwnedMarkdownFile(projectionRoot: string, relativePath: string): Promise<void> {
  const file = assertRelativeProjectionPath(projectionRoot, relativePath);
  await assertNoSymlinkPath(projectionRoot, relativePath, true);
  try { await unlink(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function assertProjectionDestination(projectionRoot: string, relativePath: string, owned: Set<string>): Promise<void> {
  const file = assertRelativeProjectionPath(projectionRoot, relativePath);
  await assertNoSymlinkPath(projectionRoot, relativePath, true);
  try {
    const info = await lstat(file);
    if (!info.isFile()) throw new Error(`Projected destination is not a regular file: ${relativePath}`);
    if (!owned.has(relativePath)) throw new Error(`Refusing to overwrite unowned Markdown projection file: ${relativePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Check every path before touching the old projection. In particular, stale
 * owned entries are checked too: cleanup must never be the first operation to
 * discover a symlink or a directory where a generated file was expected.
 */
async function preflightProjection(projectionRoot: string, plannedPaths: string[], ownedBefore: Set<string>): Promise<void> {
  for (const group of groups) await assertNoSymlinkPath(projectionRoot, group, false);
  await assertNoSymlinkPath(projectionRoot, "sources/units", false);
  const paths = new Set([...ownedBefore, ...plannedPaths]);
  for (const relativePath of paths) await assertProjectionDestination(projectionRoot, relativePath, ownedBefore);
}

async function sourcePageIsOwnedFile(projectionRoot: string, ownership: Set<string>, unitId: string): Promise<boolean> {
  const relativePath = `sources/units/${unitId}.md`;
  if (!ownership.has(relativePath)) return false;
  await assertNoSymlinkPath(projectionRoot, relativePath, true);
  try {
    const info = await lstat(join(projectionRoot, relativePath));
    if (!info.isFile()) throw new Error(`Owned source projection path is not a regular file: ${relativePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export type ProjectionEmitOptions = {
  /** Deterministic post-write failure injection for retry-recovery tests. */
  failAfterWrites?: number;
};

export async function emitMemImportProjection(outputRoot: string, options: ProjectionEmitOptions = {}): Promise<string[]> {
  const projectionRoot = outputRoot;
  await assertProjectionRoot(projectionRoot);
  await assertNoRetiredNestedProjection(projectionRoot);
  const merge = await readMergeStage(outputRoot);
  validateStageEnvelope(merge, { requireArtifacts: true });
  const artifacts = merge.artifacts ?? [];
  const manifest = await loadManifestIfPresent(outputRoot);
  const priorOwnership = await readProjectionOwnership(projectionRoot);
  const ownedBefore = new Set(priorOwnership?.files ?? []);
  const audit = await readImportRun(outputRoot);
  const { planned: artifactFiles, relatedTargets } = planArtifactFiles(projectionRoot, artifacts);
  const narrativeEntries = collectNarrativeIndexEntries(artifactFiles);
  const referencedUnitIds = new Set(artifacts.flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)));
  const sourceTargets = new Map<string, string>();
  const sourceEntries: Array<{ unitId: string; title: string; targetPath: string; description: string }> = [];
  const contents = new Map<string, string>();
  const addContent = (relativePath: string, content: string): void => {
    assertRelativeProjectionPath(projectionRoot, relativePath);
    if (contents.has(relativePath)) throw new Error(`Duplicate projected destination ${relativePath}`);
    contents.set(relativePath, content);
  };

  // Read every cited normalized unit before the ownership transaction. Only a
  // genuinely absent normalized JSON is degraded; malformed or failed reads
  // must abort the update rather than being mistaken for missing provenance.
  if (manifest) {
    for (const entry of manifest.units.filter((unit) => referencedUnitIds.has(unit.unitId))) {
      let unit: NormalizedSourceUnit;
      const normalizedRelativePath = `sources/normalized/${entry.unitId}.json`;
      const normalizedPath = assertRelativeProjectionPath(projectionRoot, normalizedRelativePath);
      try {
        await assertNoSymlinkedPathComponents(normalizedPath, {
          requireDirectories: true,
          onSymlink: (path) => new Error(`Refusing symlinked normalized source path component: ${path}`),
        });
        const info = await lstat(normalizedPath);
        if (info.isSymbolicLink()) throw new Error(`Refusing symlinked normalized source unit: ${normalizedRelativePath}`);
        if (!info.isFile()) throw new Error(`Normalized source unit is not a regular file: ${normalizedRelativePath}`);
        unit = await readNormalizedUnit(outputRoot, entry.unitId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const relativePath = `sources/units/${entry.unitId}.md`;
      sourceTargets.set(entry.unitId, relativePath);
      sourceEntries.push({ unitId: entry.unitId, title: unit.title ?? unit.unitId, targetPath: relativePath, description: `Normalized source text for ${unit.title ?? unit.unitId}.` });
      addContent(relativePath, renderSourceUnitMarkdown(unit));
    }
  }

  const baseContext = { relatedTargets, sourceTargets: Object.fromEntries(sourceTargets) };
  const artifactEntriesByGroup = new Map<MemImportGroup, IndexEntry[]>();
  for (const entry of artifactFiles) {
    addContent(entry.relativePath, renderArtifactMarkdown(entry.artifact, { ...baseContext, currentRelativePath: entry.relativePath, currentArtifactId: entry.artifact.id }));
    const groupEntries = artifactEntriesByGroup.get(entry.artifact.group) ?? [];
    groupEntries.push({ title: entry.artifact.title, targetPath: entry.relativePath, description: effectiveDescription(entry.artifact) });
    artifactEntriesByGroup.set(entry.artifact.group, groupEntries);
  }

  const groupIndexEntries: IndexEntry[] = [];
  for (const group of groups) {
    const entries = artifactEntriesByGroup.get(group) ?? [];
    const relativePath = `${group}/index.md`;
    addContent(relativePath, renderIndex(group[0].toUpperCase() + group.slice(1), entries, relativePath));
    groupIndexEntries.push({ title: group[0].toUpperCase() + group.slice(1), targetPath: relativePath, description: `${entries.length} concept page(s).` });
  }
  const sourcesIndexPath = "sources/index.md";
  addContent(sourcesIndexPath, renderIndex("Sources", sourceEntries.map((entry) => ({ title: entry.title, targetPath: entry.targetPath, description: entry.description })), sourcesIndexPath));
  const coverageEntries = sourceEntries.map((source) => ({
    unitTitle: source.title,
    unitTargetPath: source.targetPath,
    artifacts: artifactFiles.filter((entry) => entry.artifact.provenance.some((ref) => ref.unitId === source.unitId)).map((entry) => ({ title: entry.artifact.title, targetPath: entry.relativePath, description: effectiveDescription(entry.artifact) })),
  }));
  addContent("coverage.md", renderCoverage(coverageEntries, "coverage.md"));
  addContent("index.md", renderRootIndex(groupIndexEntries, narrativeEntries, { title: "Sources", targetPath: "sources/index.md", description: `${sourceEntries.length} retained source-unit page(s).` }, { title: "Source Coverage", targetPath: "coverage.md", description: "Maps retained source units to emitted concept pages." }, "index.md"));
  const degradedCitationCount = artifacts.reduce((count, artifact) => count + artifact.provenance.filter((ref) => !sourceTargets.has(ref.unitId)).length, 0);
  const auditPathPrefix = projectionRoot === outputRoot ? "stages" : "../stages";
  addContent("log.md", renderLog(manifest?.createdAt ?? new Date().toISOString(), artifacts, sourceEntries.length, degradedCitationCount, audit, auditPathPrefix));

  const plannedPaths = [...contents.keys()];
  await preflightProjection(projectionRoot, plannedPaths, ownedBefore);
  const provisionalOwnership = validateProjectionOwnership({ version: 1, kind: "mem-import-projection-ownership", files: [...ownedBefore, ...plannedPaths] });
  // Persist the union first. If any later write fails, a retry recognizes every
  // destination touched by this attempt as owned without deleting old output.
  await writeAtomicProjectionFile(projectionRoot, PROJECTION_OWNERSHIP_FILENAME, `${JSON.stringify(provisionalOwnership, null, 2)}\n`);

  let writes = 0;
  const writeFile = async (relativePath: string, content: string): Promise<string> => {
    const writtenFile = await writeAtomicProjectionFile(projectionRoot, relativePath, content);
    writes += 1;
    if (options.failAfterWrites !== undefined && writes === options.failAfterWrites) throw new Error(`Injected projection write failure after ${writes} write(s)`);
    return writtenFile;
  };
  const written: string[] = [];
  for (const [relativePath, content] of contents) written.push(await writeFile(relativePath, content));
  for (const relativePath of ownedBefore) if (!contents.has(relativePath)) await removeOwnedMarkdownFile(projectionRoot, relativePath);
  const ownership = validateProjectionOwnership({ version: 1, kind: "mem-import-projection-ownership", files: plannedPaths });
  await writeFile(PROJECTION_OWNERSHIP_FILENAME, `${JSON.stringify(ownership, null, 2)}\n`);
  return written;
}

/** Refresh only execution metadata after orchestration; concept pages are not re-emitted. */
export async function refreshMemImportLog(outputRoot: string): Promise<void> {
  const projectionRoot = outputRoot;
  await assertProjectionRoot(projectionRoot);
  await assertNoRetiredNestedProjection(projectionRoot);
  const merge = await readMergeStage(outputRoot);
  validateStageEnvelope(merge, { requireArtifacts: true });
  const manifest = await loadManifestIfPresent(outputRoot);
  const artifacts = merge.artifacts ?? [];
  const referencedUnitIds = new Set(artifacts.flatMap((artifact) => artifact.provenance.map((ref) => ref.unitId)));
  const ownership = await readProjectionOwnership(projectionRoot);
  if (!ownership?.files.includes("log.md")) throw new Error("Cannot refresh an unowned mem-import projection log");
  const ownedFiles = new Set(ownership.files);
  const availableSourceUnits = new Set<string>();
  for (const unitId of referencedUnitIds) if (await sourcePageIsOwnedFile(projectionRoot, ownedFiles, unitId)) availableSourceUnits.add(unitId);
  const sourceCount = availableSourceUnits.size;
  const degradedCitationCount = artifacts.reduce((count, artifact) => count + artifact.provenance.filter((ref) => !availableSourceUnits.has(ref.unitId)).length, 0);
  const auditPathPrefix = projectionRoot === outputRoot ? "stages" : "../stages";
  await assertNoSymlinkPath(projectionRoot, "log.md", true);
  await writeAtomicProjectionFile(projectionRoot, "log.md", renderLog(manifest?.createdAt ?? new Date().toISOString(), artifacts, sourceCount, degradedCitationCount, await readImportRun(outputRoot), auditPathPrefix));
}
