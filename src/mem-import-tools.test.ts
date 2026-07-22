import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MEM_IMPORT_ROLE_TOOLS, MemImportService, type AssignmentRole } from "./mem-import/service.js";
import { MemImportU2Service, toMergeMutationReceipt } from "./mem-import/u2-service.js";
import { MemImportProposalService } from "./mem-import/proposal-service.js";
import { MemImportCompendiumService, projectCompendium } from "./mem-import/compendium-service.js";
import { MemImportIdentityService, canonicalHash } from "./mem-import/identity-service.js";
import { buildCoveragePlan } from "./world-import/helper-tools.js";
import type { SourceManifestEntry, StageEnvelope } from "./world-import/types.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-mem-import-tools-"));
}

function serializedModelToolResultSize(value: unknown): number {
  return JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value }).length;
}

async function recordDispatch(service: MemImportService, run: { outputRoot: string; runId: string; coordinatorGrant: string }, taskId: string, role: AssignmentRole): Promise<void> {
  const tools = MEM_IMPORT_ROLE_TOOLS[role];
  await service.recordWorkerDispatch({ ...run, taskId, facility: "ordinary-subagent", hostTaskId: `host-${taskId}`, requestedTools: tools, observedTools: tools, outcome: "completed" });
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
  const brief = await service.assignmentBrief({ ...run, taskId: assignment.taskId, grant: assignment.grant });
  assert.deepEqual(brief, { outputRoot: output, runId: run.runId, taskId: assignment.taskId, grant: assignment.grant, role: "extractor", units: [{ unitId: units[0]!.unitId, sourceId: units[0]!.sourceId }], candidateIds: [], proposalHashes: [], checkpointIds: [], actionIds: [], tools: MEM_IMPORT_ROLE_TOOLS.extractor });
  assert.deepEqual(assignment.tools, MEM_IMPORT_ROLE_TOOLS.extractor);
  await assert.rejects(service.assignmentBrief({ ...run, taskId: assignment.taskId, grant: "forged" }), /Invalid assignment grant/);
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

test("mem-import compendia isolate run roots and record duplicate work sources", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const compendiumRoot = join(root, "compendium");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  const base = new MemImportService();
  const compendia = new MemImportCompendiumService(base);
  const first = await compendia.begin({ compendiumRoot, compendiumId: "glass-series", workId: "book-one" });
  const firstNormalized = await compendia.normalize({ ...first, input });
  assert.equal(firstNormalized.duplicateOfRunId, undefined);
  const second = await compendia.begin({ compendiumRoot, compendiumId: "glass-series", workId: "book-one-edition-two" });
  const secondNormalized = await compendia.normalize({ ...second, input });
  assert.equal(secondNormalized.duplicateOfRunId, first.runId);
  assert.notEqual(first.outputRoot, second.outputRoot);
  assert.match(first.outputRoot, /stages\/runs\/pending-/);
  const record = await compendia.inspect(compendiumRoot);
  assert.equal(record.runs.length, 2);
  assert.equal(record.runs[1]!.duplicateOfRunId, first.runId);
  const projection = await projectCompendium(compendiumRoot);
  assert.equal(projection.sourceUnits, firstNormalized.manifest.units.length);
  assert.ok(existsSync(join(compendiumRoot, "sources", "manifest.json")));
  assert.ok(existsSync(join(compendiumRoot, projection.sourceLocatorPath)));

  const u2 = new MemImportU2Service(base);
  const unit = firstNormalized.manifest.units[0]!;
  const lease = await u2.acquireCoordinatorLease({ outputRoot: first.outputRoot, runId: first.runId, coordinatorGrant: first.coordinatorGrant, taskId: "compendium-merge" });
  const merged = await u2.writeCoordinatorMerge({
    outputRoot: first.outputRoot,
    runId: first.runId,
    coordinatorGrant: first.coordinatorGrant,
    taskId: "compendium-merge",
    fence: lease.fence,
    expectedRevision: 0,
    expectedContentHash: null,
    rationale: "Seed the shared compendium canonical state.",
    stage: {
      version: 1,
      kind: "merge",
      artifacts: [{ id: "ada", group: "people", title: "Ada", description: "A guard.", sections: [{ heading: "Summary", body: "Ada guards the glass tower." }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] }],
      candidateDispositions: [],
      diagnostics: [],
    },
  });
  assert.equal(merged.revision, 1);
  assert.ok(existsSync(join(compendiumRoot, "stages", "merge", "merged-candidates.json")));
  assert.equal(existsSync(join(first.outputRoot, "stages", "merge", "merged-candidates.json")), false);
  await u2.releaseCoordinatorLease({ outputRoot: first.outputRoot, runId: first.runId, coordinatorGrant: first.coordinatorGrant, taskId: "compendium-merge", fence: lease.fence });
});

test("mem-import compendium integration projects two work runs through finalization", async () => {
  const root = await tempDir();
  const compendiumRoot = join(root, "compendium");
  const base = new MemImportService();
  const compendia = new MemImportCompendiumService(base);
  const proposals = new MemImportProposalService(base);
  const identities = new MemImportIdentityService(base);
  const u2 = new MemImportU2Service(base);

  async function importWork(workId: string, sourceFile: string, sentence: string, person: string, artifactId: string, matchExisting = false) {
    const input = join(root, `${workId}-input`);
    await mkdir(input);
    await writeFile(join(input, sourceFile), `<html><body><p>${sentence}</p></body></html>`, "utf-8");
    const run = await compendia.begin({ compendiumRoot, compendiumId: "glass-series", workId });
    const normalized = await compendia.normalize({ ...run, input });
    const unit = normalized.manifest.units[0]!;
    const extractor = await base.assignExtractor({ outputRoot: run.outputRoot, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: `${workId}-extract`, unitIds: [unit.unitId] });
    await recordDispatch(base, run, extractor.taskId, "extractor");
    const extracted = await base.submitExtraction({
      ...extractor,
      unitId: unit.unitId,
      stage: {
        version: 1,
        kind: "extraction",
        unitId: unit.unitId,
        sourceId: unit.sourceId,
        candidates: [{ id: "person", group: "people", title: person, provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] }],
      },
    });
    const artifact = { id: artifactId, group: "people", title: person, description: sentence, sections: [{ heading: "Summary", body: sentence }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }], metadata: { representedCandidateIds: [`${unit.unitId}:person`] } };
    const proposer = await base.assignWorker({ outputRoot: run.outputRoot, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: `${workId}-propose`, role: "proposer", unitIds: [unit.unitId] });
    await recordDispatch(base, run, proposer.taskId, "proposer");
    const proposal = await proposals.submitWorkerProposal({ ...proposer, packet: { version: 1, kind: "mem-import-proposal", id: `${workId}-shard`, inputs: [{ unitId: unit.unitId, packetHash: extracted.packetHash, candidateIds: ["person"] }], artifacts: [artifact], candidateDispositions: [{ unitId: unit.unitId, candidateId: "person", disposition: "represented", artifactId }], rationale: `Propose ${person} from ${workId}.` } });
    const merger = await base.assignWorker({ outputRoot: run.outputRoot, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: `${workId}-merge`, role: "merger" });
    await recordDispatch(base, run, merger.taskId, "merger");
    const state = await u2.mergeState(run);
    const existing = state.stage.artifacts?.find((item) => item.id === artifactId);
    // The model-owned edition update explicitly preserves prior evidence so coverage remains cumulative.
    const canonicalArtifact = matchExisting && existing ? { ...artifact, provenance: [...existing.provenance, ...artifact.provenance] } : artifact;
    let identityProposalHash: string | undefined;
    if (matchExisting) {
      const reconciler = await base.assignWorker({ outputRoot: run.outputRoot, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: `${workId}-reconcile`, role: "reconciler", proposalHashes: [proposal.contentHash] });
      await recordDispatch(base, run, reconciler.taskId, "reconciler");
      const identity = await identities.submitWorkerIdentity({ ...reconciler, packet: { version: 1, kind: "mem-import-identity", id: `${workId}-ada-match`, proposalHashes: [proposal.contentHash], baselineRevision: state.revision, baselineContentHash: state.contentHash, decisions: [{ id: `${workId}-ada-match-decision`, provisionalId: `${workId}-ada`, disposition: "match", canonicalId: artifactId, rationale: "The edition evidence identifies the existing canonical Ada." }], rationale: "Preserve continuity across the edition repeat." } });
      identityProposalHash = identity.contentHash;
    }
    const lease = await u2.acquireWorkerLease(merger);
    const result = await u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: state.revision, expectedContentHash: state.contentHash, batch: { proposalHashes: [proposal.contentHash], ...(identityProposalHash ? { identityProposalHashes: [identityProposalHash] } : {}), readSet: [{ artifactId, contentHash: existing ? canonicalHash(existing) : null }], operations: [{ kind: "upsert", artifact: canonicalArtifact }], candidateDispositions: [{ unitId: unit.unitId, candidateId: "person", disposition: "represented", artifactId }], rationale: `Accept ${person}.` } });
    await u2.releaseWorkerLease({ ...merger, fence: lease.fence });
    return { run, result };
  }

  const first = await importWork("book-one", "one.html", "Ada guards the glass tower.", "Ada", "ada");
  const second = await importWork("book-two", "two.html", "Bea carries the silver key.", "Bea", "bea");
  const edition = await importWork("book-one-edition-two", "one-edition-two.html", "Ada returns to guard the glass tower.", "Ada", "ada", true);
  assert.equal(second.result.revision, 2);
  assert.equal(edition.result.revision, 3);
  assert.equal(edition.result.stage.artifacts?.filter((item) => item.id === "ada").length, 1, "edition repeat updates the matched canonical artifact instead of creating a duplicate");
  const checks = await u2.checks(edition.run);
  assert.equal(checks.deterministic.passed, false, "pre-finalization checks correctly require an emitted shared projection");
  const finalizeLease = await u2.acquireCoordinatorLease({ ...edition.run, taskId: "compendium-finalize" });
  const final = await u2.finalize({ ...edition.run, taskId: "compendium-finalize", fence: finalizeLease.fence });
  assert.equal(final.finalized, true, await readFile(join(compendiumRoot, final.checksPath), "utf-8"));
  assert.ok(existsSync(join(compendiumRoot, "world", "people", "ada.md")));
  assert.ok(existsSync(join(compendiumRoot, "world", "people", "bea.md")));
  await u2.releaseCoordinatorLease({ ...edition.run, taskId: "compendium-finalize", fence: finalizeLease.fence });
});

