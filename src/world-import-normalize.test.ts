import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
  await writeFile(join(archiveRoot, "content.opf"), `<package><manifest>
    <item id="last" href="z-last.xhtml" media-type="application/xhtml+xml"/>
    <item id="first" href="a-first.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="last"/><itemref idref="first"/></spine></package>`, "utf-8");
  await writeFile(join(root, "archive-root", "mimetype"), "application/epub+zip", "utf-8");
  const archive = join(root, "book.epub");
  const zipped = spawnSync("zip", ["-qr", archive, "."], { cwd: join(root, "archive-root"), encoding: "utf-8" });
  assert.equal(zipped.status, 0, zipped.stderr);

  const manifest = await normalizeSources({ input: archive, outputRoot: join(root, "output") });
  assert.equal(manifest.units.length, 2);
  assert.equal(manifest.units[0].kind, "archive-entry");
  assert.match(manifest.units[0].inputPath, /z-last\.xhtml$/);
  assert.match(manifest.units[1].inputPath, /a-first\.xhtml$/);
  const normalized = await readFile(manifest.units[0].normalizedPath, "utf-8");
  assert.match(normalized, /silver compass/);
});
