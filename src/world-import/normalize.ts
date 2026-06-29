import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { makeBlocks, renderUnitContent } from "./spans.js";
import { diagnostic, ensureWorldImportDirs, normalizedUnitPath, writeManifest, writeNormalizedUnit } from "./staging.js";
import type { ManifestDiagnostic, NormalizedSourceUnit, SourceKind, SourceManifest, SourceManifestEntry } from "./types.js";

const htmlExtensions = new Set([".html", ".htm", ".xhtml"]);
const archiveExtensions = new Set([".zip", ".epub"]);
const execFileAsync = promisify(execFile);

export type NormalizeOptions = {
  input: string;
  outputRoot: string;
  now?: Date;
};

const NORMALIZER_VERSION = 1;

function stableHash(text: string, length = 10): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function sanitizeId(text: string): string {
  const sanitized = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return sanitized || "source";
}

function sourceIdFor(pathKey: string): string {
  return `${sanitizeId(pathKey)}-${stableHash(pathKey, 8)}`;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, raw: string) => {
    if (raw.startsWith("#x")) return String.fromCodePoint(Number.parseInt(raw.slice(2), 16));
    if (raw.startsWith("#")) return String.fromCodePoint(Number.parseInt(raw.slice(1), 10));
    return named[raw.toLowerCase()] ?? match;
  });
}

export function htmlToTextBlocks(html: string): { title?: string; blocks: string[] } {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const title = decodeEntities(withoutComments.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "") || undefined;
  const body = withoutComments
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ");
  const candidates: string[] = [];
  const blockPattern = /<(h[1-6]|p|li|blockquote|pre|div|section|article)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of body.matchAll(blockPattern)) {
    const text = decodeEntities(match[2].replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (text) candidates.push(text);
  }
  if (candidates.length === 0) {
    const fallback = decodeEntities(body.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (fallback) candidates.push(fallback);
  }
  return { title, blocks: candidates };
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

function xmlAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

async function epubSpineOrder(archivePath: string, entries: string[]): Promise<string[] | undefined> {
  if (!entries.includes("META-INF/container.xml")) return undefined;
  const container = await readArchiveEntry(archivePath, "META-INF/container.xml");
  const rootfileTag = container.match(/<rootfile\b[^>]*>/i)?.[0];
  const opfPath = rootfileTag ? xmlAttr(rootfileTag, "full-path") : undefined;
  if (!opfPath || !entries.includes(opfPath)) return undefined;

  const opf = await readArchiveEntry(archivePath, opfPath);
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = xmlAttr(match[0], "id");
    const href = xmlAttr(match[0], "href");
    if (id && href) manifest.set(id, posix.normalize(posix.join(posix.dirname(opfPath), href)));
  }

  const ordered: string[] = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = xmlAttr(match[0], "idref");
    const href = idref ? manifest.get(idref) : undefined;
    if (href && entries.includes(href) && htmlExtensions.has(extname(href).toLowerCase())) ordered.push(href);
  }
  return ordered.length > 0 ? ordered : undefined;
}

async function orderedHtmlEntries(archivePath: string, entries: string[]): Promise<string[]> {
  const htmlEntries = entries.filter((entry) => htmlExtensions.has(extname(entry).toLowerCase()));
  const spine = await epubSpineOrder(archivePath, entries);
  if (!spine) return htmlEntries;
  const spineSet = new Set(spine);
  return [...spine, ...htmlEntries.filter((entry) => !spineSet.has(entry))];
}

function createUnit(params: { pathKey: string; displayPath: string; archivePath?: string; html: string; order: number; kind: SourceKind }): NormalizedSourceUnit | undefined {
  const parsed = htmlToTextBlocks(params.html);
  const blocks = makeBlocks(parsed.blocks);
  if (blocks.length === 0) return undefined;
  const sourceId = sourceIdFor(params.pathKey);
  const unitId = `${sourceId}-u001`;
  const content = renderUnitContent(blocks);
  return {
    sourceId,
    unitId,
    title: parsed.title,
    kind: params.kind,
    inputPath: params.displayPath,
    archivePath: params.archivePath,
    order: params.order,
    sourceHash: stableHash(params.html, 16),
    contentHash: stableHash(content, 16),
    normalizerVersion: NORMALIZER_VERSION,
    content,
    blocks,
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
    const unit = createUnit({ pathKey: rel, displayPath: file, html, order: order++, kind: extname(file).toLowerCase() === ".xhtml" ? "xhtml" : "html" });
    if (unit) units.push(unit);
    else diagnostics.push(diagnostic("warning", "HTML source contained no text blocks", file));
  };

  const addArchive = async (file: string) => {
    const entries = await archiveEntries(file);
    const htmlEntries = await orderedHtmlEntries(file, entries);
    for (const entry of entries) {
      if (!htmlExtensions.has(extname(entry).toLowerCase()) && !entry.endsWith("/")) diagnostics.push(diagnostic("info", "Skipped unsupported archive entry", `${file}!${entry}`));
    }
    const htmlTexts = await Promise.all(htmlEntries.map((entry) => readArchiveEntry(file, entry)));
    for (const [index, entry] of htmlEntries.entries()) {
      const unit = createUnit({ pathKey: `${relative(process.cwd(), file).split(sep).join("/")}!${entry}`, displayPath: entry, archivePath: file, html: htmlTexts[index], order: order++, kind: "archive-entry" });
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
      inputPath: unit.inputPath,
      archivePath: unit.archivePath,
      order: unit.order,
      blockCount: unit.blocks.length,
      anchors: unit.blocks.map((block) => block.anchor),
      normalizedPath: relative(outputRoot, normalizedUnitPath(outputRoot, unit.unitId)).split(sep).join("/"),
      sourceHash: unit.sourceHash,
      contentHash: unit.contentHash,
      normalizerVersion: unit.normalizerVersion,
    })),
    diagnostics,
  };
  await writeManifest(manifest);
  if (diagnostics.some((item) => item.level === "error")) {
    throw new Error(`Normalization failed: ${diagnostics.filter((item) => item.level === "error").map((item) => item.message).join("; ")}`);
  }
  return manifest;
}