test("mem-import compendium keeps ten sequential work runs distinct in its shared projection", async () => {
  const root = await tempDir();
  const compendiumRoot = join(root, "series");
  const service = new MemImportService();
  const compendia = new MemImportCompendiumService(service);
  for (let index = 0; index < 10; index += 1) {
    const input = join(root, `book-${index}`);
    await mkdir(input);
    await writeFile(join(input, `chapter-${index}.html`), `<html><body><p>Ada returns to the Glass Tower in book ${index}.</p></body></html>`, "utf-8");
    const run = await compendia.begin({ compendiumRoot, compendiumId: "glass-series", workId: `book-${index}` });
    await compendia.normalize({ ...run, input });
  }
  const record = await compendia.inspect(compendiumRoot);
  assert.equal(record.runs.length, 10);
  assert.equal(new Set(record.runs.map((run) => run.runId)).size, 10);
  assert.equal(new Set(record.runs.map((run) => run.sourceHash)).size, 10);
  const projection = await projectCompendium(compendiumRoot);
  assert.equal(projection.sourceUnits, 10);
  assert.equal(projection.extractionPackets, 0);
});

test("mem-import merger workers can read any normalized unit and extraction packet", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "extract-for-merger", unitIds: [units[0]!.unitId] });
  await service.submitExtraction({ ...extractor, unitId: units[0]!.unitId, stage: validStage(units[0]!) });
  const merger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "merger-reader", role: "merger" });
  const source = await service.readWorkerUnit({ ...merger, unitId: units[1]!.unitId, maxChars: 1000 });
  assert.match(source.content, /Bea carries the silver key/);
  const inventory = await service.readWorkerExtractionInventory({ ...merger, maxItems: 10 });
  assert.deepEqual(inventory.entries.map((entry) => entry.unitId), [units[0]!.unitId]);
  assert.equal(inventory.entries[0]!.candidateCount, 1);
  const filtered = await service.readWorkerExtractions({ ...merger, unitId: units[0]!.unitId });
  assert.equal(filtered?.totalCandidates, 1);
  assert.equal(filtered?.candidates[0]!.id, "local-candidate");
});

test("mem-import extraction inventories page in source order and retain group filters", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "inventory-extract", unitIds: units.map((unit) => unit.unitId) });
  await service.submitExtraction({ ...extractor, unitId: units[0]!.unitId, stage: validStage(units[0]!) });
  const bea = validStage(units[1]!);
  bea.candidates![0]!.title = "Bea";
  bea.candidates![0]!.provenance[0]!.quote = "Bea carries the silver key.";
  await service.submitExtraction({ ...extractor, unitId: units[1]!.unitId, stage: bea });
  const reviewer = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "inventory-review", role: "reviewer" });

  const first = await service.readWorkerExtractionInventory({ ...reviewer, maxItems: 1, group: "people" });
  assert.equal(first.entries.length, 1);
  assert.equal(first.truncated, true);
  assert.ok(first.continuationCursor);
  const second = await service.readWorkerExtractionInventory({ ...reviewer, maxItems: 1, group: "people", continuationCursor: first.continuationCursor });
  assert.equal(second.entries.length, 1);
  assert.equal(second.truncated, false);
  assert.deepEqual([...first.entries, ...second.entries].map((entry) => entry.unitId), units.map((unit) => unit.unitId));
  await assert.rejects(
    service.readWorkerExtractionInventory({ ...reviewer, group: "facts", continuationCursor: first.continuationCursor }),
    /does not match the requested group filter/,
  );
});

test("mem-import worker extraction reads are bounded, filtered, and monotonic", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "bounded-extract", unitIds: [unit.unitId] });
  const stage = validStage(unit);
  stage.candidates = Array.from({ length: 105 }, (_, index) => ({
    ...stage.candidates![0]!,
    id: `candidate-${String(index).padStart(3, "0")}`,
    title: `Ada ${index}`,
  }));
  await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage });
  const coordinatorFirst = await service.inspectExtractionCandidates({ ...run, unitId: unit.unitId, maxItems: 50 });
  assert.equal(coordinatorFirst.totalCandidates, 105);
  assert.equal(coordinatorFirst.candidates.length, 50);
  assert.deepEqual(coordinatorFirst.candidates[0], { id: "candidate-000", group: "people", title: "Ada 0" });
  assert.equal(coordinatorFirst.truncated, true);
  assert.ok(coordinatorFirst.continuationCursor);
  const coordinatorSecond = await service.inspectExtractionCandidates({ ...run, unitId: unit.unitId, maxItems: 50, continuationCursor: coordinatorFirst.continuationCursor });
  assert.equal(coordinatorSecond.candidates.length, 50);
  await assert.rejects(
    service.inspectExtractionCandidates({ ...run, unitId: units[1]!.unitId, continuationCursor: coordinatorFirst.continuationCursor }),
    /does not exist|stale or belongs to another packet/,
  );

  const merger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "bounded-reader", role: "merger" });

  const first = await service.readWorkerExtractions({ ...merger, unitId: unit.unitId, maxCandidates: 50 });
  assert.equal(first?.totalCandidates, 105);
  assert.equal(first?.candidates.length, 50);
  assert.equal(first?.truncated, true);
  assert.ok(first?.continuationCursor);
  const second = await service.readWorkerExtractions({ ...merger, unitId: unit.unitId, maxCandidates: 50, continuationCursor: first!.continuationCursor });
  assert.equal(second?.candidates.length, 50);
  const final = await service.readWorkerExtractions({ ...merger, unitId: unit.unitId, maxCandidates: 50, continuationCursor: second!.continuationCursor });
  assert.equal(final?.candidates.length, 5);
  assert.equal(final?.truncated, false);
  assert.deepEqual([...first!.candidates, ...second!.candidates, ...final!.candidates].map((candidate) => candidate.id), stage.candidates.map((candidate) => candidate.id));

  const subset = await service.readWorkerExtractions({ ...merger, unitId: unit.unitId, candidateIds: ["candidate-004", "candidate-099"] });
  assert.deepEqual(subset?.candidates.map((candidate) => candidate.id), ["candidate-004", "candidate-099"]);
  await assert.rejects(
    service.readWorkerExtractions({ ...merger, unitId: unit.unitId, maxCandidates: 101 }),
    /between 1 and 100/,
  );
});

