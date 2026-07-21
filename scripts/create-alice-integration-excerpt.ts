#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "samples/Alice_Adventures_in_Wonderland.epub");
const output = resolve(process.argv[3] ?? ".memchat-agent-testing/fixtures/alice-chapters-1-3.epub");
const chapterBase = "7126951391209738045_11-h";
const retainedEntries = [
  "OEBPS/7433694763631080598_cover.jpg",
  "OEBPS/pgepub.css",
  "OEBPS/0.css",
  ...[1, 2, 3].map((chapter) => `OEBPS/${chapterBase}-${chapter}.htm.html`),
];

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata>
    <dc:identifier opf:scheme="URI" id="id">urn:memchat:alice-integration-excerpt:chapters-1-3</dc:identifier>
    <dc:creator opf:file-as="Carroll, Lewis">Lewis Carroll</dc:creator>
    <dc:title>Alice's Adventures in Wonderland — Chapters I–III Integration Excerpt</dc:title>
    <dc:language>en</dc:language>
    <dc:rights>Public domain in the USA.</dc:rights>
  </metadata>
  <manifest>
    <item href="7433694763631080598_cover.jpg" id="cover" media-type="image/jpeg"/>
    <item href="pgepub.css" id="css1" media-type="text/css"/>
    <item href="0.css" id="css2" media-type="text/css"/>
    <item href="${chapterBase}-1.htm.html" id="chapter-1" media-type="application/xhtml+xml"/>
    <item href="${chapterBase}-2.htm.html" id="chapter-2" media-type="application/xhtml+xml"/>
    <item href="${chapterBase}-3.htm.html" id="chapter-3" media-type="application/xhtml+xml"/>
    <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-1" linear="yes"/>
    <itemref idref="chapter-2" linear="yes"/>
    <itemref idref="chapter-3" linear="yes"/>
  </spine>
</package>
`;

const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="en">
  <head>
    <meta name="dtb:uid" content="urn:memchat:alice-integration-excerpt:chapters-1-3"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>Alice's Adventures in Wonderland — Chapters I–III Integration Excerpt</text></docTitle>
  <navMap>
    <navPoint id="chapter-1" playOrder="1"><navLabel><text>CHAPTER I. Down the Rabbit-Hole</text></navLabel><content src="${chapterBase}-1.htm.html#pgepubid00003"/></navPoint>
    <navPoint id="chapter-2" playOrder="2"><navLabel><text>CHAPTER II. The Pool of Tears</text></navLabel><content src="${chapterBase}-2.htm.html#pgepubid00004"/></navPoint>
    <navPoint id="chapter-3" playOrder="3"><navLabel><text>CHAPTER III. A Caucus-Race and a Long Tale</text></navLabel><content src="${chapterBase}-3.htm.html#pgepubid00005"/></navPoint>
  </navMap>
</ncx>
`;

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const work = await mkdtemp(join(tmpdir(), "memchat-alice-excerpt-"));
try {
  await mkdir(join(work, "META-INF"), { recursive: true });
  await mkdir(join(work, "OEBPS"), { recursive: true });
  execFileSync("unzip", ["-qq", source, ...retainedEntries, "-d", work], { stdio: "inherit" });
  await writeFile(join(work, "mimetype"), "application/epub+zip", "utf-8");
  await writeFile(join(work, "META-INF", "container.xml"), container, "utf-8");
  await writeFile(join(work, "OEBPS", "content.opf"), opf, "utf-8");
  await writeFile(join(work, "OEBPS", "toc.ncx"), ncx, "utf-8");

  const epoch = new Date("2000-01-01T00:00:00.000Z");
  for (const path of [
    join(work, "mimetype"),
    join(work, "META-INF", "container.xml"),
    join(work, "OEBPS", "content.opf"),
    join(work, "OEBPS", "toc.ncx"),
    ...retainedEntries.map((entry) => join(work, entry)),
  ]) await utimes(path, epoch, epoch);

  await mkdir(dirname(output), { recursive: true });
  await rm(output, { force: true });
  execFileSync("zip", ["-X", "-q", "-0", output, "mimetype"], { cwd: work, stdio: "inherit" });
  execFileSync("zip", [
    "-X", "-q", "-9", output,
    "META-INF/container.xml",
    "OEBPS/content.opf",
    "OEBPS/toc.ncx",
    ...retainedEntries,
  ], { cwd: work, stdio: "inherit" });
  process.stdout.write(`Alice integration excerpt: ${output}\nSource: ${basename(source)}\nChapters: 1-3\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
