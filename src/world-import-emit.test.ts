import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emitWorldLibrary, renderArtifactMarkdown } from "./world-import/emit.js";
import { writeMergeStage } from "./world-import/staging.js";
import type { ArtifactPacket } from "./world-import/types.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-world-emit-"));
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
  const written = await emitWorldLibrary(output);
  assert.ok(written.length >= 8);
  const markdown = await readFile(join(output, "world", "people", "ada-glass-tower.md"), "utf-8");
  assert.match(markdown, /## Related/);
  assert.match(markdown, /\[glass-tower\]\(\.\.\/places\/glass-tower\.md\)/);
  const rootIndex = await readFile(join(output, "world", "index.md"), "utf-8");
  assert.doesNotMatch(rootIndex, /## Plot and Reading Order/);
  assert.match(rootIndex, /## Groups/);
  assert.match(rootIndex, /\[People\]\(people\/index\.md\)/);
  const peopleIndex = await readFile(join(output, "world", "people", "index.md"), "utf-8");
  assert.match(peopleIndex, /\[Ada of the Glass Tower\]\(ada-glass-tower\.md\)/);
  const log = await readFile(join(output, "world", "log.md"), "utf-8");
  assert.match(log, /# World Update Log/);
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
  await emitWorldLibrary(output);
  const style = await readFile(join(output, "world", "style", "narrative-voice.md"), "utf-8");
  assert.match(style, /group: style/);
  assert.match(style, /type: "Style Guide"/);
  const styleIndex = await readFile(join(output, "world", "style", "index.md"), "utf-8");
  assert.match(styleIndex, /Narrative Voice/);
  const rootIndex = await readFile(join(output, "world", "index.md"), "utf-8");
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
  await emitWorldLibrary(output);
  const rootIndex = await readFile(join(output, "world", "index.md"), "utf-8");
  assert.match(rootIndex, /## Plot and Reading Order/);
  assert.match(rootIndex, /\[Plot Synopsis\]\(facts\/plot-synopsis\.md\)/);
  assert.match(rootIndex, /\[Timeline of the Tragedy\]\(facts\/timeline\.md\)/);
  assert.match(rootIndex, /\[Acts and Scenes\]\(facts\/acts-and-scenes\.md\)/);
  const factsIndex = await readFile(join(output, "world", "facts", "index.md"), "utf-8");
  assert.match(factsIndex, /Plot Synopsis/);
  assert.match(factsIndex, /Timeline of the Tragedy/);
  assert.match(factsIndex, /Acts and Scenes/);
});

test("invalid merged packet fails before half-written semantic output", async () => {
  const output = await tempDir();
  await assert.rejects(
    writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "bad", group: "people", title: "Bad", sections: [], provenance: [] }] }),
    /provenance must be a non-empty array/,
  );
});