test("mem-import persists immutable scoped shard proposals against exact extraction hashes", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "proposal-extract", unitIds: [unit.unitId] });
  const submitted = await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  const autoQualified = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "proposal-unqualified", role: "proposer", unitIds: [unit.unitId], candidateIds: ["local-candidate"] });
  assert.deepEqual(autoQualified.candidateIds, [`${unit.unitId}:local-candidate`]);
  const proposer = await service.assignWorker({
    outputRoot: output,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    taskId: "proposal-author",
    role: "proposer",
    unitIds: [unit.unitId],
    candidateIds: [`${unit.unitId}:local-candidate`],
  });
  const packet = {
    version: 1 as const,
    kind: "mem-import-proposal" as const,
    id: "ada-shard",
    inputs: [{ unitId: unit.unitId, packetHash: submitted.packetHash, candidateIds: ["local-candidate"] }],
    artifacts: [{
      id: "ada",
      group: "people",
      title: "Ada",
      description: "A guard at the glass tower.",
      sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
      provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
    }],
    candidateDispositions: [],
    rationale: "Preserve the local Ada evidence for later canonical reconciliation.",
  };
  await assert.rejects(
    proposals.submitWorkerProposalBody({ ...proposer, artifacts: packet.artifacts, candidateDispositions: [], rationale: packet.rationale }),
    /must account for every assigned candidate/,
  );
  const persisted = await proposals.submitWorkerProposalBody({
    ...proposer,
    artifacts: packet.artifacts,
    candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }],
    rationale: packet.rationale,
  });
  assert.match(persisted.path, new RegExp(`^stages/runs/${run.runId}/proposals/proposal-author-`));
  const stored = JSON.parse(await readFile(join(output, persisted.path), "utf-8")) as Record<string, unknown>;
  assert.equal(stored.contentHash, persisted.contentHash);
  assert.equal((((stored.artifacts as Array<Record<string, unknown>>)[0]!.provenance as Array<Record<string, unknown>>)[0]!.quote), "Ada guards the glass tower.");

  const u2 = new MemImportU2Service(service);
  const merger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "proposal-merger", role: "merger" });
  assert.deepEqual(merger.tools, MEM_IMPORT_ROLE_TOOLS.merger);
  const proposalInventory = await proposals.inventoryWorkerProposals({ ...merger, maxItems: 1 });
  assert.deepEqual(proposalInventory.entries.map((entry) => entry.proposalHash), [persisted.contentHash]);
  const proposalRead = await proposals.readWorkerProposal({ ...merger, proposalHash: persisted.contentHash, maxArtifacts: 1 });
  assert.equal((proposalRead.artifacts[0] as { id: string }).id, "ada");
  const beforeStatus = await u2.workStatus(run);
  assert.equal(beforeStatus.unconsumedProposalCount, 1);
  assert.equal(beforeStatus.unaccountedCandidateCount, 1);
  const mergeReceipt = await u2.commitWorkerBatchReceipt({
    ...merger,
    proposalHashes: [persisted.contentHash],
    readSet: [{ artifactId: "ada" }],
    changes: [{ kind: "accept", proposalHash: persisted.contentHash, artifactId: "ada" }],
    rationale: "Accept the bounded Ada shard proposal into canonical state.",
  });
  assert.deepEqual(mergeReceipt, {
    revision: 1,
    contentHash: mergeReceipt.contentHash,
    parentContentHash: null,
    artifactCount: 1,
    candidateDispositionCount: 1,
    consumedProposalHashes: [persisted.contentHash],
  });
  assert.ok(serializedModelToolResultSize(mergeReceipt) < 10_000);
  assert.equal("stage" in mergeReceipt, false);
  const merged = await u2.mergeState(run);
  assert.equal(merged.revision, 1);
  assert.equal(merged.stage.artifacts?.[0]?.id, "ada");
  const canonicalInventory = await u2.readMergeInventoryForWorker({ ...merger, maxItems: 1, group: "people" });
  assert.deepEqual(canonicalInventory.entries.map((entry) => entry.id), ["ada"]);
  assert.match(canonicalInventory.entries[0]!.artifactContentHash, /^[a-f0-9]{64}$/);
  assert.equal(canonicalInventory.revision, merged.revision);
  const canonicalArtifact = await u2.readMergeArtifactForWorker({ ...merger, artifactId: "ada" });
  assert.equal(canonicalArtifact.artifact?.title, "Ada");
  assert.equal(canonicalArtifact.artifactContentHash, canonicalInventory.entries[0]!.artifactContentHash);
  await assert.rejects(
    u2.commitWorkerBatchReceipt({
      ...merger,
      proposalHashes: [persisted.contentHash],
      readSet: [{ artifactId: "ada", contentHash: canonicalArtifact.artifactContentHash }],
      changes: [{ kind: "accept", proposalHash: persisted.contentHash, artifactId: "ada" }],
      rationale: "A repeated unchanged accept must not create another revision.",
    }),
    /semantic no-op/,
  );
  assert.equal((await readdir(join(output, "stages", "merge", "transactions"))).length, 1);
  assert.equal((await u2.mergeState(run)).revision, 1);
  assert.deepEqual(merged.stage.candidateDispositions, [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }]);
  const coverage = await buildCoveragePlan(output);
  assert.deepEqual(coverage.candidateAccounting, { totalCandidates: 1, represented: 1, merged: 0, deferred: 0, dropped: 0, unaccounted: [] });
  const afterStatus = await u2.workStatus(run);
  assert.equal(afterStatus.unconsumedProposalCount, 0);
  assert.equal(afterStatus.unaccountedCandidateCount, 0);

  const reviewer = await service.assignWorker({ ...run, taskId: "proposal-reviewer", role: "reviewer" });
  await u2.submitReview({
    ...reviewer,
    packet: {
      version: 1,
      kind: "mem-import-review",
      checkpointId: "proposal-quality",
      reviewedMergeRevision: merged.revision,
      reviewedMergeHash: merged.contentHash!,
      findings: [{ id: "repair-ada-description", severity: "repair", summary: "Clarify Ada's canonical description.", requestedActionIds: ["clarify-ada"] }],
      requestedActions: [{ id: "clarify-ada", type: "clarify-description", severity: "repair", summary: "Clarify Ada's canonical description." }],
      readSet: [{ artifactId: "ada", contentHash: canonicalArtifact.artifactContentHash }],
    },
  });
  const repairer = await service.assignWorker({ ...run, taskId: "proposal-repairer", role: "repairer", checkpointIds: ["proposal-quality"], actionIds: ["clarify-ada"] });
  const repairLease = await u2.acquireWorkerLease(repairer);
  const repairedArtifact = { ...canonicalArtifact.artifact!, description: "Ada is the guard at the glass tower." };
  const repairReceipt = await u2.applyWorkerRepairBatchReceipt({
    ...repairer,
    fence: repairLease.fence,
    expectedRevision: merged.revision,
    expectedContentHash: merged.contentHash,
    checkpointId: "proposal-quality",
    actionIds: ["clarify-ada"],
    batch: {
      proposalHashes: [persisted.contentHash],
      readSet: [{ artifactId: "ada", contentHash: canonicalArtifact.artifactContentHash }],
      operations: [{ kind: "upsert", artifact: repairedArtifact }],
      rationale: "Apply the review-scoped description clarification.",
    },
  });
  await u2.releaseWorkerLease({ ...repairer, fence: repairLease.fence });
  assert.equal(repairReceipt.revision, 2);
  assert.equal(repairReceipt.parentContentHash, merged.contentHash);
  assert.equal(repairReceipt.artifactCount, 1);
  assert.equal(repairReceipt.candidateDispositionCount, 1);
  assert.deepEqual(repairReceipt.consumedProposalHashes, [persisted.contentHash]);
  assert.ok(serializedModelToolResultSize(repairReceipt) < 10_000);
  assert.equal("stage" in repairReceipt, false);
  const controls = await u2.mergeControls(run);
  assert.equal(controls.revision, repairReceipt.revision);
  assert.equal(controls.contentHash, repairReceipt.contentHash);
  assert.equal(controls.artifactCount, 1);
  assert.equal(controls.candidateDispositionCount, 1);
  assert.equal(controls.consumedProposalCount, 1);
  assert.equal(controls.unaccountedCandidateCount, 0);
  assert.deepEqual(controls.reviewValidity, {
    current: false,
    currentReviewCount: 0,
    staleReviewCount: 1,
    unaffectedReviewCount: 0,
    unscopedReviewCount: 0,
  });
  assert.ok(serializedModelToolResultSize(controls) < 10_000);
  assert.equal("stage" in controls, false);
  assert.equal("artifacts" in controls, false);
  assert.equal("candidateDispositions" in controls, false);

  const transactionFiles = await readdir(join(output, "stages", "merge", "transactions"));
  assert.equal(transactionFiles.length, 2);
  await assert.rejects(
    u2.commitWorkerBatch({ ...merger, proposalHashes: [persisted.contentHash], readSet: [{ artifactId: "ada", contentHash: merged.contentHash }], changes: [{ kind: "accept", proposalHash: persisted.contentHash, artifactId: "ada" }], rationale: "A global merge hash is not an artifact read token." }),
    /Stale merge read set/,
  );
  await assert.rejects(
    proposals.submitWorkerProposal({ ...proposer, packet: { ...packet, id: "wrong-candidate", inputs: [{ ...packet.inputs[0]!, candidateIds: ["not-assigned"] }] } }),
    /does not exist|outside this assignment/,
  );

  const replacement = validStage(unit);
  replacement.candidates![0]!.title = "Ada, tower guard";
  await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: replacement });
  await assert.rejects(
    proposals.submitWorkerProposal({ ...proposer, packet: { ...packet, id: "stale-input" } }),
    /stale or invalid/,
  );
});

