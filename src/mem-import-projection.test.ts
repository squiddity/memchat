import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emitMemImportProjection, refreshMemImportLog, renderArtifactMarkdown } from "./mem-import/projection.js";
import { writeImportRun, writeManifest, writeMergeStage, writeNormalizedUnit } from "./mem-import/stage-store.js";
import { authoredMarkdownLinks } from "./mem-import/markdown-markers.js";
import { lintMemImport } from "./mem-import/lint.js";
import type { ArtifactPacket, NormalizedSourceUnit } from "./mem-import/contracts.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-mem-projection-"));
}

const artifact: ArtifactPacket = {
  id: "ada-glass-tower",
  group: "people",
  type: "Character",
  title: "Ada of the Glass Tower",
  description: "Tower guardian who returns at dusk.",
  tags: ["character", "guardian"],
  timestamp: "2026-06-29T00:00:00Z",
  sections: [
    { heading: "Summary", body: "Ada guards the glass tower." },
    { heading: "Uncertainty", body: "The source does not say why Ada guards it." },
  ],
  related: ["glass-tower"],
  provenance: [
    { sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." },
    { sourceId: "chapter-2", unitId: "chapter-2-u001", startAnchor: "b0003", endAnchor: "b0004", quote: "Ada returned to the tower at dusk." },
  ],
};

test("escapes generated index labels and descriptions as safe inline text", async () => {
  const output = await tempDir();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [{
      ...artifact,
      id: "injection-check",
      title: "](/../../outside.md) [forged]",
      description: "[escape](../../outside.md) *not a link*",
      related: [],
      provenance: [{ sourceId: "source", unitId: "unit", startAnchor: "b0001", endAnchor: "b0001", quote: "Exact quote." }],
    }],
  });
  await emitMemImportProjection(output);
  const index = await readFile(join(output, "people", "index.md"), "utf-8");
  assert.match(index, /\\\]/);
  assert.equal(authoredMarkdownLinks(index).some((link) => link.destination.includes("outside.md")), false);
  const lint = await lintMemImport(output);
  assert.equal(lint.diagnostics.some((diagnostic) => diagnostic.code === "markdown-link-outside-root"), false, JSON.stringify(lint.diagnostics));
});

