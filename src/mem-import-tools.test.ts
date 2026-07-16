import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
  assert.equal(submitted.unitId, units[0]!.unitId);
  assert.equal(submitted.candidateCount, 1);
  assert.match(submitted.packetHash, /^[a-f0-9]{64}$/);
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

test("mem-import validates literal single- and multi-block provenance quotes", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Straight quotes can't be changed.</p><p>Second block remains exact.</p></body></html>", "utf-8");
  const service = new MemImportService();
  const run = await service.begin(output);
  const unit = (await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input })).units[0]!;
  const assignment = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "quote-check", unitIds: [unit.unitId] });
  const stage = validStage(unit);
  const ref = stage.candidates![0]!.provenance[0]!;
  ref.quote = "quotes can't be"; // A bounded literal excerpt inside one block.
  await service.validateExtraction({ ...assignment, unitId: unit.unitId, stage });
  ref.endAnchor = unit.anchors[1]!;
  ref.quote = "Straight quotes can't be changed.\n\nSecond block remains exact.";
  await service.validateExtraction({ ...assignment, unitId: unit.unitId, stage });

  for (const quote of [
    "[b0001] Straight quotes can't be changed.",
    "Straight quotes…",
    "Straight quotes can’t be changed.",
    "Not present in this source.",
  ]) {
    ref.quote = quote;
    await assert.rejects(
      service.validateExtraction({ ...assignment, unitId: unit.unitId, stage }),
      /literal contiguous excerpt/,
      quote,
    );
  }
});

test("mem-import source reads use a monotonic cursor even inside one oversized block", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  const oversized = "An oversized source block must be paginated without replaying its prefix. ".repeat(8);
  await writeFile(join(input, "chapter.html"), `<html><body><p>${oversized}</p></body></html>`, "utf-8");
  const service = new MemImportService();
  const run = await service.begin(output);
  const unit = (await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input })).units[0]!;
  const assignment = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "paginated-read", unitIds: [unit.unitId] });

  const pages: string[] = [];
  let page = await service.readAssignedUnit({ ...assignment, unitId: unit.unitId, maxChars: 17 });
  pages.push(page.content);
  assert.equal(page.truncated, true);
  assert.ok(page.continuationCursor);
  while (page.continuationCursor) {
    page = await service.readAssignedUnit({ ...assignment, unitId: unit.unitId, continuationCursor: page.continuationCursor, maxChars: 17 });
    pages.push(page.content);
  }
  assert.equal(page.truncated, false);
  assert.equal(pages.join(""), `[${unit.anchors[0]}] ${oversized.trimEnd()}`);
  assert.ok(pages.every((part, index) => index === 0 || !part.startsWith(pages[0]!)));

  await assert.rejects(
    service.readAssignedUnit({ ...assignment, unitId: unit.unitId, continuationCursor: "not-a-cursor" }),
    /Invalid source continuation cursor/,
  );
  const first = await service.readAssignedUnit({ ...assignment, unitId: unit.unitId, maxChars: 17 });
  const normalizedPath = join(output, "sources", "normalized", `${unit.unitId}.json`);
  const normalized = JSON.parse(await readFile(normalizedPath, "utf-8")) as Record<string, unknown>;
  normalized.contentHash = "replaced-content";
  await writeFile(normalizedPath, `${JSON.stringify(normalized)}\n`, "utf-8");
  await assert.rejects(
    service.readAssignedUnit({ ...assignment, unitId: unit.unitId, continuationCursor: first.continuationCursor! }),
    /Stale source continuation cursor/,
  );
});

test("mem-import prevents live assignment overlap and stale submissions after revoke or supersession", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const unit = units[0]!;
  const first = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "first", unitIds: [unit.unitId] });
  await assert.rejects(
    service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "overlap", unitIds: [unit.unitId] }),
    /live extractor assignment/,
  );

  await service.revokeAssignment({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: first.taskId });
  const retry = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "retry", unitIds: [unit.unitId], retriesTaskId: first.taskId });
  await service.submitExtraction({ ...retry, unitId: unit.unitId, stage: validStage(unit) });
  await assert.rejects(
    service.submitExtraction({ ...first, unitId: unit.unitId, stage: validStage(unit) }),
    /was revoked/,
  );

  const replacement = await service.assignExtractor({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "replacement",
    unitIds: [unit.unitId],
    supersedesTaskIds: [retry.taskId],
  });
  await service.submitExtraction({ ...replacement, unitId: unit.unitId, stage: validStage(unit) });
  await assert.rejects(
    service.submitExtraction({ ...retry, unitId: unit.unitId, stage: validStage(unit) }),
    /was superseded/,
  );

  const retryRecord = JSON.parse(await readFile(join(output, "stages", "orchestration", "assignments", "retry.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(retryRecord.retriesTaskId, first.taskId);
  assert.equal(retryRecord.supersededByTaskId, replacement.taskId);
  assert.equal(retryRecord.lifecycleOutcome, "superseded");
});

test("mem-import persists redacted run, assignment, and packet-effect audit evidence", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  const service = new MemImportService();
  const run = await service.begin(output, { parent: { model: "parent/model", thinking: "high" } });
  const unit = (await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input })).units[0]!;
  const assignment = await service.assignExtractor({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "audited-worker",
    unitIds: [unit.unitId],
    audit: { parent: { model: "parent/model", thinking: "high" }, worker: { model: "worker/model", thinking: "low" }, adapter: "pi-subagents", profile: "mem-import-extractor" },
  });
  const receipt = await service.submitExtraction({ ...assignment, unitId: unit.unitId, stage: validStage(unit) });
  const runRecord = await readFile(join(output, "stages", "orchestration", "run.json"), "utf-8");
  const taskRecord = await readFile(join(output, "stages", "orchestration", "assignments", "audited-worker.json"), "utf-8");
  const effectsDir = join(output, "stages", "orchestration", "effects", "audited-worker");
  const effect = JSON.parse(await readFile(join(effectsDir, (await readdir(effectsDir))[0]!), "utf-8")) as Record<string, unknown>;
  assert.match(runRecord, /parent\/model/);
  assert.match(taskRecord, /worker\/model/);
  assert.match(taskRecord, /pi-subagents/);
  assert.match(taskRecord, /"lifecycleOutcome": "submitted"/);
  assert.doesNotMatch(`${runRecord}\n${taskRecord}`, new RegExp(run.coordinatorGrant));
  assert.doesNotMatch(`${runRecord}\n${taskRecord}`, new RegExp(assignment.grant));
  assert.equal(effect.packetHash, receipt.packetHash);
  assert.equal(effect.taskId, assignment.taskId);
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
