import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { makeBlocks, normalizeSourceBlockText, renderUnitContent, type SourceBlockInput } from "./spans.js";
import { diagnostic, ensureWorldImportDirs, normalizedUnitPath, writeManifest, writeNormalizedUnit } from "./staging.js";
import type { ManifestDiagnostic, NormalizedSourceUnit, SourceBlockKind, SourceKind, SourceManifest, SourceManifestEntry, SourceRole } from "./types.js";

const htmlExtensions = new Set([".html", ".htm", ".xhtml"]);
const archiveExtensions = new Set([".zip", ".epub"]);
const execFileAsync = promisify(execFile);

export type NormalizeOptions = {
  input: string;
  outputRoot: string;
  now?: Date;
};

const NORMALIZER_VERSION = 2;

function stableHash(text: string | Buffer, length = 10): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function sanitizeId(text: string): string {
  const sanitized = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return sanitized || "source";
}

function sourceIdFor(identityKey: string, labelKey = identityKey): string {
  return `${sanitizeId(labelKey)}-${stableHash(identityKey, 8)}`;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, raw: string) => {
    if (raw.startsWith("#x")) return String.fromCodePoint(Number.parseInt(raw.slice(2), 16));
    if (raw.startsWith("#")) return String.fromCodePoint(Number.parseInt(raw.slice(1), 10));
    return named[raw.toLowerCase()] ?? match;
  });
}

function attrValue(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

function normalizeTextFromHtml(inner: string, preserveLines: boolean): string {
  const withBreaks = inner
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, preserveLines ? "\n" : " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeSourceBlockText(decodeEntities(withBreaks), preserveLines);
}

function classifyBlock(tag: string, openTag: string): SourceBlockKind {
  const lowerTag = tag.toLowerCase();
  const className = attrValue(openTag, "class") ?? "";
  if (/poem|verse|stanza|linegroup|line-group/i.test(className)) return "poem";
  if (/^h[1-6]$/.test(lowerTag)) return "heading";
  if (lowerTag === "li") return "list-item";
  if (lowerTag === "blockquote") return "quote";
  if (lowerTag === "pre") return "pre";
  if (lowerTag === "p") return "paragraph";
  return "block";
}

function hasChildBlock(inner: string): boolean {
  return /<(h[1-6]|p|li|blockquote|pre)\b/i.test(inner);
}

export function htmlToTextBlocks(html: string): { title?: string; blocks: SourceBlockInput[] } {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const title = decodeEntities(withoutComments.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "") || undefined;
  const body = withoutComments
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ");

  const collected: Array<{ offset: number; text: string; kind: SourceBlockKind; sourceTag: string; sourceClass?: string }> = [];
  const collect = (pattern: RegExp, skipNestedWrapper: boolean) => {
    for (const match of body.matchAll(pattern)) {
      const openTag = match[0].slice(0, match[0].indexOf(">") + 1);
      const tag = match[1];
      const inner = match[2];
      const kind = classifyBlock(tag, openTag);
      const preserveLines = kind === "pre" || kind === "poem";
      if (skipNestedWrapper && kind === "block" && hasChildBlock(inner)) continue;
      const text = normalizeTextFromHtml(inner, preserveLines);
      if (!text) continue;
      const sourceClass = attrValue(openTag, "class");
      collected.push({
        offset: match.index ?? 0,
        text,
        kind,
        sourceTag: tag.toLowerCase(),
        ...(sourceClass ? { sourceClass } : {}),
      });
    }
  };

  // First collect semantic leaf blocks. Wrapper div/section/article extraction runs second and skips
  // regions that already contain leaf blocks so chapter containers do not swallow the whole chapter.
  collect(/<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi, false);
  collect(/<(div|section|article)\b[^>]*>([\s\S]*?)<\/\1>/gi, true);

  const blocks = collected
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset: _offset, ...block }) => block);

  if (blocks.length === 0) {
    const fallback = normalizeTextFromHtml(body, true).replace(/\s+/g, " ").trim();
    if (fallback) blocks.push({ text: fallback, kind: "block", sourceTag: "body" });
  }
  return { title, blocks };
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    if (entry.isFile()) return [path];
    return [];
  }));
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

