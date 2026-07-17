import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemImportService } from "./mem-import/service.js";
import { MemImportU2Service } from "./mem-import/u2-service.js";
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

test("mem-import merger workers can read any normalized unit and extraction packet", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "extract-for-merger", unitIds: [units[0]!.unitId] });
  await service.submitExtraction({ ...extractor, unitId: units[0]!.unitId, stage: validStage(units[0]!) });
  const merger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "merger-reader", role: "merger" });
  const source = await service.readWorkerUnit({ ...merger, unitId: units[1]!.unitId, maxChars: 1000 });
  assert.match(source.content, /Bea carries the silver key/);
  const filtered = await service.readWorkerExtractions({ ...merger, unitId: units[0]!.unitId });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.unitId, units[0]!.unitId);
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

test("mem-import derives omitted provenance quotes with exact Unicode source typography", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Alice’s question wasn’t answered.</p></body></html>", "utf-8");
  const service = new MemImportService();
  const run = await service.begin(output);
  const unit = (await service.normalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, input })).units[0]!;
  const assignment = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "derived-quote", unitIds: [unit.unitId] });
  const stage = {
    version: 1,
    kind: "extraction",
    unitId: unit.unitId,
    sourceId: unit.sourceId,
    candidates: [{
      id: "alice-question",
      group: "facts",
      title: "Alice’s unanswered question",
      provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0], endAnchor: unit.anchors[0] }],
    }],
  } as unknown as StageEnvelope;
  const submitted = await service.submitExtraction({ ...assignment, unitId: unit.unitId, stage });
  assert.equal(submitted.candidateCount, 1);
  const persisted = JSON.parse(await readFile(join(output, "stages", "extraction", `${unit.unitId}.json`), "utf-8")) as StageEnvelope;
  assert.equal(persisted.candidates?.[0]?.provenance[0]?.quote, "Alice’s question wasn’t answered.");
  const normalizedQuote = persisted.candidates![0]!.provenance[0]!;
  normalizedQuote.quote = "Alice's question wasn't answered.";
  await assert.rejects(
    service.validateExtraction({ ...assignment, unitId: unit.unitId, stage: persisted }),
    /literal contiguous excerpt/,
  );
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

test("mem-import U2 fences merge writes, preserves immutable revisions, and binds reviews", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "u2-extract", unitIds: [unit.unitId] });
  await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });

  const firstLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-merge" });
  const stage = {
    version: 1 as const,
    kind: "merge" as const,
    artifacts: [{
      id: "ada",
      group: "people" as const,
      title: "Ada",
      description: "A guard at the glass tower.",
      sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
      provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
      metadata: { representedCandidateIds: [`${unit.unitId}:local-candidate`] },
    }],
    candidateDispositions: [],
    diagnostics: [],
  };
  const written = await u2.writeCoordinatorMerge({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "parent-merge",
    fence: firstLease.fence,
    expectedRevision: 0,
    expectedContentHash: null,
    stage,
    rationale: "Create the initial canonical Ada artifact from the submitted extraction.",
  });
  assert.equal(written.revision, 1);
  assert.match(written.contentHash!, /^[a-f0-9]{64}$/);
  const persisted = JSON.parse(await readFile(join(output, "stages", "merge", "merged-candidates.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.contentHash, written.contentHash);
  assert.equal(((persisted.artifacts as Array<Record<string, unknown>>)[0]!.provenance as Array<Record<string, unknown>>)[0]!.quote, "Ada guards the glass tower.");
  const revisionFiles = await readdir(join(output, "stages", "merge", "revisions"));
  assert.equal(revisionFiles.length, 1);
  await assert.rejects(
    u2.writeCoordinatorMerge({
      outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-merge", fence: firstLease.fence,
      expectedRevision: 0, expectedContentHash: null, stage, rationale: "Attempt stale replacement.",
    }),
    /Stale merge compare-and-swap/,
  );

  const reviewer = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "u2-review", role: "reviewer" });
  const review = await u2.submitReview({
    ...reviewer,
    packet: {
      version: 1,
      kind: "mem-import-review",
      checkpointId: "quality-1",
      reviewedMergeRevision: written.revision,
      reviewedMergeHash: written.contentHash!,
      findings: [{ id: "finding-1", severity: "warning", summary: "Only one source unit has been extracted." }],
      requestedActions: [{ id: "action-1", type: "record-omission", severity: "repair", summary: "Extract the remaining body unit.", rationale: "Coverage diagnostics identify an unprocessed unit." }],
    },
  });
  assert.match(review.path, /^stages\/reviews\/quality-1\/u2-review-/);
  const reviewPacket = JSON.parse(await readFile(join(output, review.path), "utf-8")) as Record<string, unknown>;
  assert.equal(reviewPacket.reviewedMergeHash, written.contentHash);
  assert.doesNotMatch(JSON.stringify(reviewPacket), new RegExp(reviewer.grant));
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-merge", fence: firstLease.fence });

  await assert.rejects(
    service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "unbounded-repair", role: "repairer" }),
    /require explicit checkpointIds and actionIds/,
  );
  const finalLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-finalize" });
  const final = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-finalize", fence: finalLease.fence });
  assert.equal(final.finalized, false, "one unextracted body unit remains a hard blocker");
  const audit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(audit.version, 2);
  assert.equal(audit.status, "failed");
  assert.equal((audit.finalization as Record<string, unknown>).passed, false);
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-finalize", fence: finalLease.fence });
});

test("mem-import records a terminal safe failure when mandatory delegation is unavailable", async () => {
  const root = await tempDir();
  const output = join(root, "output");
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const run = await service.begin(output);
  const receipt = await u2.fail({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    reasonCode: "no-enforced-subagent-facility",
    message: "No facility could enforce the extractor and merger tool allowlists.",
  });
  assert.equal(receipt.auditPath, "stages/import-run.json");
  const audit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(audit.version, 2);
  assert.equal(audit.status, "failed");
  assert.match(String(audit.error), /no-enforced-subagent-facility/);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(run.coordinatorGrant));
});

test("mem-import U2 rejects concurrent and stale fenced merge writers", async () => {
  let current = new Date("2026-07-16T00:00:00.000Z");
  const service = new MemImportService(() => current);
  const u2 = new MemImportU2Service(service, () => current);
  const { output, run } = await setup(service);
  const merger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "merger", role: "merger" });
  const first = await u2.acquireWorkerLease(merger);
  await assert.rejects(
    u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent" }),
    /live merge writer lease/,
  );
  current = new Date("2026-07-16T00:06:00.000Z");
  const recovered = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent" });
  assert.ok(recovered.fence > first.fence);
  await assert.rejects(
    u2.heartbeatWorkerLease({ ...merger, fence: first.fence }),
    /expired|fence or owner/,
  );
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent", fence: recovered.fence });
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
