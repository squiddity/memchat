import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extractionStagePath,
  mergedCandidatesPath,
  readExtractionStages,
  readImportRun,
  readManifest,
  readMergeStage,
  readNormalizedUnit,
  validateStageEnvelope,
  writeExtractionStage,
  writeJson,
  writeMergeStage,
} from "./mem-import/stage-store.js";
import type { StageEnvelope } from "./mem-import/contracts.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-mem-import-stage-"));
}

const provenance = [{ sourceId: "source", unitId: "unit", startAnchor: "b0001", endAnchor: "b0001", quote: "Exact quote." }];

test("writes and reads extraction and merge envelopes using mem-import paths", async () => {
  const output = await tempDir();
  const extraction: StageEnvelope = {
    version: 1,
    kind: "extraction",
    unitId: "unit",
    sourceId: "source",
    candidates: [{ id: "candidate", group: "facts", title: "Fact", provenance }],
  };
  await writeExtractionStage(output, extraction);
  assert.equal((await readExtractionStages(output))[0]?.unitId, "unit");
  assert.match(extractionStagePath(output, "unit"), /stages\/extraction\/unit\.json$/);

  const merge: StageEnvelope = {
    version: 1,
    kind: "merge",
    artifacts: [{ id: "fact", group: "facts", title: "Fact", sections: [{ heading: "Summary", body: "A fact." }], provenance }],
  };
  await writeMergeStage(output, merge);
  assert.equal((await readMergeStage(output)).artifacts?.[0]?.id, "fact");
  assert.match(mergedCandidatesPath(output), /stages\/merge\/merged-candidates\.json$/);
});

test("rejects symlinked stage and source ancestors before writing externally", async () => {
  const output = await tempDir();
  const outside = await tempDir();
  await symlink(outside, join(output, "stages"));
  await assert.rejects(writeJson(join(output, "stages", "state.json"), { unsafe: true }), /symlinked path component/);
  assert.deepEqual(await readdir(outside), []);

  const outputWithSourcesLink = await tempDir();
  const externalSources = await tempDir();
  await symlink(externalSources, join(outputWithSourcesLink, "sources"));
  await assert.rejects(writeJson(join(outputWithSourcesLink, "sources", "manifest.json"), { unsafe: true }), /symlinked path component/);
  assert.deepEqual(await readdir(externalSources), []);
});

test("stage readers reject symlinked parents/leaves, escapes, and non-regular stage entries", async () => {
  const output = await tempDir();
  const outside = await tempDir();
  await writeFile(join(outside, "manifest.json"), "{}\n");
  await mkdir(join(output, "sources"));
  await symlink(outside, join(output, "sources", "normalized"));
  await assert.rejects(readNormalizedUnit(output, "unit"), /symlinked/);
  await rm(join(output, "sources", "normalized"));
  await symlink(outside, join(output, "sources", "manifest.json"));
  await assert.rejects(readManifest(output), /symlinked/);

  const extractionOutput = await tempDir();
  await mkdir(join(outside, "extraction"));
  await writeFile(join(outside, "extraction", "unit.json"), "{}\n");
  await mkdir(join(extractionOutput, "stages"));
  await symlink(join(outside, "extraction"), join(extractionOutput, "stages", "extraction"));
  await assert.rejects(readExtractionStages(extractionOutput), /symlinked/);

  const mergeOutput = await tempDir();
  await mkdir(join(mergeOutput, "stages", "merge"), { recursive: true });
  await writeFile(join(outside, "merge.json"), "{}\n");
  await symlink(join(outside, "merge.json"), mergedCandidatesPath(mergeOutput));
  await assert.rejects(readMergeStage(mergeOutput), /symlinked/);
  await writeFile(join(outside, "audit.json"), "{}\n");
  await mkdir(join(mergeOutput, "stages"), { recursive: true });
  await symlink(join(outside, "audit.json"), join(mergeOutput, "stages", "import-run.json"));
  await assert.rejects(readImportRun(mergeOutput), /symlinked/);

  const nonRegular = await tempDir();
  await mkdir(join(nonRegular, "stages", "extraction", "nested"), { recursive: true });
  await assert.rejects(readExtractionStages(nonRegular), /not a regular file/);
});

test("atomic JSON writes leave complete JSON without temporary files", async () => {
  const output = await tempDir();
  const path = join(output, "state", "value.json");
  await Promise.all(Array.from({ length: 8 }, (_, index) => writeJson(path, { index, payload: "x".repeat(1000) })));
  const value = JSON.parse(await readFile(path, "utf-8")) as { index: number; payload: string };
  assert.ok(value.index >= 0 && value.index < 8);
  assert.equal(value.payload.length, 1000);
  assert.deepEqual((await readdir(join(output, "state"))).filter((name) => name.endsWith(".tmp")), []);

  assert.throws(() => validateStageEnvelope({ version: 1, kind: "merge", artifacts: [{ id: "duplicate", group: "facts", title: "One", sections: [{ heading: "Summary", body: "one" }], provenance }, { id: "duplicate", group: "facts", title: "Two", sections: [{ heading: "Summary", body: "two" }], provenance }] }), /duplicate artifact id/);
  assert.throws(() => validateStageEnvelope({ version: 1, kind: "review" } as unknown as StageEnvelope), /stage.kind is invalid/);
});