test("mem-import derives provenance quotes even when a worker supplies mismatched typography", async () => {
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
  ref.endAnchor = unit.anchors[1]!;
  ref.quote = "Straight quotes can’t be changed."; // Service must ignore this worker transcription.
  await service.validateExtraction({ ...assignment, unitId: unit.unitId, stage });
  await service.submitExtraction({ ...assignment, unitId: unit.unitId, stage });
  const persisted = JSON.parse(await readFile(join(output, "stages", "extraction", `${unit.unitId}.json`), "utf-8")) as StageEnvelope;
  assert.equal(persisted.candidates![0]!.provenance[0]!.quote, "Straight quotes can't be changed.\n\nSecond block remains exact.");
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
  await service.validateExtraction({ ...assignment, unitId: unit.unitId, stage: persisted });
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
  const tools = MEM_IMPORT_ROLE_TOOLS.extractor;
  await service.recordWorkerDispatch({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: first.taskId, facility: "ordinary-subagent", hostTaskId: "interrupted-extractor", requestedTools: tools, observedTools: tools, outcome: "cancelled" });
  const retry = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "retry", unitIds: [unit.unitId], retriesTaskId: first.taskId });
  await service.recordWorkerDispatch({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: retry.taskId, facility: "ordinary-subagent", hostTaskId: "resumed-extractor", requestedTools: tools, observedTools: tools, outcome: "completed" });
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
  const interruptedDispatch = JSON.parse(await readFile(join(output, "stages", "orchestration", "dispatches", "first.json"), "utf-8")) as { outcome: string; hostTaskId: string };
  const resumedDispatch = JSON.parse(await readFile(join(output, "stages", "orchestration", "dispatches", "retry.json"), "utf-8")) as { outcome: string; hostTaskId: string };
  assert.equal(interruptedDispatch.outcome, "cancelled");
  assert.equal(interruptedDispatch.hostTaskId, "interrupted-extractor");
  assert.equal(resumedDispatch.outcome, "completed");
  assert.equal(resumedDispatch.hostTaskId, "resumed-extractor");
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
  const leakedSnapshotMerger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "u2-leaked-snapshot", role: "merger" });
  await assert.rejects(
    u2.writeWorkerMerge({ ...leakedSnapshotMerger, fence: firstLease.fence, expectedRevision: written.revision, expectedContentHash: written.contentHash, stage, rationale: "A leaked snapshot tool must not bypass bounded merger batches." }),
    /Worker complete snapshot writes are disabled/,
  );
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
      readSet: [{ artifactId: "ada", contentHash: canonicalHash(written.stage.artifacts![0]) }],
    },
  });
  assert.match(review.path, /^stages\/reviews\/quality-1\/u2-review-/);
  const reviewPacket = JSON.parse(await readFile(join(output, review.path), "utf-8")) as Record<string, unknown>;
  assert.equal(reviewPacket.reviewedMergeHash, written.contentHash);
  assert.doesNotMatch(JSON.stringify(reviewPacket), new RegExp(reviewer.grant));
  const currentValidity = JSON.parse(await readFile(join(output, "stages", "reviews", "validity.json"), "utf-8")) as { entries: Array<{ status: string }> };
  assert.equal(currentValidity.entries[0]!.status, "current");
  await u2.writeCoordinatorMerge({
    outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-merge", fence: firstLease.fence,
    expectedRevision: written.revision, expectedContentHash: written.contentHash,
    stage: { ...stage, artifacts: [{ ...stage.artifacts[0]!, description: "Ada is the guard of the glass tower." }] },
    rationale: "Change the reviewed Ada artifact to test read-set invalidation.",
  });
  const staleValidity = JSON.parse(await readFile(join(output, "stages", "reviews", "validity.json"), "utf-8")) as { entries: Array<{ status: string }> };
  assert.equal(staleValidity.entries[0]!.status, "stale");
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

test("mem-import finalization rejects inline, managed, or missing semantic dispatch receipts", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-extract", unitIds: units.map((unit) => unit.unitId) });
  await service.submitExtraction({ ...extractor, unitId: units[0]!.unitId, stage: validStage(units[0]!) });
  await service.submitExtraction({ ...extractor, unitId: units[1]!.unitId, stage: { version: 1, kind: "extraction", unitId: units[1]!.unitId, sourceId: units[1]!.sourceId, candidates: [] } });
  const lease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-merge" });
  await u2.writeCoordinatorMerge({
    outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-merge", fence: lease.fence, expectedRevision: 0, expectedContentHash: null,
    rationale: "Create a complete test merge.",
    stage: { version: 1, kind: "merge", artifacts: [{ id: "ada", group: "people", title: "Ada", description: "A guard.", sections: [{ heading: "Summary", body: "Ada guards the glass tower." }], provenance: [{ sourceId: units[0]!.sourceId, unitId: units[0]!.unitId, startAnchor: units[0]!.anchors[0]!, endAnchor: units[0]!.anchors[0]! }, { sourceId: units[1]!.sourceId, unitId: units[1]!.unitId, startAnchor: units[1]!.anchors[0]!, endAnchor: units[1]!.anchors[0]! }], metadata: { representedCandidateIds: [`${units[0]!.unitId}:local-candidate`] } }], candidateDispositions: [{ unitId: units[0]!.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }], diagnostics: [] },
  });
  const missing = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-merge", fence: lease.fence });
  assert.equal(missing.finalized, false);
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-merge", fence: lease.fence });

  const tools = MEM_IMPORT_ROLE_TOOLS.extractor;
  await assert.rejects(
    service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "ordinary-subagent", hostTaskId: "/private/session.jsonl", requestedTools: tools, observedTools: tools, outcome: "completed" }),
    /sanitized opaque identifier/,
  );
  await service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "managed-agent", hostTaskId: "managed-extract", requestedTools: tools, observedTools: tools, outcome: "completed" });
  const managedLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-finalize" });
  const managed = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-finalize", fence: managedLease.fence });
  assert.equal(managed.finalized, false);
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-finalize", fence: managedLease.fence });

  await recordDispatch(service, run, extractor.taskId, "extractor");
  const finalLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-success" });
  const final = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-success", fence: finalLease.fence });
  assert.equal(final.finalized, true, await readFile(join(output, final.checksPath), "utf-8"));
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-success", fence: finalLease.fence });
  const terminalRun = JSON.parse(await readFile(join(output, "stages", "orchestration", "run.json"), "utf-8")) as { terminal?: { status?: string } };
  assert.equal(terminalRun.terminal?.status, "finalized");
  assert.equal((await service.status(run)).normalized, true);
  await assert.rejects(service.assignWorker({ ...run, taskId: "after-finalization", role: "reviewer" }), /run is terminal/);
  await assert.rejects(u2.acquireCoordinatorLease({ ...run, taskId: "after-finalization" }), /run is terminal/);
});

