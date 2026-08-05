import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { lintMemImport } from "./mem-import/lint.js";
import { deterministicMemImportChecks } from "./mem-import/checks.js";
import { emitMemImportProjection } from "./mem-import/projection.js";
import { mergedCandidatesPath, writeExtractionStage, writeManifest, writeMergeStage, writeNormalizedUnit } from "./mem-import/stage-store.js";
import type { NormalizedSourceUnit, SourceManifest, StageEnvelope } from "./mem-import/contracts.js";

function unit(unitId: string, order = 0): NormalizedSourceUnit {
  return {
    sourceId: `source-${unitId}`, unitId, title: `Unit ${unitId}`, kind: "html", role: "body", inputPath: `${unitId}.html`, order,
    sourceHash: `source-${unitId}`, contentHash: `content-${unitId}`, normalizerVersion: 2,
    content: `[b0001] UNIT ${unitId}\n\n[b0002] Alice enters the glass tower.`,
    blocks: [
      { anchor: "b0001", index: 0, kind: "heading", text: `UNIT ${unitId}` },
      { anchor: "b0002", index: 1, kind: "paragraph", text: "Alice enters the glass tower." },
    ],
  };
}

async function fixture(options: { units?: string[]; artifacts?: StageEnvelope["artifacts"]; dispositions?: StageEnvelope["candidateDispositions"] } = {}): Promise<string> {
  const output = await mkdtemp(join(tmpdir(), "memchat-mem-lint-"));
  const unitIds = options.units ?? ["u1"];
  const normalized = unitIds.map((id, index) => unit(id, index));
  const manifest: SourceManifest = {
    version: 1, createdAt: "2026-08-04T00:00:00.000Z", inputRoot: output, outputRoot: output, diagnostics: [],
    units: normalized.map((item) => ({ sourceId: item.sourceId, unitId: item.unitId, title: item.title, kind: item.kind, role: item.role, inputPath: item.inputPath, order: item.order, blockCount: item.blocks.length, anchors: item.blocks.map((block) => block.anchor), blockKinds: item.blocks.map((block) => block.kind ?? "block"), normalizedPath: `sources/normalized/${item.unitId}.json`, sourceHash: item.sourceHash, contentHash: item.contentHash, normalizerVersion: 2 })),
  };
  await writeManifest(manifest);
  for (const item of normalized) {
    await writeNormalizedUnit(output, item);
    await writeExtractionStage(output, { version: 1, kind: "extraction", unitId: item.unitId, sourceId: item.sourceId, candidates: [{ id: `candidate-${item.unitId}`, group: "people", title: "Alice", provenance: [{ sourceId: item.sourceId, unitId: item.unitId, startAnchor: "b0002", endAnchor: "b0002", quote: "Alice enters the glass tower." }] }] });
  }
  await writeMergeStage(output, {
    version: 1, kind: "merge", artifacts: options.artifacts ?? [{ id: "alice", group: "people", title: "Alice", description: "Alice enters the glass tower.", sections: [{ heading: "Summary", body: "Alice enters the glass tower." }], provenance: normalized.map((item) => ({ sourceId: item.sourceId, unitId: item.unitId, startAnchor: "b0002", endAnchor: "b0002", quote: "Alice enters the glass tower." })), metadata: { representedCandidateIds: normalized.map((item) => `${item.unitId}:candidate-${item.unitId}`) } }], candidateDispositions: options.dispositions,
  });
  await emitMemImportProjection(output);
  return output;
}

test("root-level mem-import lint accepts canonical projection and checks indexes/frontmatter", async () => {
  const output = await fixture();
  const result = await lintMemImport(output);
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  const checks = await deterministicMemImportChecks(output);
  assert.equal(checks.passed, true, JSON.stringify(checks));
  assert.ok(checks.checks.some((check) => check.name === "root index exists" && check.passed));
  assert.ok(checks.checks.some((check) => check.name === "concept frontmatter includes type and description" && check.passed));
});

test("mem-import lint reports unresolved markers, related ids, markdown targets, anchors, and frontmatter", async () => {
  const output = await fixture({ artifacts: [{ id: "alice", group: "people", title: "Alice", related: ["missing-related"], sections: [{ heading: "Summary", body: "Alice [[missing-marker]]." }], provenance: [{ sourceId: "source-u1", unitId: "u1", startAnchor: "b0002", endAnchor: "b0002", quote: "Alice enters the glass tower." }] }] });
  const concept = join(output, "people", "alice.md");
  let markdown = await readFile(concept, "utf-8");
  markdown = markdown.replace("type: \"Character\"\n", "").replaceAll("Alice [[missing-marker]].", "Alice [[missing-marker]].\n\n[Broken](missing.md#missing-anchor \"title\")");
  await writeFile(concept, markdown, "utf-8");
  const result = await lintMemImport(output);
  assert.equal(result.passed, false);
  for (const code of ["unresolved-related", "unresolved-wikilink", "unresolved-markdown-link", "missing-frontmatter"]) assert.ok(result.diagnostics.some((item) => item.code === code), code);
});

