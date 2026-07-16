import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemImportService } from "./mem-import/service.js";
import type { SourceManifestEntry, StageEnvelope } from "./world-import/types.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-mem-import-tools-"));
}

async function setup(service = new MemImportService()): Promise<{
  root: string;
  input: string;
  output: string;
  run: Awaited<ReturnType<MemImportService["begin"]>>;
  units: SourceManifestEntry[];
}> {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "one.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  await writeFile(join(input, "two.html"), "<html><body><p>Bea carries the silver key.</p></body></html>", "utf-8");
  const run = await service.begin(output);
  const manifest = await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input });
  return { root, input, output, run, units: manifest.units };
}

function validStage(unit: SourceManifestEntry): StageEnvelope {
  return {
    version: 1,
    kind: "extraction",
    unitId: unit.unitId,
    sourceId: unit.sourceId,
    candidates: [{
      id: "local-candidate",
      group: "people",
      title: "Ada",
      provenance: [{
        sourceId: unit.sourceId,
        unitId: unit.unitId,
        startAnchor: unit.anchors[0]!,
        endAnchor: unit.anchors[0]!,
        quote: "Ada guards the glass tower.",
      }],
      payload: { description: "Ada guards the glass tower." },
    }],
    diagnostics: [],
  };
}

test("mem-import typed extraction flow normalizes, scopes reads, and atomically submits", async () => {
  const { input, output, run, units } = await setup();
  assert.equal(units.length, 2);
  const service = new MemImportService();

  const status = await service.status({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant });
  assert.deepEqual(status, { runId: run.runId, normalized: true, unitCount: 2, extractionStageCount: 0 });

  const assignment = await service.assignExtractor({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "extract-one",
    unitIds: [units[0]!.unitId],
  });
  assert.deepEqual(assignment.units, [{
    unitId: units[0]!.unitId,
    sourceId: units[0]!.sourceId,
    order: units[0]!.order,
    ...(units[0]!.title ? { title: units[0]!.title } : {}),
    ...(units[0]!.role ? { role: units[0]!.role } : {}),
    blockCount: units[0]!.blockCount,
  }]);
  const source = await service.readAssignedUnit({ ...assignment, unitId: units[0]!.unitId, maxChars: 1000 });
  assert.match(source.content, /Ada guards the glass tower/);
  assert.equal(source.unit.sourceId, units[0]!.sourceId);

  const submitted = await service.submitExtraction({ ...assignment, unitId: units[0]!.unitId, stage: validStage(units[0]!) });
  assert.deepEqual(submitted, { unitId: units[0]!.unitId, candidateCount: 1 });
  const persisted = JSON.parse(await readFile(join(output, "stages", "extraction", `${units[0]!.unitId}.json`), "utf-8")) as StageEnvelope;
  assert.equal(persisted.candidates?.[0]?.title, "Ada");

  const extractionStatus = await service.extractionStatus(assignment);
  assert.deepEqual(extractionStatus, { assignedUnitIds: [units[0]!.unitId], submittedUnitIds: [units[0]!.unitId], missingUnitIds: [] });
  await assert.rejects(
    service.readAssignedUnit({ ...assignment, unitId: units[1]!.unitId }),
    /outside this extractor assignment/,
  );
  await assert.rejects(
    service.readAssignedUnit({ ...assignment, grant: "forged", unitId: units[0]!.unitId }),
    /Invalid assignment grant/,
  );

  // The legacy input remains usable, but this new path never invoked its helper CLI.
  assert.match(await readFile(join(input, "one.html"), "utf-8"), /Ada guards/);
});