test("renders OKF-style frontmatter without semantic inference", () => {
  const markdown = renderArtifactMarkdown(artifact);
  assert.match(markdown, /type: "Character"/);
  assert.match(markdown, /description: "Tower guardian who returns at dusk\."/);
  assert.match(markdown, /tags: \["character", "guardian"\]/);
  assert.match(markdown, /# Ada of the Glass Tower/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Uncertainty/);
  assert.match(markdown, /chapter-1\/chapter-1-u001#b0001-b0001/);
  assert.doesNotMatch(markdown, /Attributes/);
});

test("resolves inline artifact markers across groups and avoids protected regions", () => {
  const markdown = renderArtifactMarkdown({
    id: "ada",
    group: "people",
    title: "Ada",
    sections: [{
      heading: "Summary",
      body: "[[glass-tower|The Glass Tower]] shelters Ada. `[[glass-tower]]` stays code.\n\n````md\n```\n[[glass-tower]]\n```\n````\nSee [the tower](../places/glass-tower.md), [a curved path](../places/curve(foo).md). https://example.test/[[glass-tower]] ftp://example.test/[[glass-tower]] mailto:ada@example.test/[[glass-tower]] custom:literal/[[glass-tower]] [[ada|Ada]] remains here. [[missing|missing thing]].",
    }],
    provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Provenance [[glass-tower]] ftp://example.test/[[glass-tower]]" }],
  }, {
    relatedTargets: { ada: "people/ada.md", "glass-tower": "places/glass-tower.md" },
    sourceTargets: {},
    currentRelativePath: "people/ada.md",
    currentArtifactId: "ada",
  });
  assert.match(markdown, /\[The Glass Tower\]\(\.\.\/places\/glass-tower\.md\)/);
  assert.match(markdown, /`\[\[glass-tower\]\]`/);
  assert.match(markdown, /````md\n```\n\[\[glass-tower\]\]\n```\n````/);
  assert.match(markdown, /See \[the tower\]\(\.\.\/places\/glass-tower\.md\), \[a curved path\]\(\.\.\/places\/curve\(foo\)\.md\)\./);
  assert.match(markdown, /https:\/\/example\.test\/\[\[glass-tower\]\]/);
  assert.match(markdown, /ftp:\/\/example\.test\/\[\[glass-tower\]\]/);
  assert.match(markdown, /mailto:ada@example\.test\/\[\[glass-tower\]\]/);
  assert.match(markdown, /custom:literal\/\[\[glass-tower\]\]/);
  assert.match(markdown, /Ada remains here\./);
  assert.match(markdown, /\[\[missing\|missing thing\]\]/);
  assert.match(markdown, /> Provenance \[\[glass-tower\]\] ftp:\/\/example\.test\/\[\[glass-tower\]\]/);
  assert.doesNotMatch(markdown, /\[Ada\]\(\.\.\/people\/ada\.md\)/);
});

test("preserves markers in lazy blockquote continuations while rewriting normal prose", () => {
  const markdown = renderArtifactMarkdown({
    id: "ada",
    group: "people",
    title: "Ada",
    sections: [{ heading: "Summary", body: "> Provenance quote starts here\n[[tower|the tower]] remains quoted\n\n[[tower|the tower]] is authored prose." }],
    provenance: [{ sourceId: "source", unitId: "unit", startAnchor: "b0001", endAnchor: "b0001", quote: "Ada." }],
  }, {
    relatedTargets: { tower: "places/tower.md" },
    sourceTargets: {},
    currentRelativePath: "people/ada.md",
    currentArtifactId: "ada",
  });
  assert.match(markdown, /> Provenance quote starts here\n\[\[tower\|the tower\]\] remains quoted/);
  assert.match(markdown, /\[the tower\]\(\.\.\/places\/tower\.md\) is authored prose/);
});

test("emits artifact packets into group directories with portable related links", async () => {
  const output = await tempDir();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [
      artifact,
      {
        id: "glass-tower",
        group: "places",
        title: "Glass Tower",
        sections: [{ heading: "Description", body: "A bright tower above Moon Bay." }],
        provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Glass tower." }],
      },
    ],
  });
  const written = await emitMemImportProjection(output);
  assert.ok(written.length >= 8);
  const markdown = await readFile(join(output, "people", "ada-glass-tower.md"), "utf-8");
  assert.match(markdown, /## Related/);
  assert.match(markdown, /\[glass-tower\]\(\.\.\/places\/glass-tower\.md\)/);
  const rootIndex = await readFile(join(output, "index.md"), "utf-8");
  assert.doesNotMatch(rootIndex, /## Plot and Reading Order/);
  assert.match(rootIndex, /## Groups/);
  assert.match(rootIndex, /\[People\]\(people\/index\.md\)/);
  for (const page of ["index.md", "coverage.md", "log.md", "sources/index.md", "people/index.md", "places/index.md", "things/index.md", "facts/index.md", "style/index.md"]) {
    await stat(join(output, page));
  }
  const peopleIndex = await readFile(join(output, "people", "index.md"), "utf-8");
  assert.match(peopleIndex, /\[Ada of the Glass Tower\]\(ada-glass-tower\.md\)/);
  const log = await readFile(join(output, "log.md"), "utf-8");
  assert.match(log, /# Compendium Update Log/);
  await assert.rejects(stat(join(output, "world")), { code: "ENOENT" });
});

test("renders a compact portable mem-import audit in the update log", async () => {
  const output = await tempDir();
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  await writeImportRun(output, {
    version: 2, kind: "mem-import-run", runId: "run-1", status: "finalized", createdAt: "2026-08-04T00:00:00.000Z",
    source: { normalizedUnits: 2, manifestHash: "sha256:source" },
    merge: { revision: 3, contentHash: "sha256:merge", revisionReceiptPath: "stages/merge/revisions/00000003.json" },
    finalization: { passed: true, errorCount: 0, warningCount: 1, checksPath: "stages/checks/final.json" },
    effects: [
      { kind: "merge", path: "stages/merge/revisions/00000003.json", contentHash: "sha256:merge", at: "2026-08-04T00:00:01.000Z" },
      { kind: "finalization", path: "stages/checks/final.json", contentHash: "sha256:checks", at: "2026-08-04T00:00:02.000Z" },
    ],
  });
  await emitMemImportProjection(output);
  const log = await readFile(join(output, "log.md"), "utf-8");
  assert.match(log, /## Import Details/);
  assert.match(log, /\*\*Source units:\*\* 2/);
  assert.match(log, /\*\*Canonical merge:\*\* revision 3/);
  assert.match(log, /\*\*Result:\*\* finalized; 0 error\(s\), 1 warning\(s\)/);
  assert.match(log, /\]\(stages\/import-run\.json\)/);
  assert.match(log, /sha256:merge/);
});

test("adds a summary fallback from description when short sections are missing", () => {
  const markdown = renderArtifactMarkdown({
    id: "moon-bay",
    group: "places",
    title: "Moon Bay",
    description: "Harbor town below the tower.",
    sections: [{ heading: "Description", body: "Moon Bay glitters at dawn." }],
    provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Moon Bay." }],
  });
  assert.match(markdown, /## Summary\n\nHarbor town below the tower\./);
});

test("emits model-authored style artifacts under style group", async () => {
  const output = await tempDir();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [{
      id: "narrative-voice",
      group: "style",
      title: "Narrative Voice",
      description: "Playful narrative voice guide grounded in source quotes.",
      sections: [{ heading: "Summary", body: "The narrator uses playful reversals and direct address." }],
      related: ["ada-glass-tower"],
      provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "A playful line." }],
    }, artifact],
  });
  await emitMemImportProjection(output);
  const style = await readFile(join(output, "style", "narrative-voice.md"), "utf-8");
  assert.match(style, /group: style/);
  assert.match(style, /type: "Style Guide"/);
  const styleIndex = await readFile(join(output, "style", "index.md"), "utf-8");
  assert.match(styleIndex, /Narrative Voice/);
  const rootIndex = await readFile(join(output, "index.md"), "utf-8");
  assert.match(rootIndex, /\[Style\]\(style\/index\.md\)/);
});

test("promotes declared narrative surfaces into the root index", async () => {
  const output = await tempDir();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [
      {
        id: "plot-synopsis",
        group: "facts",
        type: "Plot Synopsis",
        title: "Plot Synopsis",
        description: "Start here for the whole story.",
        sections: [{ heading: "Summary", body: "A synopsis." }],
        provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Synopsis evidence." }],
      },
      {
        id: "timeline",
        group: "facts",
        tags: ["timeline"],
        title: "Timeline of the Tragedy",
        sections: [{ heading: "Summary", body: "An ordered timeline." }],
        provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Timeline evidence." }],
      },
      {
        id: "acts-and-scenes",
        group: "facts",
        title: "Acts and Scenes",
        metadata: { narrativeSurface: "scene guide" },
        sections: [{ heading: "Summary", body: "A scene guide." }],
        provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Scene guide evidence." }],
      },
    ],
  });
  await emitMemImportProjection(output);
  const rootIndex = await readFile(join(output, "index.md"), "utf-8");
  assert.match(rootIndex, /## Plot and Reading Order/);
  assert.match(rootIndex, /\[Plot Synopsis\]\(facts\/plot-synopsis\.md\)/);
  assert.match(rootIndex, /\[Timeline of the Tragedy\]\(facts\/timeline\.md\)/);
  assert.match(rootIndex, /\[Acts and Scenes\]\(facts\/acts-and-scenes\.md\)/);
  const factsIndex = await readFile(join(output, "facts", "index.md"), "utf-8");
  assert.match(factsIndex, /Plot Synopsis/);
  assert.match(factsIndex, /Timeline of the Tragedy/);
  assert.match(factsIndex, /Acts and Scenes/);
});