test("mem-import explicit failure is terminal for every semantic mutation surface", async () => {
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const proposals = new MemImportProposalService(service);
  const identities = new MemImportIdentityService(service);
  const { output, run, units } = await setup(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "terminal-extractor", unitIds: [unit.unitId] });
  const proposer = await service.assignWorker({ ...run, taskId: "terminal-proposer", role: "proposer", unitIds: [unit.unitId] });
  const reconciler = await service.assignWorker({ ...run, taskId: "terminal-reconciler", role: "reconciler", proposalHashes: ["a".repeat(64)] });
  const merger = await service.assignWorker({ ...run, taskId: "terminal-merger", role: "merger" });
  const reviewer = await service.assignWorker({ ...run, taskId: "terminal-reviewer", role: "reviewer" });
  const repairer = await service.assignWorker({ ...run, taskId: "terminal-repairer", role: "repairer", checkpointIds: ["terminal-review"], actionIds: ["terminal-action"] });
  const lease = await u2.acquireCoordinatorLease({ ...run, taskId: "terminal-coordinator" });
  const assignmentCount = (await readdir(join(output, "stages", "orchestration", "assignments"))).length;

  const receipt = await u2.fail({
    ...run,
    reasonCode: "no-enforced-subagent-facility",
    message: "No facility could enforce the extractor and merger tool allowlists.",
  });
  assert.equal(receipt.auditPath, "stages/import-run.json");
  const audit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(audit.version, 2);
  assert.equal(audit.status, "failed");
  assert.match(String(audit.error), /no-enforced-subagent-facility/);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(run.coordinatorGrant));
  const runRecord = JSON.parse(await readFile(join(output, "stages", "orchestration", "run.json"), "utf-8")) as { terminal?: { status?: string } };
  assert.equal(runRecord.terminal?.status, "failed");
  assert.equal((await service.status(run)).normalized, true, "read-only coordinator status remains available");

  const terminal = /run is terminal/;
  await assert.rejects(service.normalize({ ...run, input: "missing.html" }), terminal);
  await assert.rejects(service.assignExtractor({ ...run, taskId: "after-failure-extractor", unitIds: [unit.unitId] }), terminal);
  await assert.rejects(service.assignWorker({ ...run, taskId: "after-failure-reviewer", role: "reviewer" }), terminal);
  await assert.rejects(service.assignmentBrief({ ...run, taskId: extractor.taskId, grant: extractor.grant }), terminal);
  await assert.rejects(service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "ordinary-subagent", hostTaskId: "terminal-host", requestedTools: extractor.tools, observedTools: extractor.tools, outcome: "completed" }), terminal);
  await assert.rejects(service.revokeAssignment({ ...run, taskId: extractor.taskId }), terminal);
  await assert.rejects(service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) }), terminal);
  await assert.rejects(proposals.submitWorkerProposalBody({ ...proposer, artifacts: [], candidateDispositions: [], rationale: "Terminal proposal must not persist." }), terminal);
  await assert.rejects(identities.submitWorkerIdentity({ ...reconciler, packet: {} }), terminal);
  await assert.rejects(u2.submitReview({ ...reviewer, packet: {} as never }), terminal);
  await assert.rejects(u2.acquireCoordinatorLease({ ...run, taskId: "after-failure-coordinator" }), terminal);
  await assert.rejects(u2.acquireWorkerLease(merger), terminal);
  await assert.rejects(u2.heartbeatCoordinatorLease({ ...run, taskId: "terminal-coordinator", fence: lease.fence }), terminal);
  await assert.rejects(u2.commitWorkerBatch({ ...merger, proposalHashes: ["a".repeat(64)], readSet: [], changes: [], rationale: "Terminal merge must not persist." }), terminal);
  await assert.rejects(u2.applyWorkerRepairBatch({ ...repairer, fence: lease.fence, expectedRevision: 0, expectedContentHash: null, checkpointId: "terminal-review", actionIds: ["terminal-action"], batch: { proposalHashes: ["a".repeat(64)], readSet: [], operations: [], rationale: "Terminal repair must not persist." } }), terminal);
  await assert.rejects(u2.writeCoordinatorMerge({ ...run, taskId: "terminal-coordinator", fence: lease.fence, expectedRevision: 0, expectedContentHash: null, stage: { version: 1, kind: "merge", artifacts: [], candidateDispositions: [] }, rationale: "Terminal coordinator write must not persist." }), terminal);
  await assert.rejects(u2.finalize({ ...run, taskId: "terminal-coordinator", fence: lease.fence }), terminal);
  await assert.rejects(u2.fail({ ...run, reasonCode: "repeated-failure", message: "A terminal run cannot fail twice." }), terminal);
  await u2.releaseCoordinatorLease({ ...run, taskId: "terminal-coordinator", fence: lease.fence });

  assert.equal((await readdir(join(output, "stages", "orchestration", "assignments"))).length, assignmentCount);
  assert.equal(existsSync(join(output, "stages", "merge", "transactions")), false);
  assert.equal(existsSync(join(output, "stages", "reviews")), false);
});

test("mem-import terminal transitions serialize against already-started semantic mutations", async () => {
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const { output, run, units } = await setup(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "serialized-extractor", unitIds: [unit.unitId] });
  const merger = await service.assignWorker({ ...run, taskId: "serialized-merger", role: "merger" });
  const workerLease = await u2.acquireWorkerLease(merger);
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const submission = service.withRunMutation(output, async () => {
    entered();
    await releasePromise;
    return service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  });
  await enteredPromise;
  let failureSettled = false;
  const failure = u2.fail({ ...run, reasonCode: "serialized-failure", message: "Wait for the in-flight extraction mutation." })
    .finally(() => { failureSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failureSettled, false, "terminal transition must wait for the active run mutation");
  release();
  const submitted = await submission;
  assert.equal(submitted.candidateCount, 1);
  await failure;
  const runRecord = JSON.parse(await readFile(join(output, "stages", "orchestration", "run.json"), "utf-8")) as { terminal?: { status?: string } };
  assert.equal(runRecord.terminal?.status, "failed");
  await u2.releaseWorkerLease({ ...merger, fence: workerLease.fence });
  await assert.rejects(service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) }), /run is terminal/);
  await assert.rejects(service.assignWorker({ ...run, taskId: "serialized-after-failure", role: "reviewer" }), /run is terminal/);
});

test("mem-import terminal transition wins before queued semantic mutations", async () => {
  const service = new MemImportService();
  const { output, run } = await setup(service);
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const terminal = service.withRunMutation(output, async () => {
    const authorized = await service.authorizeCoordinatorMutation(run);
    entered();
    await releasePromise;
    await service.markRunTerminal(authorized, "failed", "serialized terminal transition");
  });
  await enteredPromise;
  const queued = service.assignWorker({ ...run, taskId: "queued-reviewer", role: "reviewer" });
  release();
  await terminal;
  await assert.rejects(queued, /run is terminal/);
  assert.equal(existsSync(join(output, "stages", "orchestration", "assignments", "queued-reviewer.json")), false);
});