test("mem-import source reads expose an anchor-safe continuation after truncation", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>First source block is deliberately long.</p><p>Second source block is deliberately long.</p><p>Third source block is deliberately long.</p></body></html>", "utf-8");
  const service = new MemImportService();
  const run = await service.begin(output);
  const manifest = await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input });
  const unit = manifest.units[0]!;
  const assignment = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "paginated-read", unitIds: [unit.unitId] });

  const first = await service.readAssignedUnit({ ...assignment, unitId: unit.unitId, maxChars: 50 });
  assert.equal(first.truncated, true);
  assert.equal(first.nextAnchor, unit.anchors[1]);
  assert.equal(first.returnedChars, first.content.length);
  assert.ok(first.totalChars > first.returnedChars);
  assert.match(first.content, /First source block/);
  assert.doesNotMatch(first.content, /Second source block/);

  const remainder = await service.readAssignedUnit({
    ...assignment,
    unitId: unit.unitId,
    startAnchor: first.nextAnchor!,
    endAnchor: unit.anchors.at(-1)!,
    maxChars: 1_000,
  });
  assert.equal(remainder.truncated, false);
  assert.equal(remainder.nextAnchor, undefined);
  assert.match(remainder.content, /Second source block/);
  assert.match(remainder.content, /Third source block/);
});

test("mem-import rejects missing normalization, invalid anchors, revoked, expired, and cross-role assignments", async () => {
  const root = await tempDir();
  const output = join(root, "output");
  let current = new Date("2026-07-15T00:00:00.000Z");
  const service = new MemImportService(() => current);
  const run = await service.begin(output);
  await assert.rejects(
    service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "before-normalize", unitIds: ["missing"] }),
    /Normalize the run/,
  );

  const input = join(root, "input");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  const manifest = await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input });
  const unit = manifest.units[0]!;
  const assignment = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "extract", unitIds: [unit.unitId] });

  const badAnchor = validStage(unit);
  badAnchor.candidates![0]!.provenance[0]!.startAnchor = "b9999";
  await assert.rejects(
    service.submitExtraction({ ...assignment, unitId: unit.unitId, stage: badAnchor }),
    /invalid local anchors/,
  );

  const assignmentPath = join(output, "stages", "orchestration", "assignments", "extract.json");
  const assignmentRecord = JSON.parse(await readFile(assignmentPath, "utf-8")) as Record<string, unknown>;
  assignmentRecord.role = "reviewer";
  await writeFile(assignmentPath, `${JSON.stringify(assignmentRecord, null, 2)}\n`, "utf-8");
  await assert.rejects(
    service.readAssignedUnit({ ...assignment, unitId: unit.unitId }),
    /role is not extractor/,
  );

  assignmentRecord.role = "extractor";
  await writeFile(assignmentPath, `${JSON.stringify(assignmentRecord, null, 2)}\n`, "utf-8");
  await service.revokeAssignment({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: assignment.taskId });
  await assert.rejects(
    service.readAssignedUnit({ ...assignment, unitId: unit.unitId }),
    /was revoked/,
  );

  const expiry = await service.assignExtractor({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "expires",
    unitIds: [unit.unitId],
    expiresAt: "2026-07-15T00:01:00.000Z",
  });
  current = new Date("2026-07-15T00:02:00.000Z");
  await assert.rejects(
    service.readAssignedUnit({ ...expiry, unitId: unit.unitId }),
    /has expired/,
  );
});

test("a child process independently rejects a forged cross-process extractor grant", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const assignment = await service.assignExtractor({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "child-process",
    unitIds: [units[0]!.unitId],
  });
  const script = `
    import { MemImportService } from "./src/mem-import/service.ts";
    const payload = JSON.parse(process.env.MEM_IMPORT_TEST_PAYLOAD);
    try {
      const result = await new MemImportService().readAssignedUnit(payload);
      console.log(JSON.stringify({ ok: true, unitId: result.unit.unitId }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  `;
  const valid = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: { ...process.env, MEM_IMPORT_TEST_PAYLOAD: JSON.stringify({ ...assignment, unitId: units[0]!.unitId }) },
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), { ok: true, unitId: units[0]!.unitId });

  const forged = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: { ...process.env, MEM_IMPORT_TEST_PAYLOAD: JSON.stringify({ ...assignment, grant: "forged", unitId: units[0]!.unitId }) },
  });
  assert.equal(forged.status, 1);
  assert.match(forged.stderr, /Invalid assignment grant/);
});