test("resolves exact marker labels and possessives while preserving related navigation", () => {
  const markdown = renderArtifactMarkdown({
    id: "ada",
    group: "people",
    title: "Ada",
    sections: [{ heading: "Summary", body: "[[glass-tower|Ada's Glass Tower]] shelters [[bea|Bea's]] party; [[ada|Ada's]] own account stays unlinked." }],
    related: ["glass-tower", "missing-place"],
    provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Ada." }],
  }, {
    relatedTargets: { ada: "people/ada.md", bea: "people/bea.md", "glass-tower": "places/glass-tower.md" },
    sourceTargets: {},
    currentRelativePath: "people/ada.md",
    currentArtifactId: "ada",
  });
  assert.match(markdown, /\[Ada's Glass Tower\]\(\.\.\/places\/glass-tower\.md\)/);
  assert.match(markdown, /\[Bea's\]\(bea\.md\)/);
  assert.match(markdown, /Ada's own account stays unlinked/);
  assert.match(markdown, /\[glass-tower\]\(\.\.\/places\/glass-tower\.md\)/);
  assert.match(markdown, /- \[\[missing-place\]\]/);
});

test("renders synthesized canonical upserts as standalone pages with exact traversal IDs", () => {
  const markdown = renderArtifactMarkdown({
    id: "ada-canonical",
    group: "people",
    title: "Ada",
    description: "Ada's canonical identity and her tower watch.",
    sections: [{ heading: "Summary", body: "Ada guards [[glass-tower-canonical|the Glass Tower]]. `[[glass-tower-canonical]]` remains protected code." }],
    related: ["glass-tower-canonical"],
    provenance: [{ sourceId: "chapter-1", unitId: "chapter-1-u001", startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the tower." }],
  }, {
    relatedTargets: { "ada-canonical": "people/ada-canonical.md", "glass-tower-canonical": "places/glass-tower-canonical.md" },
    sourceTargets: {},
    currentRelativePath: "people/ada-canonical.md",
    currentArtifactId: "ada-canonical",
  });
  assert.match(markdown, /Ada's canonical identity/);
  assert.match(markdown, /\[the Glass Tower\]\(\.\.\/places\/glass-tower-canonical\.md\)/);
  assert.match(markdown, /`\[\[glass-tower-canonical\]\]` remains protected code/);
  assert.match(markdown, /- \[glass-tower-canonical\]\(\.\.\/places\/glass-tower-canonical\.md\)/);
  assert.doesNotMatch(markdown, /provisional/);
});

test("adds deterministic collision suffixes without changing exact-id resolution", async () => {
  const output = await tempDir();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [
      { id: "ada", group: "people", title: "Ada", sections: [{ heading: "Summary", body: "First Ada." }], provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "First Ada." }] },
      { id: "Ada", group: "people", title: "Ada (variant)", sections: [{ heading: "Summary", body: "Second Ada." }], provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "Second Ada." }] },
    ],
  });
  await emitMemImportProjection(output);
  assert.match(await readFile(join(output, "people", "ada.md"), "utf-8"), /First Ada/);
  assert.match(await readFile(join(output, "people", "ada-2.md"), "utf-8"), /Second Ada/);
});

test("reserves generated index filenames and applies deterministic collision suffixes", async () => {
  const output = await tempDir();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [
      { id: "index", group: "facts", title: "Index", sections: [{ heading: "Summary", body: "The reserved page." }], provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "Reserved." }] },
      { id: "index-2", group: "facts", title: "Index Two", sections: [{ heading: "Summary", body: "The second reserved page." }], provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "Second." }] },
    ],
  });
  await emitMemImportProjection(output);
  assert.match(await readFile(join(output, "facts", "index-2.md"), "utf-8"), /The reserved page/);
  assert.match(await readFile(join(output, "facts", "index-2-2.md"), "utf-8"), /The second reserved page/);
  assert.match(await readFile(join(output, "facts", "index.md"), "utf-8"), /\[Index\]\(index-2\.md\)/);
});