test("mem-import run mutation lock excludes another process and recovers a crashed stale owner", async () => {
  const service = new MemImportService();
  const { output } = await setup(service);
  const lockPath = join(output, "stages", "orchestration", "locks", "run-mutation");
  const marker = join(output, "cross-process-marker.txt");
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const held = service.withRunMutation(output, async () => {
    entered();
    await releasePromise;
  });
  await enteredPromise;
  const old = new Date(Date.now() - 10 * 60_000);
  await utimes(lockPath, old, old);
  const script = `import { writeFile } from 'node:fs/promises'; import { MemImportService } from './src/mem-import/service.ts'; await new MemImportService().withRunMutation(${JSON.stringify(output)}, async () => writeFile(${JSON.stringify(marker)}, 'child'));`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let childExited = false;
  const childDone = new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      childExited = true;
      if (code === 0) resolve();
      else reject(new Error(`cross-process lock child exited ${String(code)}: ${stderr}`));
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(childExited, false, "a live owner must not be stolen even when the lock mtime looks stale");
  assert.equal(existsSync(marker), false);
  release();
  await held;
  await childDone;
  assert.equal(await readFile(marker, "utf8"), "child");

  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({ version: 1, nonce: "crashed", pid: 999_999_999, hostname: "crashed-host" }), "utf8");
  await utimes(lockPath, old, old);
  let recovered = false;
  await service.withRunMutation(output, async () => { recovered = true; });
  assert.equal(recovered, true);
});

test("mem-import worker lease cleanup survives revocation and expiry", async () => {
  let current = new Date("2026-07-16T00:00:00.000Z");
  const service = new MemImportService(() => current);
  const u2 = new MemImportU2Service(service, () => current);
  const { output, run } = await setup(service);
  const revoked = await service.assignWorker({ ...run, taskId: "revoked-lease-owner", role: "merger" });
  const revokedLease = await u2.acquireWorkerLease(revoked);
  await service.revokeAssignment({ ...run, taskId: revoked.taskId });
  await u2.releaseWorkerLease({ ...revoked, fence: revokedLease.fence });

  const expiring = await service.assignWorker({ ...run, taskId: "expired-lease-owner", role: "merger", expiresAt: "2026-07-16T00:01:00.000Z" });
  const expiredLease = await u2.acquireWorkerLease(expiring);
  current = new Date("2026-07-16T00:02:00.000Z");
  await u2.releaseWorkerLease({ ...expiring, fence: expiredLease.fence });
  assert.equal(existsSync(join(output, "stages", "orchestration", "locks", "merge-writer", "lease.json")), false);
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

test("mem-import persists identity ambiguity, blocks finalization, and requires explicit reconciliation", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const identities = new MemImportIdentityService(service);
  const u2 = new MemImportU2Service(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-extract", unitIds: units.map((item) => item.unitId) });
  const extracted = await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  await service.submitExtraction({ ...extractor, unitId: units[1]!.unitId, stage: { version: 1, kind: "extraction", unitId: units[1]!.unitId, sourceId: units[1]!.sourceId, candidates: [] } });
  const artifact = {
    id: "ada", group: "people" as const, title: "Ada", description: "A guard at the glass tower.",
    sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
    provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
    metadata: { representedCandidateIds: [`${unit.unitId}:local-candidate`] },
  };
  const proposer = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-propose", role: "proposer", unitIds: [unit.unitId] });
  const proposal = await proposals.submitWorkerProposal({ ...proposer, packet: { version: 1, kind: "mem-import-proposal", id: "identity-shard", inputs: [{ unitId: unit.unitId, packetHash: extracted.packetHash }], artifacts: [artifact], candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }], rationale: "Preserve the Ada shard before reconciliation." } });
  const reconciler = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-ambiguous", role: "reconciler", proposalHashes: [proposal.contentHash] });
  const ambiguity = await identities.submitWorkerIdentity({ ...reconciler, packet: {
    version: 1, kind: "mem-import-identity", id: "ada-ambiguity", proposalHashes: [proposal.contentHash], baselineRevision: 0, baselineContentHash: null,
    decisions: [{ id: "ada-identity", provisionalId: "book-one-ada", disposition: "ambiguous", conflictId: "ada-identity-conflict", blocking: true, rationale: "The available evidence cannot distinguish a new Ada from an existing canonical Ada." }],
    rationale: "Leave the identity unresolved rather than deciding it deterministically.",
  } });
  const merger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-merge", role: "merger" });
  const identityInventory = await identities.inventoryWorkerIdentity({ ...merger, maxItems: 1 });
  assert.deepEqual(identityInventory.entries.map((entry) => entry.identityProposalHash), [ambiguity.contentHash]);
  const identityRead = await identities.readWorkerIdentity({ ...merger, identityProposalHash: ambiguity.contentHash, maxDecisions: 1 });
  assert.equal(identityRead.decisions[0]!.disposition, "ambiguous");
  const lease = await u2.acquireWorkerLease(merger);
  const first = await u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: 0, expectedContentHash: null, batch: {
    proposalHashes: [proposal.contentHash], identityProposalHashes: [ambiguity.contentHash], readSet: [{ artifactId: "ada", contentHash: null }], operations: [{ kind: "upsert", artifact }],
    candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }],
    conflictOperations: [{ kind: "create", conflictId: "ada-identity-conflict", blocking: true, summary: "Ada identity collision requires review.", identityDecisionId: "ada-identity" }],
    rationale: "Accept the Ada artifact while retaining the blocking identity conflict.",
  } });
  const identityState = JSON.parse(await readFile(join(output, "stages", "identity", "state.json"), "utf-8")) as { conflicts: Record<string, { status: string; blocking: boolean; summary: string; identityDecisionId?: string }> };
  assert.equal(identityState.conflicts["ada-identity-conflict"]!.status, "open");
  assert.equal(identityState.conflicts["ada-identity-conflict"]!.blocking, true);
  assert.equal(identityState.conflicts["ada-identity-conflict"]!.summary, "Ada identity collision requires review.");
  assert.equal(identityState.conflicts["ada-identity-conflict"]!.identityDecisionId, "ada-identity");
  await u2.releaseWorkerLease({ ...merger, fence: lease.fence });

  const finalLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-finalize" });
  const blocked = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-finalize", fence: finalLease.fence });
  assert.equal(blocked.finalized, false);
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-finalize", fence: finalLease.fence });

  const reconciler2 = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-match", role: "reconciler", proposalHashes: [proposal.contentHash] });
  const match = await identities.submitWorkerIdentity({ ...reconciler2, packet: {
    version: 1, kind: "mem-import-identity", id: "ada-match", proposalHashes: [proposal.contentHash], baselineRevision: first.revision, baselineContentHash: first.contentHash,
    decisions: [{ id: "ada-match-decision", provisionalId: "book-one-ada", disposition: "match", canonicalId: "ada", rationale: "The reviewer accepted the existing Ada canonical identity." }],
    rationale: "Record the explicit model-owned identity resolution.",
  } });
  const resolveLease = await u2.acquireWorkerLease(merger);
  await u2.applyWorkerBatch({ ...merger, fence: resolveLease.fence, expectedRevision: first.revision, expectedContentHash: first.contentHash, batch: {
    proposalHashes: [proposal.contentHash], identityProposalHashes: [match.contentHash], readSet: [{ artifactId: "ada", contentHash: canonicalHash(first.stage.artifacts![0]) }], operations: [{ kind: "upsert", artifact }],
    conflictOperations: [{ kind: "resolve", conflictId: "ada-identity-conflict" }], rationale: "Resolve the Ada identity conflict against the retained canonical artifact.",
  } });
  await u2.releaseWorkerLease({ ...merger, fence: resolveLease.fence });
  const resolvedState = JSON.parse(await readFile(join(output, "stages", "identity", "state.json"), "utf-8")) as { conflicts: Record<string, { status: string }> };
  assert.equal(resolvedState.conflicts["ada-identity-conflict"]!.status, "resolved");
});

