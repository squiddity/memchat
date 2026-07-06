import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  findText,
  provenanceAudit,
  suggestRefCandidates,
} from "./world-import/helper-tools.js";
import { makeBlocks, renderUnitContent } from "./world-import/spans.js";
import { writeManifest, writeMergeStage, writeNormalizedUnit } from "./world-import/staging.js";
import type { NormalizedSourceUnit, SourceManifest } from "./world-import/types.js";

async function fixtureOutput(): Promise<{ output: string; unit: NormalizedSourceUnit }> {
  const output = await mkdtemp(join(tmpdir(), "memchat-provenance-tools-"));
  const blocks = makeBlocks([
    { kind: "heading", text: "THE ADVENTURE OF THE BLUE CARBUNCLE" },
    { kind: "paragraph", text: "Peterson found a battered hat and a Christmas goose in Tottenham Court Road." },
    { kind: "paragraph", text: "The blue carbuncle was discovered in the crop of the goose after it was cooked." },
    { kind: "paragraph", text: "Holmes traced the jewel through Breckinridge and Ryder with cool attention to detail." },
  ]);
  const unit: NormalizedSourceUnit = {
    sourceId: "source-1",
    unitId: "unit-1",
    title: "The Blue Carbuncle",
    kind: "html",
    role: "body",
    inputPath: "chapter.html",
    order: 1,
    sourceHash: "sourcehash",
    contentHash: "contenthash",
    normalizerVersion: 2,
    content: renderUnitContent(blocks),
    blocks,
  };
  const manifest: SourceManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    inputRoot: output,
    outputRoot: output,
    units: [{
      sourceId: unit.sourceId,
      unitId: unit.unitId,
      title: unit.title,
      kind: unit.kind,
      role: unit.role,
      inputPath: unit.inputPath,
      order: unit.order,
      blockCount: unit.blocks.length,
      anchors: unit.blocks.map((block) => block.anchor),
      blockKinds: unit.blocks.map((block) => block.kind ?? "block"),
      normalizedPath: "sources/normalized/unit-1.json",
      sourceHash: unit.sourceHash,
      contentHash: unit.contentHash,
      normalizerVersion: 2,
    }],
    diagnostics: [],
  };
  await writeManifest(manifest);
  await writeNormalizedUnit(output, unit);
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [
      {
        id: "blue-carbuncle",
        group: "things",
        title: "Blue Carbuncle",
        sections: [
          { heading: "Summary", body: "The blue carbuncle is found inside a Christmas goose's crop." },
          { heading: "Owner", body: "It is connected to Ryder." },
          { heading: "Investigation", body: "Holmes traces it through London." },
          { heading: "Consequence", body: "The discovery resolves the theft." },
        ],
        provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "THE ADVENTURE OF THE BLUE CARBUNCLE" }],
      },
      {
        id: "good-ref",
        group: "facts",
        title: "Good Ref",
        sections: [{ heading: "Summary", body: "The jewel was found in the goose crop." }],
        provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0003", endAnchor: "b0003", quote: unit.blocks[2]!.text }],
      },
      {
        id: "style-tone",
        group: "style",
        title: "Style Tone",
        sections: [{ heading: "Summary", body: "The narration uses brisk investigative exposition with precise physical details and understated humor across an extended passage." }],
        provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0004", endAnchor: "b0004", quote: unit.blocks[3]!.text }],
      },
    ],
  });
  return { output, unit };
}

test("provenance-audit reports heading, sparse, repeated, and style warnings", async () => {
  const { output } = await fixtureOutput();
  const result = await provenanceAudit({ outputRoot: output });
  assert.equal(result.passed, true);
  assert.ok(result.diagnostics.some((item) => item.code === "heading-only-provenance" && item.artifactId === "blue-carbuncle"));
  assert.ok(result.diagnostics.some((item) => item.code === "single-ref-many-sections" && item.artifactId === "blue-carbuncle"));
  assert.ok(result.diagnostics.some((item) => item.code === "style-under-cited" && item.artifactId === "style-tone"));
});

test("find-text supports case-insensitive search, context, and quote-ref commands", async () => {
  const { output } = await fixtureOutput();
  const result = await findText({ outputRoot: output, query: "carbuncle", context: 1, maxResults: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0]!.anchor, "b0001");
  assert.ok(result.matches[0]!.context.length >= 2);
  assert.match(result.matches[0]!.quoteRefCommand, /quote-ref/);
});

test("suggest-ref-candidates ranks lexical evidence for a claim", async () => {
  const { output } = await fixtureOutput();
  const result = await suggestRefCandidates({
    outputRoot: output,
    artifactId: "blue-carbuncle",
    claim: "The blue carbuncle is found in a Christmas goose's crop",
    maxResults: 3,
  });
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0]!.startAnchor, "b0003");
  assert.ok(result.candidates[0]!.matchedTerms.includes("carbuncle"));
});