test("mem-import lint ignores protected marker literals while preserving real marker checks", async () => {
  const output = await fixture({ artifacts: [{
    id: "alice", group: "people", title: "Alice",
    sections: [{ heading: "Summary", body: "````md\n```\n[[missing-fenced]]\n```\n````\n`[[missing-inline]]` [existing [[missing-label]]](../sources/units/u1.md#b0002) ftp://example.test/[[missing-ftp]] mailto:alice@example.test/[[missing-mailto]] custom:literal/[[missing-custom]]" }],
    provenance: [{ sourceId: "source-u1", unitId: "u1", startAnchor: "b0002", endAnchor: "b0002", quote: "Provenance [[missing-quote]]" }],
    metadata: { representedCandidateIds: ["u1:candidate-u1"] },
  }] });
  const result = await lintMemImport(output);
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
});

test("mem-import lint reports duplicate ids, provenance source/anchor errors, and body coverage gaps", async () => {
  const output = await fixture({ units: ["u1", "u2"], dispositions: [{ unitId: "u1", candidateId: "candidate-u1", disposition: "dropped", reason: "Incidental." }] });
  const stage = JSON.parse(await readFile(mergedCandidatesPath(output), "utf-8")) as StageEnvelope;
  const artifact = stage.artifacts![0]!;
  artifact.provenance = artifact.provenance.filter((ref) => ref.unitId === "u1");
  artifact.provenance[0] = { sourceId: "wrong-source", unitId: "u1", startAnchor: "b9999", endAnchor: "b9999", quote: "bad" };
  stage.artifacts = [artifact, { ...artifact, id: "alice-duplicate" }];
  stage.artifacts[1]!.id = artifact.id;
  await writeFile(mergedCandidatesPath(output), `${JSON.stringify(stage)}\n`, "utf-8");
  const result = await lintMemImport(output);
  assert.ok(result.diagnostics.some((item) => item.code === "duplicate-artifact-id"));
  assert.ok(result.diagnostics.some((item) => item.code === "provenance-source-mismatch"));
  assert.ok(result.diagnostics.some((item) => item.code === "unresolved-provenance-anchor"));
  assert.ok(result.diagnostics.some((item) => item.code === "body-unit-no-emitted-coverage"));
});

test("lint rejects malformed, symlinked, and symlink-owned projection manifests", async () => {
  const malformed = await fixture();
  await writeFile(join(malformed, ".mem-import-generated.json"), "not-json\n", "utf-8");
  const malformedResult = await lintMemImport(malformed);
  assert.ok(malformedResult.diagnostics.some((item) => item.code === "invalid-projection-ownership" && item.level === "error"));

  const symlinked = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "memchat-lint-outside-"));
  const manifest = join(symlinked, ".mem-import-generated.json");
  await unlink(manifest);
  await symlink(join(outside, "ownership.json"), manifest);
  const symlinkedResult = await lintMemImport(symlinked);
  assert.ok(symlinkedResult.diagnostics.some((item) => item.code === "invalid-projection-ownership" && item.level === "error"));

  const symlinkOwned = await fixture();
  const concept = join(symlinkOwned, "people", "alice.md");
  const external = join(outside, "concept.md");
  await writeFile(external, await readFile(concept, "utf-8"), "utf-8");
  await unlink(concept);
  await symlink(external, concept);
  const symlinkOwnedResult = await lintMemImport(symlinkOwned);
  assert.ok(symlinkOwnedResult.diagnostics.some((item) => item.code === "invalid-projection-ownership" && item.level === "error"));
});

test("lint rejects Markdown targets outside the projection root even when they exist", async () => {
  const output = await fixture();
  const outside = join(output, "..", "memchat-lint-outside.md");
  await writeFile(outside, "# outside\n", "utf-8");
  const concept = join(output, "people", "alice.md");
  const markdown = await readFile(concept, "utf-8");
  await writeFile(concept, `${markdown}\n[Outside](../../memchat-lint-outside.md)\n`, "utf-8");
  const result = await lintMemImport(output);
  assert.ok(result.diagnostics.some((item) => item.code === "markdown-link-outside-root" && item.level === "error"));
});

test("lint uses canonical containment for existing Markdown targets and protects lazy quote continuations", async () => {
  const output = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "memchat-lint-canonical-outside-"));
  const external = join(outside, "target.md");
  await writeFile(external, "# external\n", "utf-8");
  const linked = join(output, "people", "linked.md");
  await symlink(external, linked);
  const concept = join(output, "people", "alice.md");
  const markdown = await readFile(concept, "utf-8");
  await writeFile(concept, `${markdown}\n> quoted provenance\n[[missing-quoted]]\n\n[Escaped](linked.md \"title\")\n`, "utf-8");
  const result = await lintMemImport(output);
  assert.ok(result.diagnostics.some((item) => item.code === "markdown-link-outside-root" && item.path === concept));
  assert.ok(!result.diagnostics.some((item) => item.code === "unresolved-wikilink" && item.message.includes("missing-quoted")));
  assert.ok(!result.diagnostics.some((item) => item.code === "unresolved-markdown-link" && item.message.includes("linked.md")));
});

test("candidate dispositions account for dropped candidates with reasons", async () => {
  const output = await fixture({ dispositions: [{ unitId: "u1", candidateId: "candidate-u1", disposition: "dropped", reason: "Not durable." }] });
  const result = await lintMemImport(output);
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
});