test("retains cited source Markdown pages with local anchors and coverage links at the compendium root", async () => {
  const output = await tempDir();
  const unit: NormalizedSourceUnit = {
    sourceId: "chapter-1", unitId: "chapter-1-u001", title: "Chapter One", kind: "html", inputPath: "chapter.html", order: 0,
    sourceHash: "sha256:source", contentHash: "sha256:content", normalizerVersion: 2, content: "Ada guards the tower.",
    blocks: [{ anchor: "b0001", index: 0, text: "Ada guards the tower.", kind: "paragraph" }],
  };
  await writeNormalizedUnit(output, unit);
  await writeManifest({ version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: "input", outputRoot: output, units: [{ sourceId: unit.sourceId, unitId: unit.unitId, title: unit.title, kind: unit.kind, inputPath: unit.inputPath, order: unit.order, blockCount: 1, anchors: ["b0001"], normalizedPath: `sources/normalized/${unit.unitId}.json`, sourceHash: unit.sourceHash, contentHash: unit.contentHash, normalizerVersion: 2 }], diagnostics: [] });
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "ada", group: "people", title: "Ada", sections: [{ heading: "Summary", body: "Ada guards the tower." }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the tower." }] }] });
  await emitMemImportProjection(output);
  const sourcePage = await readFile(join(output, "sources", "units", `${unit.unitId}.md`), "utf-8");
  assert.match(sourcePage, /## b0001/);
  assert.match(await readFile(join(output, "people", "ada.md"), "utf-8"), /\.\.\/sources\/units\/chapter-1-u001\.md#b0001/);
  assert.match(await readFile(join(output, "coverage.md"), "utf-8"), /sources\/units\/chapter-1-u001\.md/);
  assert.match(await readFile(join(output, "log.md"), "utf-8"), /All emitted provenance links resolved/);
});

test("rejects symlinked normalized source ancestors before projection reads", async () => {
  const output = await tempDir();
  const external = await tempDir();
  const unit: NormalizedSourceUnit = {
    sourceId: "source", unitId: "unit", title: "Unit", kind: "html", inputPath: "unit.html", order: 0,
    sourceHash: "source", contentHash: "content", normalizerVersion: 2, content: "Unit.",
    blocks: [{ anchor: "b0001", index: 0, text: "Unit.", kind: "paragraph" }],
  };
  await writeNormalizedUnit(output, unit);
  await writeManifest({ version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: "input", outputRoot: output, units: [{ sourceId: "source", unitId: "unit", title: "Unit", kind: "html", inputPath: "unit.html", order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: "sources/normalized/unit.json", sourceHash: "source", contentHash: "content", normalizerVersion: 2 }], diagnostics: [] });
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "unit-artifact", group: "facts", title: "Unit", sections: [{ heading: "Summary", body: "Unit." }], provenance: [{ sourceId: "source", unitId: "unit", startAnchor: "b0001", endAnchor: "b0001", quote: "Unit." }] }] });
  await rm(join(output, "sources", "normalized"), { recursive: true, force: true });
  await symlink(external, join(output, "sources", "normalized"));
  await writeFile(join(external, "unit.json"), JSON.stringify(unit), "utf-8");
  await assert.rejects(emitMemImportProjection(output), /symlinked normalized source path component/);
  assert.deepEqual(await readdir(external), ["unit.json"]);
});

