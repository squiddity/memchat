import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExtractionStage, writeManifest, writeMergeStage, writeNormalizedUnit } from "./mem-import/stage-store.js";
import type { ArtifactPacket, NormalizedSourceUnit, SourceManifest } from "./mem-import/contracts.js";

export async function fixtureForQualityChecks(options: { units?: number; narrativeArtifacts?: boolean } = {}): Promise<string> {
  const output = await mkdtemp(join(tmpdir(), "memchat-quality-checks-"));
  const count = options.units ?? 1;
  const units: NormalizedSourceUnit[] = Array.from({ length: count }, (_, index) => {
    const id = `u${index + 1}`;
    return {
      sourceId: `s${index + 1}`, unitId: id, title: `Chapter ${index + 1}`, kind: "html", role: "body", inputPath: `${id}.html`, order: index,
      sourceHash: `source-${id}`, contentHash: `content-${id}`, normalizerVersion: 2,
      content: `[b0001] CHAPTER ${index + 1}\n\n[b0002] Alice enters the glass tower.`,
      blocks: [{ anchor: "b0001", index: 0, kind: "heading", text: `CHAPTER ${index + 1}` }, { anchor: "b0002", index: 1, kind: "paragraph", text: "Alice enters the glass tower." }],
    } satisfies NormalizedSourceUnit;
  });
  const manifest: SourceManifest = {
    version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: output, outputRoot: output, diagnostics: [],
    units: units.map((unit) => ({ sourceId: unit.sourceId, unitId: unit.unitId, title: unit.title, kind: unit.kind, role: unit.role, inputPath: unit.inputPath, order: unit.order, blockCount: unit.blocks.length, anchors: unit.blocks.map((block) => block.anchor), blockKinds: unit.blocks.map((block) => block.kind ?? "block"), normalizedPath: `sources/normalized/${unit.unitId}.json`, sourceHash: unit.sourceHash, contentHash: unit.contentHash, normalizerVersion: 2 })),
  };
  await writeManifest(manifest);
  for (const unit of units) {
    await writeNormalizedUnit(output, unit);
    await writeExtractionStage(output, { version: 1, kind: "extraction", unitId: unit.unitId, sourceId: unit.sourceId, candidates: [{ id: `candidate-${unit.unitId}`, group: "people", title: "Alice", provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0002", endAnchor: "b0002", quote: "Alice enters the glass tower." }] }] });
  }
  const artifacts: ArtifactPacket[] = [{
    id: "alice", group: "people", title: "Alice", description: "Alice enters the glass tower.", sections: [{ heading: "Summary", body: "Alice enters the glass tower." }],
    provenance: units.map((unit) => ({ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0002", endAnchor: "b0002", quote: "Alice enters the glass tower." })),
    metadata: { representedCandidateIds: units.map((unit) => `${unit.unitId}:candidate-${unit.unitId}`) },
  }];
  if (options.narrativeArtifacts) artifacts.push(
    { id: "plot-synopsis", group: "facts", title: "Plot Synopsis", type: "Synopsis", sections: [{ heading: "Synopsis", body: "Alice enters the tower." }], provenance: [artifacts[0]!.provenance[0]!] },
    { id: "timeline", group: "facts", title: "Timeline", type: "Timeline", sections: [{ heading: "Timeline", body: "Alice enters, then leaves." }], provenance: [artifacts[0]!.provenance[0]!] },
    { id: "scene-guide", group: "facts", title: "Scene Guide", type: "Scene Guide", sections: [{ heading: "Scenes", body: "The entrance occurs first." }], provenance: [artifacts[0]!.provenance[0]!] },
    { id: "tower", group: "things", title: "Glass Tower", sections: [{ heading: "Summary", body: "A tower." }], provenance: [artifacts[0]!.provenance[0]!] },
  );
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts });
  return output;
}
