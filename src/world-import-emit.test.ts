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
  title: "Ada of the Glass Tower",
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

test("renders generic model-authored artifact packets without semantic inference", () => {
  const markdown = renderArtifactMarkdown(artifact);
  assert.match(markdown, /# Ada of the Glass Tower/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Uncertainty/);
  assert.match(markdown, /chapter-1\/chapter-1-u001#b0001-b0001/);
  assert.doesNotMatch(markdown, /Attributes/);
});

test("emits artifact packets into group directories", async () => {
  const output = await tempDir();
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [artifact] });
  const written = await emitWorldLibrary(output);
  assert.equal(written.length, 1);
  assert.match(written[0], /world\/people\/ada-glass-tower\.md$/);
  const markdown = await readFile(written[0], "utf-8");
  assert.match(markdown, /## Related/);
  assert.match(markdown, /\[\[glass-tower\]\]/);
});

test("invalid merged packet fails before half-written semantic output", async () => {
  const output = await tempDir();
  await assert.rejects(
    writeMergeStage(output, { version: 1, kind: "merge", artifacts: [{ id: "bad", group: "people", title: "Bad", sections: [], provenance: [] }] }),
    /provenance must be a non-empty array/,
  );
});