test("only an absent normalized source read degrades citations; corrupt source reads fail", async () => {
  const output = await tempDir();
  await writeManifest({ version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: "input", outputRoot: output, units: [{ sourceId: "source", unitId: "unit", title: "Unit", kind: "html", inputPath: "unit.html", order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: "sources/normalized/unit.json", sourceHash: "source", contentHash: "content", normalizerVersion: 2 }], diagnostics: [] });
  await mkdir(join(output, "sources", "normalized"), { recursive: true });
  await writeFile(join(output, "sources", "normalized", "unit.json"), "{broken\n", "utf-8");
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "unit-artifact", group: "facts", title: "Unit", sections: [{ heading: "Summary", body: "Unit." }], provenance: [{ sourceId: "source", unitId: "unit", startAnchor: "b0001", endAnchor: "b0001", quote: "Unit." }] }] });
  await assert.rejects(emitMemImportProjection(output), SyntaxError);
  await unlink(join(output, "sources", "normalized", "unit.json"));
  await emitMemImportProjection(output);
  assert.match(await readFile(join(output, "log.md"), "utf-8"), /1 provenance citation\(s\) were degraded/);
});

test("refresh derives source counts from owned source pages that actually exist", async () => {
  const output = await tempDir();
  const unit: NormalizedSourceUnit = {
    sourceId: "chapter-1", unitId: "chapter-1-u001", title: "Chapter One", kind: "html", inputPath: "chapter.html", order: 0,
    sourceHash: "sha256:source", contentHash: "sha256:content", normalizerVersion: 2, content: "Ada guards the tower.",
    blocks: [{ anchor: "b0001", index: 0, text: "Ada guards the tower.", kind: "paragraph" }],
  };
  await writeNormalizedUnit(output, unit);
  await writeManifest({ version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: "input", outputRoot: output, units: [{ sourceId: unit.sourceId, unitId: unit.unitId, title: unit.title, kind: unit.kind, inputPath: unit.inputPath, order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: `sources/normalized/${unit.unitId}.json`, sourceHash: unit.sourceHash, contentHash: unit.contentHash, normalizerVersion: 2 }], diagnostics: [] });
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "ada", group: "people", title: "Ada", sections: [{ heading: "Summary", body: "Ada." }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada." }] }] });
  await emitMemImportProjection(output);
  await unlink(join(output, "sources", "units", `${unit.unitId}.md`));
  await refreshMemImportLog(output);
  const log = await readFile(join(output, "log.md"), "utf-8");
  assert.match(log, /Retained 0 source-unit page\(s\)/);
  assert.match(log, /1 provenance citation\(s\) were degraded/);
});

test("fails closed on retired nested projections without reading or deleting their content", async () => {
  const output = await tempDir();
  const retired = join(output, "world");
  await mkdir(join(retired, "people"), { recursive: true });
  await writeFile(join(retired, "people", "legacy.md"), "legacy content", "utf-8");
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  await assert.rejects(emitMemImportProjection(output), /retired nested projection.*Migrate.*remove.*will not follow or delete/i);
  assert.equal(await readFile(join(retired, "people", "legacy.md"), "utf-8"), "legacy content");
});

test("cleans only generated Markdown and leaves compendium JSON, stages, and non-Markdown files intact", async () => {
  const output = await tempDir();
  await mkdir(join(output, "people"), { recursive: true });
  await mkdir(join(output, "sources"), { recursive: true });
  await mkdir(join(output, "stages"), { recursive: true });
  await writeFile(join(output, "notes.md"), "custom root note", "utf-8");
  await writeFile(join(output, "people", "stale.md"), "custom page", "utf-8");
  await writeFile(join(output, "people", "keep.txt"), "keep", "utf-8");
  await writeManifest({ version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: "input", outputRoot: output, units: [], diagnostics: [] });
  const manifestBefore = await readFile(join(output, "sources", "manifest.json"), "utf-8");
  await writeFile(join(output, "stages", "keep.json"), "{\"keep\":true}\n", "utf-8");
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  await emitMemImportProjection(output);
  assert.equal(await readFile(join(output, "people", "stale.md"), "utf-8"), "custom page");
  assert.equal(await readFile(join(output, "notes.md"), "utf-8"), "custom root note");
  assert.equal(await readFile(join(output, "people", "keep.txt"), "utf-8"), "keep");
  assert.equal(await readFile(join(output, "sources", "manifest.json"), "utf-8"), manifestBefore);
  assert.equal(await readFile(join(output, "stages", "keep.json"), "utf-8"), "{\"keep\":true}\n");
  assert.match(await readFile(join(output, "index.md"), "utf-8"), /# Compendium Index/);
  const ownership = JSON.parse(await readFile(join(output, ".mem-import-generated.json"), "utf-8")) as { kind: string; files: string[] };
  assert.equal(ownership.kind, "mem-import-projection-ownership");
  assert.ok(ownership.files.includes("people/ada-glass-tower.md"));
});

test("rejects managed-directory and destination symlinks without touching external targets", async () => {
  const output = await tempDir();
  const outside = await tempDir();
  const outsideFile = join(outside, "external.md");
  await writeFile(outsideFile, "external-original", "utf-8");
  await symlink(outside, join(output, "people"));
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  await assert.rejects(emitMemImportProjection(output), /symlinked managed projection/);
  assert.equal(await readFile(outsideFile, "utf-8"), "external-original");

  const rootLink = join(await tempDir(), "linked-output");
  await symlink(outside, rootLink);
  await assert.rejects(emitMemImportProjection(rootLink), /symlinked managed projection root/);
  assert.equal(await readFile(outsideFile, "utf-8"), "external-original");

  const linkedParentContainer = await tempDir();
  const linkedParent = join(linkedParentContainer, "parent");
  const realParent = await tempDir();
  await symlink(realParent, linkedParent);
  const nestedAncestorOutput = join(linkedParent, "projection");
  const realNestedAncestorOutput = join(realParent, "projection");
  await mkdir(realNestedAncestorOutput, { recursive: true });
  await writeMergeStage(realNestedAncestorOutput, { version: 1, kind: "merge", artifacts: [artifact] });
  await assert.rejects(emitMemImportProjection(nestedAncestorOutput), /symlinked managed projection ancestor/);

  const nestedLinkOutput = await tempDir();
  await symlink(outside, join(nestedLinkOutput, "world"));
  await writeMergeStage(nestedLinkOutput, { version: 1, kind: "merge", artifacts: [artifact] });
  await assert.rejects(emitMemImportProjection(nestedLinkOutput), /retired nested projection/);
  assert.equal(await readFile(outsideFile, "utf-8"), "external-original");

  const safeOutput = await tempDir();
  await writeMergeStage(safeOutput, { version: 1, kind: "merge", artifacts: [artifact] });
  await emitMemImportProjection(safeOutput);
  await unlink(join(safeOutput, "log.md"));
  await symlink(outsideFile, join(safeOutput, "log.md"));
  await assert.rejects(refreshMemImportLog(safeOutput), /symlinked managed projection/);
  assert.equal(await readFile(outsideFile, "utf-8"), "external-original");
});

test("preflight rejects an unowned collision without deleting old output, then retry succeeds", async () => {
  const output = await tempDir();
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  await emitMemImportProjection(output);
  const oldPage = join(output, "people", "ada-glass-tower.md");
  const oldPageBefore = await readFile(oldPage, "utf-8");
  await writeFile(join(output, "people", "new-person.md"), "local page", "utf-8");
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [artifact, { id: "new-person", group: "people", title: "New Person", sections: [{ heading: "Summary", body: "A new person." }], provenance: artifact.provenance }],
  });
  await assert.rejects(emitMemImportProjection(output), /unowned Markdown projection file.*people\/new-person\.md/);
  assert.equal(await readFile(oldPage, "utf-8"), oldPageBefore);
  assert.equal(await readFile(join(output, "people", "new-person.md"), "utf-8"), "local page");
  await unlink(join(output, "people", "new-person.md"));
  await emitMemImportProjection(output);
  assert.match(await readFile(join(output, "people", "new-person.md"), "utf-8"), /A new person/);
});