test("mem-import rebases unrelated stale transactions and rejects changed read dependencies", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const u2 = new MemImportU2Service(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "rebase-extract", unitIds: [unit.unitId] });
  await recordDispatch(service, run, extractor.taskId, "extractor");
  const extraction = await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  const artifact = (id: string, description: string) => ({ id, group: "people" as const, title: id, description, sections: [{ heading: "Summary", body: description }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] });
  const alpha = artifact("alpha", "Alpha is the initial canonical artifact.");
  const beta = artifact("beta", "Beta is independent of Alpha.");
  const alphaRebased = artifact("alpha", "Alpha is updated after an unrelated Beta commit.");
  const alphaConcurrent = artifact("alpha", "Alpha is changed by a concurrent transaction.");
  const alphaStale = artifact("alpha", "This stale Alpha update must be rejected.");
  const proposer = await service.assignWorker({ ...run, taskId: "rebase-propose", role: "proposer", unitIds: [unit.unitId] });
  await recordDispatch(service, run, proposer.taskId, "proposer");
  const submit = async (id: string, value: ReturnType<typeof artifact>) => proposals.submitWorkerProposal({ ...proposer, packet: { version: 1, kind: "mem-import-proposal", id, inputs: [{ unitId: unit.unitId, packetHash: extraction.packetHash }], artifacts: [value], rationale: `Propose ${value.id}.` } });
  const [alphaProposal, betaProposal, rebasedProposal, concurrentProposal, staleProposal] = await Promise.all([
    submit("alpha-initial", alpha), submit("beta-independent", beta), submit("alpha-rebased", alphaRebased), submit("alpha-concurrent", alphaConcurrent), submit("alpha-stale", alphaStale),
  ]);
  const merger = await service.assignWorker({ ...run, taskId: "rebase-merger", role: "merger" });
  await recordDispatch(service, run, merger.taskId, "merger");
  const lease = await u2.acquireWorkerLease(merger);
  const apply = async (proposalHash: string, value: ReturnType<typeof artifact>, expected: { revision: number; contentHash: string | null }, readHash: string | null) => u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: expected.revision, expectedContentHash: expected.contentHash, batch: { proposalHashes: [proposalHash], readSet: [{ artifactId: value.id, contentHash: readHash }], operations: [{ kind: "upsert", artifact: value }], rationale: `Apply ${value.id}.` } });
  const initial = await apply(alphaProposal.contentHash, alpha, { revision: 0, contentHash: null }, null);
  const staleBaseline = { revision: initial.revision, contentHash: initial.contentHash };
  const alphaHash = canonicalHash(initial.stage.artifacts!.find((item) => item.id === "alpha")!);
  const afterBeta = await apply(betaProposal.contentHash, beta, staleBaseline, null);
  const afterRebase = await apply(rebasedProposal.contentHash, alphaRebased, staleBaseline, alphaHash);
  assert.equal(afterRebase.revision, afterBeta.revision + 1);
  const rebaseReceipt = JSON.parse(await readFile((await readdir(join(output, "stages", "merge", "transactions"))).filter((name) => name.startsWith(`${String(afterRebase.revision).padStart(8, "0")}-`)).map((name) => join(output, "stages", "merge", "transactions", name))[0]!, "utf-8")) as { rebasedFrom?: { revision: number; contentHash: string | null } };
  assert.deepEqual(rebaseReceipt.rebasedFrom, staleBaseline);
  const beforeConcurrent = { revision: afterRebase.revision, contentHash: afterRebase.contentHash };
  const alphaRebasedHash = canonicalHash(afterRebase.stage.artifacts!.find((item) => item.id === "alpha")!);
  await apply(concurrentProposal.contentHash, alphaConcurrent, beforeConcurrent, alphaRebasedHash);
  await assert.rejects(
    apply(staleProposal.contentHash, alphaStale, beforeConcurrent, alphaRebasedHash),
    /Stale merge read set for artifact alpha/,
  );
  await u2.releaseWorkerLease({ ...merger, fence: lease.fence });
});

test("mem-import serializes twenty out-of-order proposal transactions and preserves prior commits after interruption", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const u2 = new MemImportU2Service(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "pressure-extract", unitIds: [unit.unitId] });
  await recordDispatch(service, run, extractor.taskId, "extractor");
  const extracted = await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  const submitted = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const id = `pressure-${String(index).padStart(2, "0")}`;
    const proposer = await service.assignWorker({ ...run, taskId: `pressure-propose-${String(index).padStart(2, "0")}`, role: "proposer", unitIds: [unit.unitId] });
    await recordDispatch(service, run, proposer.taskId, "proposer");
    const artifact = { id, group: "people" as const, title: `Pressure Person ${index}`, description: `Transaction pressure artifact ${index}.`, sections: [{ heading: "Summary", body: `Pressure Person ${index} appears in the source.` }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] };
    return { artifact, proposal: await proposals.submitWorkerProposal({ ...proposer, packet: { version: 1, kind: "mem-import-proposal", id: `${id}-proposal`, inputs: [{ unitId: unit.unitId, packetHash: extracted.packetHash }], artifacts: [artifact], rationale: `Prepare bounded artifact ${index}.` } }) };
  }));
  const merger = await service.assignWorker({ ...run, taskId: "pressure-merger", role: "merger" });
  await recordDispatch(service, run, merger.taskId, "merger");
  const lease = await u2.acquireWorkerLease(merger);
  for (const { artifact, proposal } of [...submitted].reverse()) {
    const state = await u2.mergeState(run);
    await u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: state.revision, expectedContentHash: state.contentHash, batch: { proposalHashes: [proposal.contentHash], readSet: [{ artifactId: artifact.id, contentHash: null }], operations: [{ kind: "upsert", artifact }], rationale: `Commit ${artifact.id} through the single transaction queue.` } });
  }
  const committed = await u2.mergeState(run);
  assert.equal(committed.revision, 20);
  assert.equal(committed.stage.artifacts?.length, 20);
  const transactionFiles = await readdir(join(output, "stages", "merge", "transactions"));
  assert.equal(transactionFiles.length, 20);
  const firstReceipt = JSON.parse(await readFile(join(output, "stages", "merge", "transactions", transactionFiles.find((name) => name.startsWith("00000001-"))!), "utf-8")) as { contentHash: string; stage?: unknown; operations: Array<{ artifactRef?: string }> };
  assert.equal(firstReceipt.stage, undefined, "transaction receipts must not materialize complete merge stages");
  assert.match(firstReceipt.operations[0]!.artifactRef ?? "", /^[a-f0-9]{64}$/);
  assert.equal((await readdir(join(output, "stages", "merge", "artifacts"))).length, 20, "changed artifacts are content-addressed and deduplicated outside receipts");
  assert.equal((await readdir(join(output, "stages", "merge", "checkpoints"))).length, 1, "a bounded checkpoint caps later replay length");
  const reviewer = await service.assignWorker({ ...run, taskId: "pressure-history-review", role: "reviewer" });
  await recordDispatch(service, run, reviewer.taskId, "reviewer");
  await u2.submitReview({ ...reviewer, packet: { version: 1, kind: "mem-import-review", checkpointId: "pressure-history", reviewedMergeRevision: 1, reviewedMergeHash: firstReceipt.contentHash, readSet: [], findings: [], requestedActions: [] } });
  const beforeFailure = committed.contentHash;
  await assert.rejects(
    u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: committed.revision, expectedContentHash: committed.contentHash, batch: { proposalHashes: ["0".repeat(64)], readSet: [{ artifactId: "interrupted", contentHash: null }], operations: [{ kind: "delete", artifactId: "interrupted" }], rationale: "This malformed interrupted transaction must not replace accepted state." } }),
    /Declared proposal/,
  );
  const afterFailure = await u2.mergeState(run);
  assert.equal(afterFailure.revision, 20);
  assert.equal(afterFailure.contentHash, beforeFailure);
  await u2.releaseWorkerLease({ ...merger, fence: lease.fence });
});

