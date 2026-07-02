import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { normalizeSources } from "./world-import/normalize.js";
import { readSlice } from "./world-import/spans.js";
import { readNormalizedUnit } from "./world-import/staging.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-world-import-"));
}

test("normalizes an HTML directory into stable units and anchors", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.xhtml"), "<html><head><title>Chapter</title></head><body><p>Ada guards the tower.</p><p>The tower overlooks Moon Bay.</p></body></html>", "utf-8");
  await writeFile(join(input, "notes.txt"), "ignore me", "utf-8");

  const first = await normalizeSources({ input, outputRoot: output, now: new Date("2026-06-24T00:00:00.000Z") });
  const second = await normalizeSources({ input, outputRoot: output, now: new Date("2026-06-24T00:00:00.000Z") });

  assert.equal(first.units.length, 1);
  assert.equal(first.units[0].sourceId, second.units[0].sourceId);
  assert.deepEqual(first.units[0].anchors, ["b0001", "b0002"]);
  assert.ok(first.diagnostics.some((item) => item.message.includes("Skipped unsupported file")));

  const unit = await readNormalizedUnit(output, first.units[0].unitId);
  assert.match(unit.content, /\[b0001\] Ada guards/);
  assert.match(readSlice(unit, "b0002", "b0002"), /Moon Bay/);
  assert.equal(first.units[0].normalizedPath, `sources/normalized/${unit.unitId}.json`);
  assert.equal(first.units[0].sourceHash, unit.sourceHash);
  assert.equal(first.units[0].contentHash, unit.contentHash);
  assert.equal(first.units[0].normalizerVersion, 2);
});

test("preserves paragraph, poem, pre, and wrapper block boundaries", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), `<html><head><title>Chapter</title></head><body>
    <div class="chapter"><h1>Chapter One</h1><p>First paragraph.</p><p>Second paragraph.</p></div>
    <div class="poem">Will you walk a little faster?<br/>Said a whiting to a snail.</div>
    <pre>Mouse tail
      curls here</pre>
  </body></html>`, "utf-8");

  const manifest = await normalizeSources({ input, outputRoot: output });
  assert.equal(manifest.units[0].blockCount, 5);
  assert.deepEqual(manifest.units[0].blockKinds, ["heading", "paragraph", "paragraph", "poem", "pre"]);
  const unit = await readNormalizedUnit(output, manifest.units[0].unitId);
  assert.match(unit.blocks[3].text, /faster\?\nSaid a whiting/);
  assert.match(unit.blocks[4].text, /Mouse tail\n\s*curls here/);
  assert.doesNotMatch(unit.content, /First paragraph\. Second paragraph\. Will you walk/);
});

test("falls back to full-body extraction when no leaf blocks exist", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "loose.html"), "<html><body>Loose text <span>without semantic blocks</span>.</body></html>", "utf-8");
  const manifest = await normalizeSources({ input, outputRoot: output });
  assert.equal(manifest.units[0].blockCount, 1);
  const unit = await readNormalizedUnit(output, manifest.units[0].unitId);
  assert.match(unit.content, /Loose text without semantic blocks/);
});

test("normalizes an EPUB-style archive when zip tooling is available", async (t) => {
  const zipCheck = spawnSync("zip", ["-v"], { encoding: "utf-8" });
  const unzipCheck = spawnSync("unzip", ["-v"], { encoding: "utf-8" });
  if (zipCheck.status !== 0 || unzipCheck.status !== 0) {
    t.skip("zip/unzip not available");
    return;
  }

  const root = await tempDir();
  const archiveRoot = join(root, "archive-root", "OEBPS");
  await mkdir(archiveRoot, { recursive: true });
  await mkdir(join(root, "archive-root", "META-INF"), { recursive: true });
  await writeFile(join(archiveRoot, "z-last.xhtml"), "<html><body><p>Rin starts with the silver compass.</p></body></html>", "utf-8");
  await writeFile(join(archiveRoot, "a-first.xhtml"), "<html><body><p>Rin ends at the obsidian gate.</p></body></html>", "utf-8");
  await writeFile(join(root, "archive-root", "META-INF", "container.xml"), "<container><rootfiles><rootfile full-path=\"OEBPS/content.opf\"/></rootfiles></container>", "utf-8");
  await writeFile(join(archiveRoot, "nav.xhtml"), `<html><body><nav><ol><li><a href="z-last.xhtml">Opening by Nav</a></li><li><a href="a-first.xhtml">Ending by Nav</a></li></ol></nav></body></html>`, "utf-8");
  await writeFile(join(archiveRoot, "content.opf"), `<package><metadata><dc:title>A Portable Book</dc:title><dc:creator>R. Writer</dc:creator></metadata><manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="last" href="z-last.xhtml" media-type="application/xhtml+xml"/>
    <item id="first" href="a-first.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="last"/><itemref idref="first"/></spine></package>`, "utf-8");
  await writeFile(join(root, "archive-root", "mimetype"), "application/epub+zip", "utf-8");
  const archive = join(root, "book.epub");
  const zipped = spawnSync("zip", ["-qr", archive, "."], { cwd: join(root, "archive-root"), encoding: "utf-8" });
  assert.equal(zipped.status, 0, zipped.stderr);

  const manifest = await normalizeSources({ input: archive, outputRoot: join(root, "output") });
  assert.equal(manifest.units.length, 3);
  assert.equal(manifest.units[0].kind, "archive-entry");
  assert.match(manifest.units[0].inputPath, /z-last\.xhtml$/);
  assert.match(manifest.units[1].inputPath, /a-first\.xhtml$/);
  assert.equal(manifest.units[2].role, "toc");
  assert.equal(manifest.units[0].title, "Opening by Nav");
  assert.equal(manifest.units[0].metadata?.sourceTitle, "A Portable Book");
  assert.equal(manifest.units[0].metadata?.sourceAuthor, "R. Writer");
  const normalized = await readFile(join(root, "output", manifest.units[0].normalizedPath), "utf-8");
  assert.match(normalized, /silver compass/);
  assert.equal(manifest.units[0].normalizerVersion, 2);
  assert.match(manifest.units[0].sourceHash, /^[a-f0-9]{16}$/);
  assert.match(manifest.units[0].contentHash, /^[a-f0-9]{16}$/);

  const moved = join(root, "moved-book.epub");
  await copyFile(archive, moved);
  const movedManifest = await normalizeSources({ input: moved, outputRoot: join(root, "moved-output") });
  assert.equal(movedManifest.units[0].sourceId, manifest.units[0].sourceId);
  assert.equal(movedManifest.units[0].portableSourceKey, manifest.units[0].portableSourceKey);
});