test("failed projection writes leave a union ownership manifest and retry removes stale output", async () => {
  const output = await tempDir();
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  await emitMemImportProjection(output);
  const replacement: ArtifactPacket = { ...artifact, id: "replacement", title: "Replacement", description: "Replacement page.", sections: [{ heading: "Summary", body: "Replacement page." }] };
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [replacement] });
  await assert.rejects(emitMemImportProjection(output, { failAfterWrites: 2 }), /Injected projection write failure after 2 write/);
  const provisional = JSON.parse(await readFile(join(output, ".mem-import-generated.json"), "utf-8")) as { files: string[] };
  assert.ok(provisional.files.includes("people/replacement.md"));
  assert.match(await readFile(join(output, "people", "ada-glass-tower.md"), "utf-8"), /Ada of the Glass Tower/);
  await emitMemImportProjection(output);
  await assert.rejects(stat(join(output, "people", "ada-glass-tower.md")), { code: "ENOENT" });
  assert.match(await readFile(join(output, "people", "replacement.md"), "utf-8"), /Replacement page/);
});

test("invalid merged packet fails before half-written semantic output", async () => {
  const output = await tempDir();
  await assert.rejects(
    writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "bad", group: "people", title: "Bad", sections: [], provenance: [] }] }),
    /provenance must be a non-empty array/,
  );
});