test("mem-import batches twenty-four Alice-sized proposals into at most six compact transactions", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const u2 = new MemImportU2Service(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "batch-extract", unitIds: [unit.unitId] });
  await recordDispatch(service, run, extractor.taskId, "extractor");
  const extracted = await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  const submitted = [] as Array<{ proposalHash: string; artifacts: Array<{ id: string }> }>;
  for (let proposalIndex = 0; proposalIndex < 24; proposalIndex += 1) {
    const suffix = String(proposalIndex).padStart(2, "0");
    const proposer = await service.assignWorker({ ...run, taskId: `batch-propose-${suffix}`, role: "proposer", unitIds: [unit.unitId] });
    await recordDispatch(service, run, proposer.taskId, "proposer");
    const artifacts = Array.from({ length: 5 }, (_, artifactIndex) => {
      const id = `batch-${suffix}-${artifactIndex}`;
      return {
        id,
        group: "things" as const,
        title: `Batch artifact ${proposalIndex}-${artifactIndex}`,
        description: `A proposal-local artifact used to verify weighted merge batching (${proposalIndex}-${artifactIndex}).`,
        sections: [{ heading: "Summary", body: `Artifact ${proposalIndex}-${artifactIndex} is supported by the bounded source fixture.` }],
        provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
      };
    });
    const proposal = await proposals.submitWorkerProposal({ ...proposer, packet: {
      version: 1,
      kind: "mem-import-proposal",
      id: `batch-proposal-${suffix}`,
      inputs: [{ unitId: unit.unitId, packetHash: extracted.packetHash }],
      artifacts,
      rationale: `Prepare five immutable accept-by-reference artifacts for batch ${suffix}.`,
    } });
    submitted.push({ proposalHash: proposal.contentHash, artifacts });
  }

  const merger = await service.assignWorker({ ...run, taskId: "batch-merger", role: "merger" });
  await recordDispatch(service, run, merger.taskId, "merger");
  const fakeProposalHash = "f".repeat(64);
  await assert.rejects(
    u2.commitWorkerBatchReceipt({
      ...merger,
      proposalHashes: [fakeProposalHash],
      readSet: [],
      changes: Array.from({ length: 51 }, (_, index) => ({ kind: "accept" as const, proposalHash: fakeProposalHash, artifactId: `accept-overflow-${index}` })),
      rationale: "Reject a lightweight accept batch above its independent limit.",
    }),
    /accepts exceed the 50-entry lightweight limit/,
  );
  await assert.rejects(
    u2.commitWorkerBatchReceipt({
      ...merger,
      proposalHashes: [fakeProposalHash],
      readSet: [],
      changes: Array.from({ length: 13 }, (_, index) => ({ kind: "delete" as const, artifactId: `synthesis-overflow-${index}` })),
      rationale: "Reject synthesized changes above their independent limit.",
    }),
    /upsert\/delete entries exceed the 12-entry synthesis limit/,
  );

  const receipts = [];
  for (let offset = 0; offset < submitted.length; offset += 8) {
    const batch = submitted.slice(offset, offset + 8);
    const accepted = batch.flatMap((item) => item.artifacts.map((artifact) => ({ proposalHash: item.proposalHash, artifactId: artifact.id })));
    const receipt = await u2.commitWorkerBatchReceipt({
      ...merger,
      proposalHashes: batch.map((item) => item.proposalHash),
      readSet: accepted.map((item) => ({ artifactId: item.artifactId })),
      changes: accepted.map((item) => ({ kind: "accept" as const, proposalHash: item.proposalHash, artifactId: item.artifactId })),
      rationale: `Accept ${accepted.length} immutable artifacts from ${batch.length} compatible proposals.`,
    });
    assert.ok(serializedModelToolResultSize(receipt) < 10_000);
    assert.equal("stage" in receipt, false);
    receipts.push(receipt);
  }

  assert.ok(receipts.length <= 6);
  assert.equal(receipts.length, 3);
  assert.deepEqual(receipts.map((receipt) => receipt.revision), [1, 2, 3]);
  const controls = await u2.mergeControls(run);
  assert.equal(controls.artifactCount, 120);
  assert.equal(controls.proposalCount, 24);
  assert.equal(controls.consumedProposalCount, 24);
  assert.equal(controls.unconsumedProposalCount, 0);
  assert.equal((await readdir(join(output, "stages", "merge", "transactions"))).length, 3);
});

test("mem-import large-work inventories stay bounded at 500 units, 5,000 candidates, and 1,000 artifacts", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(input, `chapter-${String(index).padStart(3, "0")}.html`), `<html><body><p>Character ${index} appears at location ${index}.</p></body></html>`, "utf-8")));
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const run = await service.begin(output);
  const units = (await service.normalize({ ...run, input })).units;
  assert.equal(units.length, 500);
  const extractor = await service.assignExtractor({ ...run, taskId: "large-extract", unitIds: units.map((unit) => unit.unitId) });
  await recordDispatch(service, run, extractor.taskId, "extractor");
  for (const [index, unit] of units.entries()) {
    await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: {
      version: 1, kind: "extraction", unitId: unit.unitId, sourceId: unit.sourceId,
      candidates: Array.from({ length: 10 }, (_, candidate) => ({ id: `candidate-${candidate}`, group: "things" as const, title: `Object ${index}-${candidate}`, provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] })),
    } });
  }
  const merger = await service.assignWorker({ ...run, taskId: "large-reader", role: "merger" });
  const extractionPage = await service.readWorkerExtractionInventory({ ...merger, maxItems: 100 });
  assert.equal(extractionPage.entries.length, 100);
  assert.equal(extractionPage.truncated, true);
  assert.equal(extractionPage.entries.reduce((total, entry) => total + entry.candidateCount, 0), 1_000);
  assert.ok(extractionPage.continuationCursor);

  const artifacts = Array.from({ length: 1_000 }, (_, index) => {
    const unit = units[index % units.length]!;
    return { id: `artifact-${String(index).padStart(4, "0")}`, group: "things" as const, title: `Artifact ${index}`, description: `A bounded canonical artifact ${index}.`, sections: [{ heading: "Summary", body: `Artifact ${index} is retained for inventory paging.` }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] };
  });
  const lease = await u2.acquireCoordinatorLease({ ...run, taskId: "large-seed" });
  const written = await u2.writeCoordinatorMerge({ ...run, taskId: "large-seed", fence: lease.fence, expectedRevision: 0, expectedContentHash: null, stage: { version: 1, kind: "merge", artifacts, candidateDispositions: [], diagnostics: [] }, rationale: "Seed a large canonical inventory to verify bounded reads." });
  assert.equal(written.stage.artifacts?.length, 1_000);
  const largeReceipt = toMergeMutationReceipt(written, ["a".repeat(64)]);
  assert.deepEqual(largeReceipt, {
    revision: 1,
    contentHash: written.contentHash,
    parentContentHash: null,
    artifactCount: 1_000,
    candidateDispositionCount: 0,
    consumedProposalHashes: ["a".repeat(64)],
  });
  assert.ok(serializedModelToolResultSize(largeReceipt) < 10_000);
  assert.equal("stage" in largeReceipt, false);
  assert.equal("artifacts" in largeReceipt, false);
  assert.equal("candidateDispositions" in largeReceipt, false);
  const largeControls = await u2.mergeControls(run);
  assert.equal(largeControls.revision, written.revision);
  assert.equal(largeControls.contentHash, written.contentHash);
  assert.equal(largeControls.artifactCount, 1_000);
  assert.equal(largeControls.candidateDispositionCount, 0);
  assert.deepEqual(largeControls.reviewValidity, {
    current: false,
    currentReviewCount: 0,
    staleReviewCount: 0,
    unaffectedReviewCount: 0,
    unscopedReviewCount: 0,
  });
  assert.ok(serializedModelToolResultSize(largeControls) < 10_000);
  assert.equal("stage" in largeControls, false);
  assert.equal("artifacts" in largeControls, false);
  assert.equal("candidateDispositions" in largeControls, false);
  const mergePage = await u2.mergeInventory({ ...run, maxItems: 100 });
  assert.equal(mergePage.totalArtifacts, 1_000);
  assert.equal(mergePage.entries.length, 100);
  assert.equal(mergePage.truncated, true);
  assert.ok(mergePage.continuationCursor);
  await u2.releaseCoordinatorLease({ ...run, taskId: "large-seed", fence: lease.fence });
});

test("mem-import model-facing mutation tools use compact receipt methods", async () => {
  const extensionSource = await readFile(join(process.cwd(), "extensions", "mem-import-tools.ts"), "utf-8");
  assert.match(extensionSource, /mem_merge_commit[\s\S]*?commitWorkerBatchReceipt\(params\)/);
  assert.match(extensionSource, /mem_merge_apply_repair_batch[\s\S]*?applyWorkerRepairBatchReceipt\(params\)/);
  assert.match(extensionSource, /mem_import_merge_state[\s\S]*?mergeControls\(params\)/);
  assert.match(extensionSource, /mem_import_effect_inventory[\s\S]*?service\.effectInventory\(params\)/);
  assert.doesNotMatch(extensionSource, /return result\(await u2\.mergeState\(params\)\)/);
  assert.doesNotMatch(extensionSource, /return result\(await u2\.commitWorkerBatch\(params\)\)/);
  assert.doesNotMatch(extensionSource, /return result\(await u2\.applyWorkerRepairBatch\(params\)\)/);
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