async function archiveEntries(archivePath: string): Promise<string[]> {
  try {
    const listed = await execFileAsync("unzip", ["-Z1", archivePath], { encoding: "utf-8" });
    return listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unzip could not list archive";
    throw new Error(`Could not read archive ${archivePath}: ${detail}`);
  }
}

async function readArchiveEntry(archivePath: string, entry: string): Promise<string> {
  try {
    const read = await execFileAsync("unzip", ["-p", archivePath, entry], { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
    return read.stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unzip could not read entry";
    throw new Error(`Could not read archive entry ${entry} from ${archivePath}: ${detail}`);
  }
}

async function archiveContentHash(archivePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(archivePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex").slice(0, 16);
}

const xmlAttr = attrValue;

function xmlText(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : undefined;
}

type EpubInfo = {
  opfPath?: string;
  title?: string;
  author?: string;
  orderedEntries?: string[];
  roles: Map<string, SourceRole>;
  labels: Map<string, string>;
  diagnostics: ManifestDiagnostic[];
};

function classifyEntryRole(entry: string, properties?: string, mediaType?: string): SourceRole {
  const lower = entry.toLowerCase();
  const props = properties?.toLowerCase() ?? "";
  if (props.includes("nav") || /(^|\/)toc\b|table-of-contents|nav\./.test(lower)) return "toc";
  if (props.includes("cover") || mediaType?.startsWith("image/") || /cover/.test(lower)) return "cover";
  if (/copyright|license|colophon|appendix|notes|backmatter/.test(lower)) return "backmatter";
  if (/titlepage|frontmatter|preface|dedication|contents/.test(lower)) return "frontmatter";
  return "body";
}

async function readEpubInfo(archivePath: string, entries: string[]): Promise<EpubInfo | undefined> {
  if (!entries.includes("META-INF/container.xml")) return undefined;
  const diagnostics: ManifestDiagnostic[] = [];
  try {
    const container = await readArchiveEntry(archivePath, "META-INF/container.xml");
    const rootfileTag = container.match(/<rootfile\b[^>]*>/i)?.[0];
    const opfPath = rootfileTag ? xmlAttr(rootfileTag, "full-path") : undefined;
    if (!opfPath || !entries.includes(opfPath)) {
      diagnostics.push(diagnostic("warning", "EPUB container did not point to a readable OPF; falling back to archive HTML order", archivePath));
      return { roles: new Map(), labels: new Map(), diagnostics };
    }

    const opf = await readArchiveEntry(archivePath, opfPath);
    const manifest = new Map<string, { href: string; properties?: string; mediaType?: string }>();
    const roles = new Map<string, SourceRole>();
    const labels = new Map<string, string>();
    for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
      const id = xmlAttr(match[0], "id");
      const href = xmlAttr(match[0], "href");
      if (!id || !href) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(opfPath), href));
      const properties = xmlAttr(match[0], "properties");
      const mediaType = xmlAttr(match[0], "media-type");
      manifest.set(id, { href: resolved, properties, mediaType });
      roles.set(resolved, classifyEntryRole(resolved, properties, mediaType));
    }

    const orderedEntries: string[] = [];
    for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
      const idref = xmlAttr(match[0], "idref");
      const item = idref ? manifest.get(idref) : undefined;
      if (item?.href && entries.includes(item.href) && htmlExtensions.has(extname(item.href).toLowerCase())) orderedEntries.push(item.href);
    }

    const title = xmlText(opf, "dc:title") ?? xmlText(opf, "title");
    const author = xmlText(opf, "dc:creator") ?? xmlText(opf, "creator");

    const navEntry = [...manifest.values()].find((item) => item.properties?.toLowerCase().includes("nav"))?.href;
    if (navEntry && entries.includes(navEntry)) {
      try {
        const nav = await readArchiveEntry(archivePath, navEntry);
        for (const match of nav.matchAll(/<a\b[^>]*href=["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
          const href = posix.normalize(posix.join(posix.dirname(navEntry), decodeEntities(match[1])));
          const label = decodeEntities(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          if (label) labels.set(href, label);
        }
      } catch (error) {
        diagnostics.push(diagnostic("warning", `Could not parse EPUB nav labels: ${error instanceof Error ? error.message : String(error)}`, navEntry));
      }
    }

    return { opfPath, title, author, orderedEntries: orderedEntries.length > 0 ? orderedEntries : undefined, roles, labels, diagnostics };
  } catch (error) {
    diagnostics.push(diagnostic("warning", `Malformed EPUB metadata; falling back to archive HTML order: ${error instanceof Error ? error.message : String(error)}`, archivePath));
    return { roles: new Map(), labels: new Map(), diagnostics };
  }
}

async function orderedHtmlEntries(archivePath: string, entries: string[], diagnostics: ManifestDiagnostic[]): Promise<{ entries: string[]; epubInfo?: EpubInfo }> {
  const htmlEntries = entries.filter((entry) => htmlExtensions.has(extname(entry).toLowerCase()));
  const epubInfo = await readEpubInfo(archivePath, entries);
  if (epubInfo) diagnostics.push(...epubInfo.diagnostics);
  const spine = epubInfo?.orderedEntries;
  if (!spine) return { entries: htmlEntries, epubInfo };
  const spineSet = new Set(spine);
  return { entries: [...spine, ...htmlEntries.filter((entry) => !spineSet.has(entry))], epubInfo };
}

function createUnit(params: {
  identityKey: string;
  labelKey: string;
  displayPath: string;
  archivePath?: string;
  sourceEntryPath?: string;
  portableSourceKey?: string;
  archiveHash?: string;
  html: string;
  order: number;
  kind: SourceKind;
  role?: SourceRole;
  titleOverride?: string;
  metadata?: Record<string, unknown>;
}): NormalizedSourceUnit | undefined {
  const parsed = htmlToTextBlocks(params.html);
  const blocks = makeBlocks(parsed.blocks);
  if (blocks.length === 0) return undefined;
  const sourceId = sourceIdFor(params.identityKey, params.labelKey);
  const unitId = `${sourceId}-u001`;
  const content = renderUnitContent(blocks);
  return {
    sourceId,
    unitId,
    title: params.titleOverride ?? parsed.title,
    kind: params.kind,
    role: params.role ?? "body",
    inputPath: params.displayPath,
    archivePath: params.archivePath,
    sourceEntryPath: params.sourceEntryPath,
    portableSourceKey: params.portableSourceKey,
    archiveContentHash: params.archiveHash,
    order: params.order,
    sourceHash: stableHash(params.html, 16),
    contentHash: stableHash(content, 16),
    normalizerVersion: NORMALIZER_VERSION,
    content,
    blocks,
    metadata: params.metadata,
  };
}

async function collectUnits(inputPath: string, diagnostics: ManifestDiagnostic[]): Promise<NormalizedSourceUnit[]> {
  const absolute = resolve(inputPath);
  const inputStats = await stat(absolute);
  const units: NormalizedSourceUnit[] = [];
  let order = 0;

  const addHtmlFile = async (file: string, root: string) => {
    const rel = relative(root, file).split(sep).join("/");
    const html = await readFile(file, "utf-8");
    const unit = createUnit({ identityKey: `file:${rel}:${stableHash(html, 16)}`, labelKey: rel, displayPath: file, sourceEntryPath: rel, portableSourceKey: `file:${rel}`, html, order: order++, kind: extname(file).toLowerCase() === ".xhtml" ? "xhtml" : "html", role: "body" });
    if (unit) units.push(unit);
    else diagnostics.push(diagnostic("warning", "HTML source contained no text blocks", file));
  };

  const addArchive = async (file: string) => {
    const entries = await archiveEntries(file);
    const archiveHash = await archiveContentHash(file);
    const { entries: htmlEntries, epubInfo } = await orderedHtmlEntries(file, entries, diagnostics);
    for (const entry of entries) {
      if (!htmlExtensions.has(extname(entry).toLowerCase()) && !entry.endsWith("/")) diagnostics.push(diagnostic("info", "Skipped unsupported archive entry", `${file}!${entry}`));
    }
    for (const entry of htmlEntries) {
      const html = await readArchiveEntry(file, entry);
      const portableSourceKey = `archive:${archiveHash}!${entry}`;
      const role = epubInfo?.roles.get(entry) ?? classifyEntryRole(entry);
      const unit = createUnit({
        identityKey: portableSourceKey,
        labelKey: entry,
        displayPath: entry,
        archivePath: file,
        sourceEntryPath: entry,
        portableSourceKey,
        archiveHash,
        html,
        order: order++,
        kind: "archive-entry",
        role,
        titleOverride: epubInfo?.labels.get(entry),
        metadata: {
          ...(epubInfo?.title ? { sourceTitle: epubInfo.title } : {}),
          ...(epubInfo?.author ? { sourceAuthor: epubInfo.author } : {}),
          ...(epubInfo?.opfPath ? { opfPath: epubInfo.opfPath } : {}),
          localArchivePathDiagnostic: file,
        },
      });
      if (unit) units.push(unit);
      else diagnostics.push(diagnostic("warning", "Archive HTML entry contained no text blocks", `${file}!${entry}`));
    }
  };

  if (inputStats.isDirectory()) {
    for (const file of await walkFiles(absolute)) {
      const ext = extname(file).toLowerCase();
      if (htmlExtensions.has(ext)) await addHtmlFile(file, absolute);
      else if (archiveExtensions.has(ext)) await addArchive(file);
      else diagnostics.push(diagnostic("info", "Skipped unsupported file", file));
    }
  } else if (inputStats.isFile()) {
    const ext = extname(absolute).toLowerCase();
    if (htmlExtensions.has(ext)) await addHtmlFile(absolute, dirname(absolute));
    else if (archiveExtensions.has(ext)) await addArchive(absolute);
    else diagnostics.push(diagnostic("error", "Unsupported input file type", absolute));
  }

  return units.sort((a, b) => a.order - b.order);
}

export async function normalizeSources(options: NormalizeOptions): Promise<SourceManifest> {
  const inputRoot = resolve(options.input);
  const outputRoot = resolve(options.outputRoot);
  const diagnostics: ManifestDiagnostic[] = [];
  await ensureWorldImportDirs(outputRoot);
  const units = await collectUnits(inputRoot, diagnostics);
  if (units.length === 0 && !diagnostics.some((item) => item.level === "error")) diagnostics.push(diagnostic("warning", "No supported HTML/XHTML source units found", inputRoot));
  for (const unit of units) await writeNormalizedUnit(outputRoot, unit);
  const manifest: SourceManifest = {
    version: 1,
    createdAt: (options.now ?? new Date()).toISOString(),
    inputRoot,
    outputRoot,
    units: units.map((unit): SourceManifestEntry => ({
      sourceId: unit.sourceId,
      unitId: unit.unitId,
      title: unit.title,
      kind: unit.kind,
      role: unit.role,
      inputPath: unit.inputPath,
      archivePath: unit.archivePath,
      sourceEntryPath: unit.sourceEntryPath,
      portableSourceKey: unit.portableSourceKey,
      archiveContentHash: unit.archiveContentHash,
      order: unit.order,
      blockCount: unit.blocks.length,
      anchors: unit.blocks.map((block) => block.anchor),
      blockKinds: unit.blocks.map((block) => block.kind ?? "block"),
      normalizedPath: relative(outputRoot, normalizedUnitPath(outputRoot, unit.unitId)).split(sep).join("/"),
      sourceHash: unit.sourceHash,
      contentHash: unit.contentHash,
      normalizerVersion: unit.normalizerVersion,
      metadata: unit.metadata,
    })),
    diagnostics,
    metadata: { normalizerVersion: NORMALIZER_VERSION, localPathsAreDiagnostics: true },
  };
  await writeManifest(manifest);
  if (diagnostics.some((item) => item.level === "error")) {
    throw new Error(`Normalization failed: ${diagnostics.filter((item) => item.level === "error").map((item) => item.message).join("; ")}`);
  }
  return manifest;
}
