import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MEM_IMPORT_ROLE_TOOLS, MemImportService, type AssignmentRole } from "./mem-import/service.js";
import { MemImportU2Service, toMergeMutationReceipt } from "./mem-import/u2-service.js";
import { MemImportProposalService } from "./mem-import/proposal-service.js";
import { MemImportCompendiumService, projectCompendium } from "./mem-import/compendium-service.js";
import { MemImportIdentityService, assertAtomicIdentityScope, canonicalHash } from "./mem-import/identity-service.js";
import { MemImportClusterPlanService } from "./mem-import/cluster-plan-service.js";
import { aggregateUsageTelemetry } from "./mem-import/usage-telemetry.js";
import { PiHerdrUsageResolver, piHerdrChildId } from "./mem-import/pi-herdr-usage-resolver.js";
import { buildCoveragePlan } from "./world-import/helper-tools.js";
import type { SourceManifestEntry, StageEnvelope } from "./world-import/types.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-mem-import-tools-"));
}

function serializedModelToolResultSize(value: unknown): number {
  return JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value }).length;
}

test("identity packet admission enforces weighted atomic merge boundaries", () => {
  const artifacts = (count: number) => new Set(Array.from({ length: count }, (_value, index) => `artifact-${index + 1}`));
  assert.doesNotThrow(() => assertAtomicIdentityScope(50, artifacts(62), new Set()));
  assert.throws(() => assertAtomicIdentityScope(51, artifacts(51), new Set()), /at most 50/);
  assert.throws(() => assertAtomicIdentityScope(1, artifacts(13), new Set(Array.from({ length: 13 }, (_value, index) => `renamed-${index + 1}`))), /at least 13 synthesized/);
});

function usageEvidence(inputTokens: number, outputTokens: number, provider = "test-provider", model = "test-model") {
  const usage = {
    version: 1 as const,
    sessions: 1,
    turns: 1,
    responses: 1,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: null,
    reasoningTokens: null,
    totalTokens: inputTokens + outputTokens,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: null, total: 0.03 },
  };
  return {
    version: 1 as const,
    status: "available" as const,
    source: "subagent-result" as const,
    usage,
    usageByModel: [{ ...usage, provider, model, responses: 1, version: 1 as const, sessions: undefined, turns: undefined }].map(({ sessions: _sessions, turns: _turns, ...item }) => item),
  };
}

async function recordDispatch(service: MemImportService, run: { outputRoot: string; runId: string; coordinatorGrant: string }, taskId: string, role: AssignmentRole): Promise<void> {
  const tools = MEM_IMPORT_ROLE_TOOLS[role];
  await service.recordWorkerDispatch({ ...run, taskId, facility: "subagent", hostTaskId: `host-${taskId}`, requestedTools: tools, observedTools: tools, outcome: "completed" });
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
  assert.deepEqual(brief, { outputRoot: output, runId: run.runId, taskId: assignment.taskId, grant: assignment.grant, role: "extractor", units: [{ unitId: units[0]!.unitId, sourceId: units[0]!.sourceId }], candidateIds: [], proposalHashes: [], checkpointIds: [], actionIds: [], profile: "mem-import-extractor", tools: MEM_IMPORT_ROLE_TOOLS.extractor });
  assert.equal(assignment.profile, "mem-import-extractor");
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
    if (workId === "book-one") {
      const sharedManifest = join(compendiumRoot, "sources", "manifest.json");
      const sharedLocator = join(compendiumRoot, "stages", "source-locator.json");
      const beforeManifest = existsSync(sharedManifest) ? await readFile(sharedManifest, "utf-8") : null;
      const beforeLocator = existsSync(sharedLocator) ? await readFile(sharedLocator, "utf-8") : null;
      const malformed = await u2.validateWorkerCommit({ ...merger, proposalHashes: [proposal.contentHash], readSet: [{ artifactId, contentHash: null }], changes: [{ kind: "upsert", artifact: { ...artifact, proposalHash: proposal.contentHash } } as any], rationale: "Reject malformed compendium payload without projecting shared sources." });
      assert.equal(malformed.valid, false);
      assert.match(malformed.issues[0]!.message, /unsupported fields: proposalHash/);
      assert.equal(existsSync(sharedManifest) ? await readFile(sharedManifest, "utf-8") : null, beforeManifest);
      assert.equal(existsSync(sharedLocator) ? await readFile(sharedLocator, "utf-8") : null, beforeLocator);
    }
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
  await rm(join(first.run.outputRoot, "stages", "orchestration", "effects", "book-one-merge"), { recursive: true, force: true });
  const checks = await u2.checks(edition.run);
  assert.equal((await readdir(join(first.run.outputRoot, "stages", "orchestration", "effects", "book-one-merge"))).length, 1, "current compendium checks must recover a prior contributing run's transaction effect");
  assert.equal(checks.deterministic.passed, true, "pre-finalization checks emit and validate the shared projection");
  assert.ok(existsSync(join(compendiumRoot, "world", "index.md")));
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

test("evidence-read telemetry aggregates successful calls by assignment, role, and tool without content", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const extractor = await service.assignExtractor({ ...run, taskId: "telemetry-extractor", unitIds: [units[0]!.unitId] });
  const reviewer = await service.assignWorker({ ...run, taskId: "telemetry-reviewer", role: "reviewer" });

  await Promise.all([
    service.recordEvidenceRead({ ...extractor, toolName: "mem_source_read_unit", returnedChars: 41 }),
    service.recordEvidenceRead({ ...extractor, toolName: "mem_source_read_unit", returnedChars: 17 }),
  ]);
  await service.recordEvidenceRead({ ...reviewer, toolName: "mem_merge_inventory", returnedItems: 3 });
  await assert.rejects(service.recordEvidenceRead({ ...reviewer, grant: "forged", toolName: "mem_merge_inventory", returnedItems: 99 }), /Invalid assignment grant/);
  await assert.rejects(service.recordEvidenceRead({ ...reviewer, toolName: "mem_proposal_read", returnedItems: 1 }), /not an evidence read for assignment role reviewer/);

  const telemetry = await service.evidenceReadTelemetry(run);
  assert.deepEqual(telemetry, {
    total: { calls: 3, pages: 3, returnedItems: 3, returnedChars: 58 },
    roles: [
      {
        role: "extractor",
        assignmentCount: 1,
        calls: 2,
        pages: 2,
        returnedItems: 0,
        returnedChars: 58,
        tools: [{ toolName: "mem_source_read_unit", calls: 2, pages: 2, returnedItems: 0, returnedChars: 58 }],
      },
      {
        role: "reviewer",
        assignmentCount: 1,
        calls: 1,
        pages: 1,
        returnedItems: 3,
        returnedChars: 0,
        tools: [{ toolName: "mem_merge_inventory", calls: 1, pages: 1, returnedItems: 3, returnedChars: 0 }],
      },
    ],
  });
  assert.deepEqual((await new MemImportU2Service(service).workStatus(run)).evidenceReads, telemetry);
  const persisted = await readFile(join(output, "stages", "orchestration", "evidence-reads", "telemetry-extractor.json"), "utf-8");
  assert.doesNotMatch(persisted, /Ada guards|grant|coordinatorGrant|source text|prompt/i);
});

test("usage telemetry persists subagent-result snapshots and aggregates by role, phase, and model", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const u2 = new MemImportU2Service(service);
  const extractor = await service.assignExtractor({ ...run, taskId: "usage-extractor", unitIds: [units[0]!.unitId] });
  const proposer = await service.assignWorker({ ...run, taskId: "usage-proposer", role: "proposer", unitIds: [units[0]!.unitId] });
  const reviewer = await service.assignWorker({ ...run, taskId: "usage-corrupt", role: "reviewer" });
  const taintedEvidence = usageEvidence(10, 5) as ReturnType<typeof usageEvidence> & { secretPrompt?: string; usage: ReturnType<typeof usageEvidence>["usage"] & { grant?: string } };
  taintedEvidence.secretPrompt = "must not persist";
  taintedEvidence.usage.grant = "must not persist";
  (taintedEvidence.usage.cost as Record<string, unknown>).credentials = "must not persist";
  (taintedEvidence.usageByModel[0] as Record<string, unknown>).responseText = "must not persist";

  await service.recordWorkerDispatch({
    ...run,
    taskId: extractor.taskId,
    facility: "subagent",
    hostTaskId: "usage-worker-host",
    requestedTools: extractor.tools,
    observedTools: extractor.tools,
    outcome: "completed",
    observedModel: "test-model",
    usageEvidence: taintedEvidence,
  });
  await service.recordWorkerDispatch({
    ...run,
    taskId: proposer.taskId,
    facility: "unknown",
    hostTaskId: "usage-unavailable-host",
    requestedTools: proposer.tools,
    observedTools: proposer.tools,
    outcome: "failed",
    usageEvidence: { version: 1, status: "unavailable", reason: "adapter-unavailable" },
  });
  await service.recordWorkerDispatch({
    ...run,
    taskId: reviewer.taskId,
    facility: "subagent",
    hostTaskId: "usage-corrupt-host",
    requestedTools: reviewer.tools,
    observedTools: reviewer.tools,
    outcome: "completed",
    usageEvidence: usageEvidence(3, 2),
  });
  await writeFile(join(output, "stages", "orchestration", "dispatches", "usage-corrupt.json"), JSON.stringify({ version: 99, totalTokens: -4, prompt: "must not persist into aggregates" }), "utf-8");
  await mkdir(join(output, "stages", "orchestration", "coordinator-sessions"), { recursive: true });
  await writeFile(join(output, "stages", "orchestration", "coordinator-sessions", "merge-corrupt.json"), JSON.stringify({ version: 1, kind: "mem-import-coordinator-session", runId: run.runId, phase: "merge", role: "coordinator", facility: "subagent", hostTaskId: "bad", usageEvidence: { version: 1, status: "available", source: "subagent-result", usage: { totalTokens: -1 } } }), "utf-8");

  await u2.recordCoordinatorSession({
    ...run,
    phase: "extraction",
    facility: "subagent",
    hostTaskId: "usage-coordinator-host",
    outcome: "completed",
    observedModel: "test-model",
    usageEvidence: usageEvidence(20, 10),
  });

  const telemetry = await service.usageTelemetry(run);
  assert.equal(telemetry.version, 1);
  assert.equal(telemetry.availability, "partial");
  assert.equal(telemetry.recordCount, 5);
  assert.equal(telemetry.availableRecordCount, 2);
  assert.equal(telemetry.unavailableRecordCount, 3);
  assert.equal(telemetry.totals.totalTokens, null, "a partial corpus must not report an inexact grand total");
  assert.deepEqual(telemetry.unavailable, [
    { phase: "review-finalization", role: "reviewer", taskId: "usage-corrupt", facility: "unknown", reason: "invalid-telemetry-record" },
    { phase: "proposal-reconciliation", role: "proposer", taskId: "usage-proposer", facility: "unknown", reason: "adapter-unavailable" },
    { phase: "merge", role: "coordinator", taskId: "invalid-merge-corrupt", facility: "unknown", reason: "invalid-telemetry-record" },
  ]);
  assert.equal(telemetry.roles.find((item) => item.role === "extractor")?.totals.totalTokens, 15);
  assert.equal(telemetry.roles.find((item) => item.role === "coordinator")?.totals.totalTokens, null);
  assert.equal(telemetry.phases.find((item) => item.phase === "extraction")?.totals.totalTokens, 45);
  assert.equal(telemetry.models[0]?.provider, "test-provider");
  assert.equal(telemetry.models[0]?.model, "test-model");
  assert.equal(telemetry.models[0]?.totals.sessions, null, "host model buckets do not attribute sessions");
  assert.equal(telemetry.models[0]?.totals.turns, null, "host model buckets do not attribute turns");
  assert.equal(telemetry.models[0]?.totals.responses, 2);
  assert.equal(telemetry.models[0]?.totals.totalTokens, 45);

  const dispatch = JSON.parse(await readFile(join(output, "stages", "orchestration", "dispatches", "usage-extractor.json"), "utf-8")) as Record<string, unknown>;
  assert.deepEqual(dispatch.usageEvidence, usageEvidence(10, 5));
  assert.doesNotMatch(JSON.stringify(dispatch), /must not persist|secretPrompt|credentials|responseText|grant/);
  const audit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf-8")) as { usage: typeof telemetry };
  assert.equal(audit.usage.recordCount, 5);
  assert.doesNotMatch(JSON.stringify({ dispatch, audit }), /prompt|grant|secret/i);

  await assert.rejects(service.recordWorkerDispatch({
    ...run,
    taskId: extractor.taskId,
    facility: "subagent",
    hostTaskId: "invalid-usage-host",
    requestedTools: extractor.tools,
    observedTools: extractor.tools,
    outcome: "completed",
    usageEvidence: { ...usageEvidence(1, 1), usageByModel: [{ ...usageEvidence(1, 1).usageByModel[0]!, model: "bad\nmodel" }] },
  }), /invalid provider or model/);
  await assert.rejects(u2.recordCoordinatorSession({
    ...run,
    phase: "merge",
    facility: "subagent",
    hostTaskId: "invalid-runtime-label",
    outcome: "completed",
    observedModel: "safe-model\nsecret-token",
    usageEvidence: { version: 1, status: "unavailable", reason: "host-result-missing" },
  }), /control-free string/);
});

test("Pi/Herdr dispatch and coordinator recording eagerly return authoritative sidecar usage", async () => {
  const root = await tempDir();
  const sessionsRoot = join(root, "sessions");
  const workspace = join(sessionsRoot, "workspace");
  const activityDir = join(workspace, "artifacts", "parent", "subagent-activity");
  await mkdir(activityDir, { recursive: true });
  const resolver = new PiHerdrUsageResolver(sessionsRoot);
  const service = new MemImportService(undefined, resolver);
  const { run, units } = await setup(service);
  const extractor = await service.assignExtractor({ ...run, taskId: "eager-sidecar-extractor", unitIds: [units[0]!.unitId] });
  const startedAt = Date.UTC(2026, 6, 25, 0, 0, 0);
  async function seed(childId: string, sessionId: string, inputTokens: number) {
    const evidence = usageEvidence(inputTokens, 2);
    await writeFile(join(workspace, `${sessionId}.jsonl`), "", "utf-8");
    await writeFile(join(activityDir, `${childId}.json`), JSON.stringify({
      version: 1, runningChildId: childId, createdAt: startedAt, updatedAt: startedAt + inputTokens, sequence: inputTokens,
      latestEvent: "agent_end", phase: "done", agentActive: false, turnActive: false, providerActive: false, toolActive: false,
      usage: evidence.usage, usageByModel: evidence.usageByModel,
    }), "utf-8");
  }
  const workerSessionId = "2026-07-25T00-00-00-000Z_deadbeef-session";
  await seed("deadbeef", workerSessionId, 11);
  const dispatch = await service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "deadbeef", hostSessionId: workerSessionId, requestedTools: extractor.tools, observedTools: extractor.tools, outcome: "completed" });
  assert.equal(dispatch.usageEvidence.status, "available");
  assert.equal(dispatch.usageEvidence.status === "available" ? dispatch.usageEvidence.usage.inputTokens : null, 11);
  assert.equal(dispatch.activitySequence, 11);

  const coordinatorSessionId = "2026-07-25T00-01-00-000Z_cafebabe-session";
  await seed("cafebabe", coordinatorSessionId, 17);
  const coordinator = await service.recordCoordinatorSession({ ...run, phase: "extraction", facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "cafebabe", hostSessionId: coordinatorSessionId, outcome: "completed" });
  assert.equal(coordinator.usageEvidence.status, "available");
  assert.equal(coordinator.usageEvidence.status === "available" ? coordinator.usageEvidence.usage.inputTokens : null, 17);
  assert.equal(coordinator.activitySequence, 17);
});

test("Pi/Herdr post-facto usage retrieval validates sidecars, keeps latest resume snapshot, and deduplicates child identities", async () => {
  assert.equal(piHerdrChildId("019f9a1b-4c6f-74c2-b685-a7100fdd0031"), undefined, "a host session UUID must not be truncated into a child identity");
  assert.equal(piHerdrChildId("e2127f29-b75f7964-8542d9a0-1fa8"), "e2127f29");
  const root = await tempDir();
  const sessionsRoot = join(root, "sessions");
  const resolver = new PiHerdrUsageResolver(sessionsRoot);
  const service = new MemImportService(undefined, resolver);
  const { output, run, units } = await setup(service);
  const first = await service.assignExtractor({ ...run, taskId: "sidecar-first", unitIds: [units[0]!.unitId] });
  const duplicate = await service.assignWorker({ ...run, taskId: "sidecar-duplicate", role: "reviewer" });
  const missing = await service.assignWorker({ ...run, taskId: "sidecar-missing", role: "proposer", unitIds: [units[0]!.unitId] });
  const unmatched = await service.assignWorker({ ...run, taskId: "sidecar-unmatched", role: "merger" });
  const generic = await service.assignWorker({ ...run, taskId: "generic-live", role: "repairer", checkpointIds: ["checkpoint"], actionIds: ["action"] });

  await assert.rejects(service.recordWorkerDispatch({ ...run, taskId: first.taskId, facility: "subagent", hostTaskId: "deadbeef", requestedTools: first.tools, observedTools: first.tools, outcome: "completed" }), /hostAdapter is required/);
  await assert.rejects(service.recordWorkerDispatch({ ...run, taskId: first.taskId, facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "deadbeef", hostSessionId: "2026-07-25T00-00-00-000Z_deadbeef", requestedTools: first.tools, observedTools: first.tools, outcome: "completed" }), /complete sanitized session filename stem/);
  await assert.rejects(service.recordCoordinatorSession({ ...run, phase: "extraction", facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "deadbeef", hostSessionId: "2026-07-25T00-00-00-000Z_deadbeef", outcome: "completed" }), /complete sanitized session filename stem/);
  await service.recordWorkerDispatch({ ...run, taskId: first.taskId, facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "deadbeef", hostSessionId: "2026-07-25T00-00-00-000Z_deadbeef-session", requestedTools: first.tools, observedTools: first.tools, outcome: "completed" });
  await service.recordWorkerDispatch({ ...run, taskId: duplicate.taskId, facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "deadbeef", hostSessionId: "2026-07-25T00-00-00-000Z_deadbeef-session", requestedTools: duplicate.tools, observedTools: duplicate.tools, outcome: "completed" });
  await service.recordWorkerDispatch({ ...run, taskId: missing.taskId, facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "cafebabe", hostSessionId: "2026-07-25T00-02-00-000Z_cafebabe-session", requestedTools: missing.tools, observedTools: missing.tools, outcome: "completed" });
  await service.recordWorkerDispatch({ ...run, taskId: unmatched.taskId, facility: "subagent", hostAdapter: "pi-herdr-subagents", hostTaskId: "opaque-session-without-child-id", requestedTools: unmatched.tools, observedTools: unmatched.tools, outcome: "completed", usageEvidence: usageEvidence(999, 1) });
  await service.recordWorkerDispatch({ ...run, taskId: generic.taskId, facility: "subagent", hostAdapter: "pi-subagents", hostTaskId: "generic-child", requestedTools: generic.tools, observedTools: generic.tools, outcome: "completed", usageEvidence: usageEvidence(7, 3, "generic-provider", "generic-model") });

  const sidecarStart = Date.UTC(2026, 6, 25, 0, 0, 0);
  async function writeSidecar(parent: string, childId: string, sequence: number, inputTokens: number, secret = false, updatedAt = sidecarStart + sequence) {
    const directory = join(sessionsRoot, "workspace", "artifacts", parent, "subagent-activity");
    await mkdir(directory, { recursive: true });
    const evidence = usageEvidence(inputTokens, 2);
    await writeFile(join(directory, `${childId}.json`), JSON.stringify({
      version: 1, runningChildId: childId, createdAt: sidecarStart, updatedAt, sequence,
      latestEvent: "subagent_done", phase: "done", agentActive: false, turnActive: false, providerActive: false, toolActive: false,
      usage: evidence.usage, usageByModel: evidence.usageByModel,
      ...(secret ? { prompt: "must not persist", credentials: "must not persist" } : {}),
    }), "utf-8");
  }
  await writeSidecar("parent-old", "deadbeef", 4, 10);
  await writeSidecar("parent-latest", "deadbeef", 1, 40, true, sidecarStart + 3000);
  const workspaceRoot = join(sessionsRoot, "workspace");
  for (const sessionName of [
    "2026-07-25T00-00-00-000Z_deadbeef-session", "2026-07-25T00-01-00-000Z_deadbeef-resume",
    "2026-07-25T00-02-00-000Z_cafebabe-session", "2026-07-25T00-03-00-000Z_badc0ffe-session",
    "2026-07-25T00-04-00-000Z_facefeed-session", "2026-07-25T00-05-00-000Z_feedbabe-session",
    "2026-07-25T00-06-00-000Z_decafbad-session",
  ]) await writeFile(join(workspaceRoot, `${sessionName}.jsonl`), "", "utf-8");
  const edgeDirectory = join(sessionsRoot, "workspace", "artifacts", "parent-edge", "subagent-activity");
  await mkdir(edgeDirectory, { recursive: true });
  await writeFile(join(edgeDirectory, "badc0ffe.json"), JSON.stringify({ version: 1, runningChildId: "badc0ffe", updatedAt: 3000, sequence: 2, phase: "active" }), "utf-8");
  await writeFile(join(edgeDirectory, "facefeed.json"), "{bad", "utf-8");
  await writeFile(join(edgeDirectory, "decafbad.json"), JSON.stringify({
    version: 1, runningChildId: "decafbad", createdAt: sidecarStart, updatedAt: Number.MAX_SAFE_INTEGER, sequence: 1,
    latestEvent: "subagent_done", phase: "done", agentActive: false, turnActive: false, providerActive: false, toolActive: false,
    usage: usageEvidence(1, 1).usage, usageByModel: usageEvidence(1, 1).usageByModel,
  }), "utf-8");
  const secretSidecar = join(root, "secret-sidecar.json");
  const secretEvidence = usageEvidence(900, 2);
  await writeFile(secretSidecar, JSON.stringify({
    version: 1, runningChildId: "feedbabe", createdAt: 1000, updatedAt: 3000, sequence: 3,
    latestEvent: "subagent_done", phase: "done", agentActive: false, turnActive: false, providerActive: false, toolActive: false,
    usage: secretEvidence.usage, usageByModel: secretEvidence.usageByModel,
  }), "utf-8");
  await symlink(secretSidecar, join(edgeDirectory, "feedbabe.json"));
  const edgeCases = await resolver.resolve([
    { key: "stale", hostTaskId: "badc0ffe-session" },
    { key: "invalid", hostTaskId: "facefeed-session" },
    { key: "symlink", hostTaskId: "feedbabe-session" },
    { key: "date-range", hostTaskId: "decafbad-session" },
  ]);
  const staleEvidence = edgeCases.get("stale")?.evidence;
  const invalidEvidence = edgeCases.get("invalid")?.evidence;
  assert.equal(staleEvidence?.status === "unavailable" ? staleEvidence.reason : null, "sidecar-stale");
  assert.equal(invalidEvidence?.status === "unavailable" ? invalidEvidence.reason : null, "sidecar-invalid");
  const symlinkEvidence = edgeCases.get("symlink")?.evidence;
  assert.equal(symlinkEvidence?.status === "unavailable" ? symlinkEvidence.reason : null, "sidecar-invalid", "resolver must not follow a sidecar symlink");
  const dateRangeEvidence = edgeCases.get("date-range")?.evidence;
  assert.equal(dateRangeEvidence?.status === "unavailable" ? dateRangeEvidence.reason : null, "sidecar-invalid", "an out-of-range timestamp must not abort finalization");

  const collisionRoot = join(root, "collision-sessions");
  for (const [workspace, sessionId, inputTokens] of [
    ["workspace-a", "2026-07-25T01-00-00-000Z_deadbeef-a", 3],
    ["workspace-b", "2026-07-25T02-00-00-000Z_deadbeef-b", 30],
  ] as const) {
    const activity = join(collisionRoot, workspace, "artifacts", "parent", "subagent-activity");
    await mkdir(activity, { recursive: true });
    await writeFile(join(collisionRoot, workspace, `${sessionId}.jsonl`), "", "utf-8");
    const evidence = usageEvidence(inputTokens, 1);
    await writeFile(join(activity, "deadbeef.json"), JSON.stringify({
      version: 1, runningChildId: "deadbeef", createdAt: sidecarStart, updatedAt: sidecarStart + inputTokens, sequence: 1,
      latestEvent: "subagent_done", phase: "done", agentActive: false, turnActive: false, providerActive: false, toolActive: false,
      usage: evidence.usage, usageByModel: evidence.usageByModel,
    }), "utf-8");
  }
  const collision = await new PiHerdrUsageResolver(collisionRoot).resolve([
    { key: "a", hostTaskId: "deadbeef", hostSessionId: "2026-07-25T01-00-00-000Z_deadbeef-a" },
    { key: "b", hostTaskId: "deadbeef", hostSessionId: "2026-07-25T02-00-00-000Z_deadbeef-b" },
  ]);
  const collisionA = collision.get("a")?.evidence;
  const collisionB = collision.get("b")?.evidence;
  assert.equal(collisionA?.status === "available" ? collisionA.usage.inputTokens : null, 3);
  assert.equal(collisionB?.status === "available" ? collisionB.usage.inputTokens : null, 30, "same child IDs in different workspaces must resolve per session");
  assert.notEqual(collision.get("a")?.hostScopeId, collision.get("b")?.hostScopeId);

  await writeSidecar("parent-resumed-child", "abcd1234", 1, 55, false, sidecarStart + 86_400_000);
  const resumedChild = await resolver.resolve([{
    key: "resumed", hostTaskId: "abcd1234", hostSessionId: "2026-07-25T00-00-00-000Z_deadbeef-session",
  }]);
  const resumedEvidence = resumedChild.get("resumed")?.evidence;
  assert.equal(resumedEvidence?.status === "available" ? resumedEvidence.usage.inputTokens : null, 55, "a resumed child binds its new child ID to the original sanitized session stem");

  const telemetry = await service.usageTelemetry(run);
  assert.equal(telemetry.recordCount, 4, "duplicate cumulative resume snapshots count as one host session");
  assert.equal(telemetry.records.length, 5, "portable records preserve assignment accounting");
  assert.equal(telemetry.records.filter((record) => record.duplicateOf).length, 1);
  assert.equal(telemetry.records.find((record) => record.taskId === "sidecar-first")?.activitySequence, 1, "newer updatedAt wins when a restarted recorder resets sequence");
  assert.equal(telemetry.records.find((record) => record.taskId === "sidecar-duplicate")?.activitySequence, 1);
  assert.equal(telemetry.availableRecordCount, 2);
  assert.equal(telemetry.unavailableRecordCount, 2);
  assert.equal(telemetry.records.find((record) => record.taskId === "generic-live")?.evidence.status, "available", "a different adapter's live evidence must not be replaced by Pi/Herdr retrieval");
  assert.deepEqual(telemetry.unavailable.map((item) => [item.taskId, item.reason]), [
    ["sidecar-missing", "sidecar-missing"],
    ["sidecar-unmatched", "sidecar-unmatched"],
  ]);
  assert.equal(telemetry.records.find((record) => !record.duplicateOf && record.hostChildId === "deadbeef")?.evidence.status, "available");
  const effective = telemetry.records.find((record) => !record.duplicateOf && record.hostChildId === "deadbeef");
  assert.equal(effective?.evidence.status === "available" ? effective.evidence.usage.inputTokens : null, 40);

  const persisted = await readFile(join(output, "stages", "orchestration", "dispatches", "sidecar-first.json"), "utf-8");
  assert.match(persisted, /pi-herdr-activity-sidecar/);
  assert.match(persisted, /"activitySequence": 1/);
  assert.doesNotMatch(persisted, /must not persist|prompt|credentials/);

  await writeFile(join(sessionsRoot, "workspace", "artifacts", "parent-latest", "subagent-activity", "deadbeef.json"), "{bad", "utf-8");
  const afterCleanup = await service.usageTelemetry(run);
  assert.equal(afterCleanup.records.find((record) => record.hostChildId === "deadbeef")?.evidence.status, "available", "latest remaining valid snapshot survives an invalid duplicate sidecar");
});

test("usage aggregation nulls integer and finite-number overflow instead of emitting invalid totals", () => {
  const first = usageEvidence(Number.MAX_SAFE_INTEGER, 0);
  first.usage.sessions = Number.MAX_SAFE_INTEGER;
  first.usage.turns = Number.MAX_SAFE_INTEGER;
  first.usage.responses = Number.MAX_SAFE_INTEGER;
  first.usage.cost.total = Number.MAX_VALUE;
  first.usageByModel[0]!.responses = Number.MAX_SAFE_INTEGER;
  first.usageByModel[0]!.cost.total = Number.MAX_VALUE;
  const second = usageEvidence(1, 0);
  second.usage.cost.total = Number.MAX_VALUE;
  second.usageByModel[0]!.cost.total = Number.MAX_VALUE;
  const summary = aggregateUsageTelemetry([
    { phase: "extraction", role: "extractor", taskId: "overflow-1", facility: "subagent", evidence: first },
    { phase: "extraction", role: "extractor", taskId: "overflow-2", facility: "subagent", evidence: second },
  ]);
  assert.equal(summary.availability, "available");
  assert.equal(summary.totals.sessions, null);
  assert.equal(summary.totals.turns, null);
  assert.equal(summary.totals.responses, null);
  assert.equal(summary.totals.inputTokens, null);
  assert.equal(summary.totals.cost.total, null);
  assert.equal(summary.models[0]?.totals.responses, null);
  assert.equal(summary.models[0]?.totals.inputTokens, null);
  assert.equal(summary.models[0]?.totals.cost.total, null);
  assert.doesNotMatch(JSON.stringify(summary), /Infinity/);
});

test("fresh services rebuild proposal-stage, identity, and terminal work status from the durable ledger", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const identities = new MemImportIdentityService(service);
  const extractor = await service.assignExtractor({ ...run, taskId: "status-extractor", unitIds: units.map((unit) => unit.unitId) });
  for (const unit of units) await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });

  const unit = units[0]!;
  const proposer = await service.assignWorker({ ...run, taskId: "status-proposer", role: "proposer", unitIds: [unit.unitId] });
  const artifacts = [{
    id: "status-ada",
    group: "people" as const,
    title: "Ada",
    description: "A guard at the glass tower.",
    sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
    provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
  }];
  const candidateDispositions = [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented" as const, artifactId: "status-ada" }];
  const first = await proposals.submitWorkerProposalBody({ ...proposer, artifacts, candidateDispositions, rationale: "First durable proposal disposition." });
  const duplicate = await proposals.submitWorkerProposalBody({ ...proposer, artifacts, candidateDispositions, rationale: "Second durable proposal disposition for duplicate detection." });
  assert.notEqual(first.contentHash, duplicate.contentHash);

  const reconciler = await service.assignWorker({ ...run, taskId: "status-reconciler", role: "reconciler", proposalHashes: [first.contentHash, duplicate.contentHash] });
  await identities.submitWorkerIdentity({
    ...reconciler,
    packet: {
      version: 1,
      kind: "mem-import-identity",
      id: "status-identity",
      proposalHashes: [first.contentHash, duplicate.contentHash],
      baselineRevision: 0,
      baselineContentHash: null,
      decisions: [{ id: "status-create", provisionalId: "status-ada", disposition: "create", canonicalId: "status-ada", rationale: "Create the fresh-corpus identity." }],
      rationale: "Persist one typed identity packet for the phase handoff.",
    },
  });

  const rebuilt = await new MemImportU2Service(new MemImportService()).workStatus(run);
  assert.deepEqual(rebuilt, {
    revision: 0,
    contentHash: null,
    proposalCount: 2,
    consumedProposalCount: 0,
    unconsumedProposalCount: 2,
    candidateCount: 2,
    uniqueProposedCandidateCount: 1,
    unproposedCandidateCount: 1,
    duplicateProposalDispositionCount: 1,
    accountedCandidateCount: 0,
    unaccountedCandidateCount: 2,
    identityPacketCount: 1,
    openConflictCount: 0,
    blockingConflictCount: 0,
    terminalStatus: "active",
    evidenceReads: { total: { calls: 0, pages: 0, returnedItems: 0, returnedChars: 0 }, roles: [] },
  });
  const rebuiltControls = await new MemImportU2Service(new MemImportService()).mergeControls(run);
  assert.equal(rebuiltControls.uniqueProposedCandidateCount, 1);
  assert.equal(rebuiltControls.unproposedCandidateCount, 1);
  assert.equal(rebuiltControls.duplicateProposalDispositionCount, 1);
  assert.equal(rebuiltControls.identityPacketCount, 1);
  assert.equal(rebuiltControls.terminalStatus, "active");
  assert.ok(serializedModelToolResultSize(rebuiltControls) < 10_000);

  await new MemImportU2Service(new MemImportService()).fail({ ...run, reasonCode: "phase-status-test", message: "Persist terminal status for a fresh reader." });
  const terminal = await new MemImportU2Service(new MemImportService()).workStatus(run);
  assert.equal(terminal.terminalStatus, "failed");
  assert.equal(terminal.uniqueProposedCandidateCount, 1);
  assert.equal(terminal.identityPacketCount, 1);
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
  const oversizedArtifacts = Array.from({ length: 63 }, (_value, index) => ({ ...packet.artifacts[0]!, id: `ada-${index + 1}`, title: `Ada ${index + 1}` }));
  await assert.rejects(
    proposals.submitWorkerProposalBody({ ...proposer, artifacts: oversizedArtifacts, candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada-1" }], rationale: "Reject a proposal too large for one atomic merge." }),
    /at most 62 entries/,
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
  const missingProposalValidation = await u2.validateWorkerCommit({
    ...merger,
    proposalHashes: ["f".repeat(64)],
    readSet: [{ artifactId: "missing", contentHash: null }],
    proposalAccepts: [{ proposalHash: "f".repeat(64), artifactIds: ["missing"] }],
    rationale: "Reject a well-shaped but nonexistent proposal hash.",
  });
  assert.equal(missingProposalValidation.valid, false);
  assert.match(missingProposalValidation.issues[0]!.message, /does not exist/);
  assert.equal((await u2.mergeControls(run)).revision, 0);
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
  const repeatedValidation = await u2.validateWorkerCommit({
    ...merger,
    proposalHashes: [persisted.contentHash],
    readSet: [{ artifactId: "ada", contentHash: canonicalArtifact.artifactContentHash }],
    changes: [{ kind: "upsert", artifact: { ...packet.artifacts[0]!, title: "Ada Again" } }],
    rationale: "A consumed proposal must not support another synthesized revision.",
  });
  assert.equal(repeatedValidation.valid, false);
  assert.ok(repeatedValidation.issues.some((issue) => /already consumed/.test(issue.message)));
  await assert.rejects(
    u2.commitWorkerBatchReceipt({
      ...merger,
      proposalHashes: [persisted.contentHash],
      readSet: [{ artifactId: "ada", contentHash: canonicalArtifact.artifactContentHash }],
      changes: [{ kind: "upsert", artifact: { ...packet.artifacts[0]!, title: "Ada Again" } }],
      rationale: "A consumed proposal must not create another revision.",
    }),
    /already consumed/,
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
  const repairBlockedChecks = await u2.checks(run);
  assert.ok(repairBlockedChecks.readiness.diagnostics.some((item) => item.message.includes("Unresolved repair review finding repair-ada-description")));
  assert.ok(repairBlockedChecks.readiness.diagnostics.some((item) => item.message.includes("Unresolved repair review action clarify-ada")));
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
  const postRepairChecks = await u2.checks(run);
  assert.ok(postRepairChecks.readiness.diagnostics.some((item) => item.message.includes("requires a current scoped post-repair review")));

  const postRepairReviewer = await service.assignWorker({ ...run, taskId: "proposal-post-repair-reviewer", role: "reviewer" });
  const repairedCanonical = await u2.readMergeArtifactForWorker({ ...postRepairReviewer, artifactId: "ada" });
  await u2.submitReview({
    ...postRepairReviewer,
    packet: {
      version: 1,
      kind: "mem-import-review",
      checkpointId: "proposal-quality-post-repair",
      reviewedMergeRevision: repairReceipt.revision,
      reviewedMergeHash: repairReceipt.contentHash!,
      findings: [],
      requestedActions: [],
      readSet: [{ artifactId: "ada", contentHash: repairedCanonical.artifactContentHash }],
    },
  });
  const clearedChecks = await u2.checks(run);
  assert.ok(!clearedChecks.readiness.diagnostics.some((item) => /review (finding|action)|post-repair review/.test(item.message)));

  const transactionFiles = await readdir(join(output, "stages", "merge", "transactions"));
  assert.equal(transactionFiles.length, 2);
  await assert.rejects(
    u2.commitWorkerBatch({ ...merger, proposalHashes: [persisted.contentHash], readSet: [{ artifactId: "ada", contentHash: merged.contentHash }], changes: [{ kind: "accept", proposalHash: persisted.contentHash, artifactId: "ada" }], rationale: "A consumed proposal cannot be retried with a global merge hash." }),
    /already consumed/,
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

test("mem-import reconstructs interrupted merge and repair effects from canonical transactions", async () => {
  class FailOnceAfterTransactionService extends MemImportService {
    private failed = false;
    constructor(private readonly target: "merge" | "repair") { super(); }
    override async recordRecoveredTransactionEffect(...args: Parameters<MemImportService["recordRecoveredTransactionEffect"]>): ReturnType<MemImportService["recordRecoveredTransactionEffect"]> {
      if (!this.failed && args[0].effect === this.target) {
        this.failed = true;
        throw new Error(`injected ${this.target} effect interruption`);
      }
      return super.recordRecoveredTransactionEffect(...args);
    }
  }

  const service = new MemImportService();
  const { output, run, units } = await setup(service);
  const unit = units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "recovery-extractor", unitIds: [unit.unitId] });
  await recordDispatch(service, run, extractor.taskId, "extractor");
  await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  const proposer = await service.assignWorker({ ...run, taskId: "recovery-proposer", role: "proposer", unitIds: [unit.unitId], candidateIds: [`${unit.unitId}:local-candidate`] });
  await recordDispatch(service, run, proposer.taskId, "proposer");
  const proposal = await new MemImportProposalService(service).submitWorkerProposalBody({
    ...proposer,
    artifacts: [{
      id: "ada",
      group: "people",
      title: "Ada",
      description: "A guard at the glass tower.",
      sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
      provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
    }],
    candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }],
    rationale: "Create one transaction-backed recovery fixture.",
  });
  const merger = await service.assignWorker({ ...run, taskId: "recovery-merger", role: "merger" });
  await recordDispatch(service, run, merger.taskId, "merger");
  await assert.rejects(
    new MemImportU2Service(new FailOnceAfterTransactionService("merge")).commitWorkerBatchReceipt({
      ...merger,
      proposalHashes: [proposal.contentHash],
      readSet: [{ artifactId: "ada" }],
      changes: [{ kind: "accept", proposalHash: proposal.contentHash, artifactId: "ada" }],
      conflictOperations: [{ kind: "create", conflictId: "recovery-conflict", blocking: true, summary: "A replayable conflict projection." }],
      rationale: "Commit canonical state before the injected effect interruption.",
    }),
    /injected merge effect interruption/,
  );
  assert.equal(existsSync(join(output, "stages", "orchestration", "effects", merger.taskId)), false);
  const fresh = new MemImportU2Service(new MemImportService());
  assert.equal((await fresh.workStatus(run)).revision, 1);
  let effects = await fresh.effectInventory({ ...run, maxItems: 20 });
  assert.deepEqual(effects.entries.filter((entry) => entry.taskId === merger.taskId).map((entry) => entry.effect?.kind), ["merge"]);
  const recoveredMergeFiles = await readdir(join(output, "stages", "orchestration", "effects", merger.taskId));
  assert.equal(recoveredMergeFiles.length, 1);
  assert.match(recoveredMergeFiles[0]!, /^transaction-00000001-[a-f0-9]{64}\.json$/);
  await fresh.effectInventory({ ...run, maxItems: 20 });
  assert.deepEqual(await readdir(join(output, "stages", "orchestration", "effects", merger.taskId)), recoveredMergeFiles);
  const identityStatePath = join(output, "stages", "identity", "state.json");
  assert.equal((JSON.parse(await readFile(identityStatePath, "utf-8")) as { conflicts: Record<string, { status: string }> }).conflicts["recovery-conflict"]?.status, "open");
  await rm(join(output, "stages", "orchestration", "effects", merger.taskId), { recursive: true, force: true });
  await rm(identityStatePath);
  await new MemImportU2Service(new MemImportService()).workStatus(run);
  assert.equal((JSON.parse(await readFile(identityStatePath, "utf-8")) as { conflicts: Record<string, { status: string }> }).conflicts["recovery-conflict"]?.status, "open", "identity/conflict projection must replay before effect recovery");
  assert.equal((await readdir(join(output, "stages", "orchestration", "effects", merger.taskId))).length, 1);

  const merged = await fresh.mergeState(run);
  const artifact = await fresh.readMergeArtifactForWorker({ ...merger, artifactId: "ada" });
  const reviewer = await service.assignWorker({ ...run, taskId: "recovery-reviewer", role: "reviewer" });
  await recordDispatch(service, run, reviewer.taskId, "reviewer");
  await fresh.submitReview({
    ...reviewer,
    packet: {
      version: 1,
      kind: "mem-import-review",
      checkpointId: "recovery-review",
      reviewedMergeRevision: merged.revision,
      reviewedMergeHash: merged.contentHash!,
      findings: [{ id: "recovery-finding", severity: "repair", summary: "Clarify Ada.", requestedActionIds: ["recovery-action"] }],
      requestedActions: [{ id: "recovery-action", type: "clarify", severity: "repair", summary: "Clarify Ada." }],
      readSet: [{ artifactId: "ada", contentHash: artifact.artifactContentHash }],
    },
  });
  const repairer = await service.assignWorker({ ...run, taskId: "recovery-repairer", role: "repairer", checkpointIds: ["recovery-review"], actionIds: ["recovery-action"] });
  await recordDispatch(service, run, repairer.taskId, "repairer");
  const interruptedRepair = new MemImportU2Service(new FailOnceAfterTransactionService("repair"));
  const lease = await interruptedRepair.acquireWorkerLease(repairer);
  await assert.rejects(
    interruptedRepair.applyWorkerRepairBatchReceipt({
      ...repairer,
      fence: lease.fence,
      expectedRevision: merged.revision,
      expectedContentHash: merged.contentHash,
      checkpointId: "recovery-review",
      actionIds: ["recovery-action"],
      batch: {
        proposalHashes: [proposal.contentHash],
        readSet: [{ artifactId: "ada", contentHash: artifact.artifactContentHash }],
        operations: [{ kind: "upsert", artifact: { ...artifact.artifact!, description: "Ada guards the glass tower." } }],
        conflictOperations: [{ kind: "resolve", conflictId: "recovery-conflict" }],
        rationale: "Commit repair state before the injected effect interruption.",
      },
    }),
    /injected repair effect interruption/,
  );
  await interruptedRepair.releaseWorkerLease({ ...repairer, fence: lease.fence });
  assert.equal(existsSync(join(output, "stages", "orchestration", "effects", repairer.taskId)), false);
  assert.equal((await new MemImportU2Service(new MemImportService()).workStatus(run)).revision, 2);
  effects = await new MemImportU2Service(new MemImportService()).effectInventory({ ...run, maxItems: 20 });
  assert.deepEqual(effects.entries.filter((entry) => entry.taskId === repairer.taskId).map((entry) => entry.effect?.kind), ["repair"]);
  const recoveredRepairFiles = await readdir(join(output, "stages", "orchestration", "effects", repairer.taskId));
  assert.equal(recoveredRepairFiles.length, 1);
  assert.match(recoveredRepairFiles[0]!, /^transaction-00000002-[a-f0-9]{64}\.json$/);
  assert.equal((JSON.parse(await readFile(identityStatePath, "utf-8")) as { conflicts: Record<string, { status: string }> }).conflicts["recovery-conflict"]?.status, "resolved");
  await rm(join(output, "stages", "merge", "merged-candidates.json"));
  await rm(identityStatePath);
  await rm(join(output, "stages", "orchestration", "effects", merger.taskId), { recursive: true, force: true });
  await rm(join(output, "stages", "orchestration", "effects", repairer.taskId), { recursive: true, force: true });
  const projectedRecovery = new MemImportU2Service(new MemImportService());
  assert.equal((await projectedRecovery.workStatus(run)).revision, 2, "a complete receipt chain must restore a missing canonical head projection");
  assert.equal((await projectedRecovery.mergeState(run)).stage.artifacts?.[0]?.id, "ada");
  assert.equal((JSON.parse(await readFile(identityStatePath, "utf-8")) as { conflicts: Record<string, { status: string }> }).conflicts["recovery-conflict"]?.status, "resolved");
  const recoveredMergerEffectDirectory = join(output, "stages", "orchestration", "effects", merger.taskId);
  const recoveredMergerEffectPath = join(recoveredMergerEffectDirectory, (await readdir(recoveredMergerEffectDirectory))[0]!);
  const recoveredMergerEffectText = await readFile(recoveredMergerEffectPath, "utf-8");
  const recoveredMergerEffect = JSON.parse(recoveredMergerEffectText) as Record<string, unknown>;
  await writeFile(recoveredMergerEffectPath, `${JSON.stringify({ ...recoveredMergerEffect, runId: "mir-wrong-effect-run" }, null, 2)}\n`, "utf-8");
  await assert.rejects(projectedRecovery.workStatus(run), /Invalid worker effect record|Orphan canonical transaction effect/, "effect runId must match its owning immutable transaction");
  await writeFile(recoveredMergerEffectPath, recoveredMergerEffectText, "utf-8");

  const transactionFile = (await readdir(join(output, "stages", "merge", "transactions"))).find((name) => name.startsWith("00000001-"))!;
  const transactionPath = join(output, "stages", "merge", "transactions", transactionFile);
  const transactionText = await readFile(transactionPath, "utf-8");
  const transaction = JSON.parse(transactionText) as Record<string, unknown>;
  const mergerEffectDirectory = join(output, "stages", "orchestration", "effects", merger.taskId);
  const mergerDispatchPath = join(output, "stages", "orchestration", "dispatches", `${merger.taskId}.json`);
  const mergerDispatch = await readFile(mergerDispatchPath, "utf-8");
  await writeFile(join(mergerEffectDirectory, "orphan.json"), `${JSON.stringify({ version: 1, kind: "mem-import-worker-effect", runId: run.runId, taskId: merger.taskId, effect: "merge", path: "stages/merge/transactions/00009999-orphan.json", contentHash: "f".repeat(64), recordedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
  await assert.rejects(new MemImportU2Service(new MemImportService()).workStatus(run), /Orphan canonical transaction effect/);
  await rm(join(mergerEffectDirectory, "orphan.json"));
  await rm(mergerEffectDirectory, { recursive: true, force: true });
  await rm(mergerDispatchPath);
  const missingDispatch = new MemImportU2Service(new MemImportService());
  await missingDispatch.workStatus(run);
  const missingDispatchChecks = await missingDispatch.checks(run);
  assert.ok(missingDispatchChecks.readiness.diagnostics.some((item) => item.message.includes(`Dispatch gate (${merger.taskId})`) && item.message.includes("lacks a correlated dispatch")));
  await writeFile(mergerDispatchPath, mergerDispatch, "utf-8");

  await rm(mergerEffectDirectory, { recursive: true, force: true });
  await writeFile(transactionPath, `${JSON.stringify({ ...transaction, actor: { kind: "worker", taskId: "missing-merger", role: "merger" } }, null, 2)}\n`, "utf-8");
  const malformed = new MemImportU2Service(new MemImportService());
  await assert.rejects(malformed.workStatus(run), /control digest is invalid/);
  const malformedChecks = await malformed.checks(run);
  assert.ok(malformedChecks.readiness.diagnostics.some((item) => item.message.includes("Transaction/effect integrity") && item.message.includes("control digest is invalid")));
  assert.equal(existsSync(join(output, "stages", "orchestration", "effects", "missing-merger")), false);
  const invalidTransactions: Array<{ name: string; receipt: Record<string, unknown>; error: RegExp }> = [
    { name: "wrong run", receipt: { ...transaction, runId: "mir-wrong-run" }, error: /unknown compendium run/ },
    { name: "non-worker actor", receipt: { ...transaction, actor: { kind: "coordinator", taskId: "forged-coordinator" } }, error: /control digest is invalid/ },
    { name: "wrong role", receipt: { ...transaction, actor: { kind: "worker", taskId: merger.taskId, role: "reviewer" } }, error: /control digest is invalid/ },
    { name: "wrong assignment authority", receipt: { ...transaction, assignmentAuthorityHash: "f".repeat(64) }, error: /control digest is invalid/ },
    { name: "outside lifecycle", receipt: { ...transaction, authorizedAt: "2000-01-01T00:00:00.000Z" }, error: /outside its assignment lifecycle/ },
    { name: "wrong hash control", receipt: { ...transaction, contentHash: "f".repeat(64) }, error: /filename does not match its content hash/ },
    { name: "broken parent", receipt: { ...transaction, parentContentHash: "f".repeat(64) }, error: /does not link to the reconstructed parent/ },
  ];
  for (const invalid of invalidTransactions) {
    await rm(mergerEffectDirectory, { recursive: true, force: true });
    await writeFile(transactionPath, `${JSON.stringify(invalid.receipt, null, 2)}\n`, "utf-8");
    await assert.rejects(new MemImportU2Service(new MemImportService()).workStatus(run), invalid.error, invalid.name);
    assert.equal(existsSync(mergerEffectDirectory), false, invalid.name);
  }
  await writeFile(transactionPath, `${JSON.stringify({ ...transaction, actor: { kind: "worker", taskId: "missing-merger", role: "merger" } }, null, 2)}\n`, "utf-8");
  const finalizerLease = await malformed.acquireCoordinatorLease({ ...run, taskId: "recovery-finalizer" });
  const blockedFinalization = await malformed.finalize({ ...run, taskId: "recovery-finalizer", fence: finalizerLease.fence });
  assert.equal(blockedFinalization.finalized, false);
  assert.ok(blockedFinalization.errors > 0);
  await malformed.releaseCoordinatorLease({ ...run, taskId: "recovery-finalizer", fence: finalizerLease.fence });
  await writeFile(transactionPath, transactionText, "utf-8");
  const misplacedTransaction = join(output, "stages", "merge", "revisions", transactionFile);
  await mkdir(join(output, "stages", "merge", "revisions"), { recursive: true });
  await rename(transactionPath, misplacedTransaction);
  await assert.rejects(new MemImportU2Service(new MemImportService()).workStatus(run), /receipt kind is stored in the wrong directory/);
  await rename(misplacedTransaction, transactionPath);
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
  await service.recordWorkerDispatch({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: first.taskId, facility: "subagent", hostTaskId: "interrupted-extractor", requestedTools: tools, observedTools: tools, outcome: "cancelled" });
  const retry = await service.assignExtractor({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "retry", unitIds: [unit.unitId], retriesTaskId: first.taskId });
  await service.recordWorkerDispatch({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: retry.taskId, facility: "subagent", hostTaskId: "resumed-extractor", requestedTools: tools, observedTools: tools, outcome: "completed" });
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
  assert.equal(final.finalized, false, "coverage and the unresolved reviewer action remain hard blockers");
  assert.match(await readFile(join(output, final.checksPath), "utf-8"), /requires a current scoped post-repair review/);
  const audit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(audit.version, 2);
  assert.equal(audit.status, "failed");
  assert.equal((audit.finalization as Record<string, unknown>).passed, false);
  assert.deepEqual(audit.evidenceReads, { total: { calls: 0, pages: 0, returnedItems: 0, returnedChars: 0 }, roles: [] });
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "parent-finalize", fence: finalLease.fence });
  const secondRevisionFile = (await readdir(join(output, "stages", "merge", "revisions"))).find((name) => name.startsWith("00000002-"))!;
  const secondRevisionPath = join(output, "stages", "merge", "revisions", secondRevisionFile);
  const secondRevision = JSON.parse(await readFile(secondRevisionPath, "utf-8")) as { stage: StageEnvelope };
  secondRevision.stage.artifacts![0]!.description = "Corrupted intermediate snapshot.";
  await writeFile(secondRevisionPath, `${JSON.stringify(secondRevision, null, 2)}\n`, "utf-8");
  const corruptedSnapshotChecks = await u2.checks(run);
  assert.ok(corruptedSnapshotChecks.readiness.diagnostics.some((item) => item.message.includes("snapshot does not match its semantic content hash")));
});

test("mem-import dispatch diagnostics reject revoked effect assignments", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const extractor = await service.assignExtractor({ ...run, taskId: "revoked-dispatch-extractor", unitIds: [units[0]!.unitId] });
  await service.submitExtraction({ ...extractor, unitId: units[0]!.unitId, stage: validStage(units[0]!) });
  await recordDispatch(service, run, extractor.taskId, "extractor");
  await service.revokeAssignment({ ...run, taskId: extractor.taskId });
  assert.deepEqual(await service.dispatchDiagnostics(output), [{ taskId: extractor.taskId, message: "Semantic worker effect belongs to a revoked assignment." }]);
});

test("mem-import finalization rejects inline or missing semantic dispatch receipts", async () => {
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
    service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "subagent", hostTaskId: "/private/session.jsonl", requestedTools: tools, observedTools: tools, outcome: "completed" }),
    /sanitized opaque identifier/,
  );
  await service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "inline", hostTaskId: "inline-extract", requestedTools: tools, observedTools: tools, outcome: "completed" });
  const inlineLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-finalize" });
  const inline = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-finalize", fence: inlineLease.fence });
  assert.equal(inline.finalized, false);
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-finalize", fence: inlineLease.fence });

  await recordDispatch(service, run, extractor.taskId, "extractor");
  const finalLease = await u2.acquireCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-success" });
  const final = await u2.finalize({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-success", fence: finalLease.fence });
  assert.equal(final.finalized, true, await readFile(join(output, final.checksPath), "utf-8"));
  await u2.releaseCoordinatorLease({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "dispatch-success", fence: finalLease.fence });
  const terminalRun = JSON.parse(await readFile(join(output, "stages", "orchestration", "run.json"), "utf-8")) as { terminal?: { status?: string } };
  assert.equal(terminalRun.terminal?.status, "finalized");
  assert.equal((await new MemImportU2Service(new MemImportService()).workStatus(run)).terminalStatus, "finalized");
  assert.equal((await service.status(run)).normalized, true);
  await u2.recordCoordinatorSession({
    ...run,
    phase: "review-finalization",
    facility: "subagent",
    hostTaskId: "final-coordinator-host",
    outcome: "completed",
    usageEvidence: usageEvidence(12, 4),
  });
  const terminalAudit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf-8")) as { status: string; usage?: { roles: Array<{ role: string }> } };
  assert.equal(terminalAudit.status, "finalized");
  assert.ok(terminalAudit.usage?.roles.some((item) => item.role === "coordinator"), "post-terminal coordinator usage refreshes the final audit");
  assert.match(await readFile(join(output, "world", "log.md"), "utf-8"), /\*\*Model usage:\*\* partial;[\s\S]*across 2 session record\(s\)/, "post-terminal usage refreshes the human-readable log");
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
  await assert.rejects(service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "subagent", hostTaskId: "terminal-host", requestedTools: extractor.tools, observedTools: extractor.tools, outcome: "completed" }), terminal);
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

test("mem-import rechecks lease expiry at the final canonical persistence boundary", async () => {
  let nowMs = Date.parse("2026-07-16T00:00:00.000Z");
  let stepMs = 0;
  const clock = () => {
    const value = new Date(nowMs);
    nowMs += stepMs;
    return value;
  };
  const service = new MemImportService(clock);
  const { output, run } = await setup(service);
  const u2 = new MemImportU2Service(service, clock);
  const lease = await u2.acquireCoordinatorLease({ ...run, taskId: "expiring-writer" });
  stepMs = 6 * 60_000;
  await assert.rejects(u2.writeCoordinatorMerge({
    ...run,
    taskId: "expiring-writer",
    fence: lease.fence,
    expectedRevision: 0,
    expectedContentHash: null,
    stage: { version: 1, kind: "merge", artifacts: [], candidateDispositions: [], diagnostics: [] },
    rationale: "A lease that expires during validation must not persist.",
  }), /expired/);
  assert.equal(existsSync(join(output, "stages", "merge", "merged-candidates.json")), false);
  assert.equal(existsSync(join(output, "stages", "merge", "revisions")), false);
  stepMs = 0;
  const recovered = await u2.acquireCoordinatorLease({ ...run, taskId: "recovered-writer" });
  await u2.releaseCoordinatorLease({ ...run, taskId: "recovered-writer", fence: recovered.fence });
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
  const ghostReconciler = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-ghost-match", role: "reconciler", proposalHashes: [proposal.contentHash] });
  const ghostMatch = await identities.submitWorkerIdentity({ ...ghostReconciler, packet: {
    version: 1, kind: "mem-import-identity", id: "ghost-match", proposalHashes: [proposal.contentHash], baselineRevision: 0, baselineContentHash: null,
    decisions: [{ id: "ghost-match-decision", provisionalId: "book-one-ghost", disposition: "match", canonicalId: "ghost", rationale: "Exercise rejection of a match to absent canon." }],
    rationale: "A missing canonical identity must not be created through match semantics.",
  } });
  const ghostMerger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-ghost-merge", role: "merger" });
  const ghostValidation = await u2.validateWorkerCommit({
    ...ghostMerger,
    proposalHashes: [proposal.contentHash],
    identityProposalHashes: [ghostMatch.contentHash],
    readSet: [{ artifactId: "ada", contentHash: null }, { artifactId: "ghost", contentHash: null }],
    proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada"] }],
    changes: [{ kind: "upsert", artifact: { ...artifact, id: "ghost", title: "Ghost" } }],
    rationale: "Reject match semantics that would create an absent canonical identity.",
  });
  assert.equal(ghostValidation.valid, false);
  assert.ok(ghostValidation.issues.some((issue) => /Matched canonical identity ghost is absent/.test(issue.message)));
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

  const resolutionProposer = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-resolution-propose", role: "proposer", unitIds: [unit.unitId] });
  const resolutionProposal = await proposals.submitWorkerProposal({ ...resolutionProposer, packet: { version: 1, kind: "mem-import-proposal", id: "identity-resolution-shard", inputs: [{ unitId: unit.unitId, packetHash: extracted.packetHash }], artifacts: [artifact], candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId: "ada" }], rationale: "Support the later explicit identity resolution without reusing consumed evidence." } });
  const reconciler2 = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-match", role: "reconciler", proposalHashes: [resolutionProposal.contentHash] });
  const match = await identities.submitWorkerIdentity({ ...reconciler2, packet: {
    version: 1, kind: "mem-import-identity", id: "ada-match", proposalHashes: [resolutionProposal.contentHash], baselineRevision: first.revision, baselineContentHash: first.contentHash,
    decisions: [{ id: "ada-match-decision", provisionalId: "book-one-ada", disposition: "match", canonicalId: "ada", rationale: "The reviewer accepted the existing Ada canonical identity." }],
    rationale: "Record the explicit model-owned identity resolution.",
  } });
  const resolutionMerger = await service.assignWorker({ outputRoot: output, runId: run.runId, coordinatorGrant: run.coordinatorGrant, taskId: "identity-resolution-merge", role: "merger" });
  const resolveLease = await u2.acquireWorkerLease(resolutionMerger);
  await u2.applyWorkerBatch({ ...resolutionMerger, fence: resolveLease.fence, expectedRevision: first.revision, expectedContentHash: first.contentHash, batch: {
    proposalHashes: [resolutionProposal.contentHash], identityProposalHashes: [match.contentHash], readSet: [{ artifactId: "ada", contentHash: canonicalHash(first.stage.artifacts![0]) }], operations: [{ kind: "upsert", artifact }],
    conflictOperations: [{ kind: "resolve", conflictId: "ada-identity-conflict" }], rationale: "Resolve the Ada identity conflict against the retained canonical artifact.",
  } });
  await u2.releaseWorkerLease({ ...resolutionMerger, fence: resolveLease.fence });
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
  await assert.rejects(u2.workStatus(run), /reconciliation is deferred while another merge writer lease is active/);
  for (const { artifact, proposal } of [...submitted].reverse()) {
    const state = await u2.readMergeForWorker(merger);
    await u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: state.revision, expectedContentHash: state.contentHash, batch: { proposalHashes: [proposal.contentHash], readSet: [{ artifactId: artifact.id, contentHash: null }], operations: [{ kind: "upsert", artifact }], rationale: `Commit ${artifact.id} through the single transaction queue.` } });
  }
  const committed = await u2.readMergeForWorker(merger);
  assert.equal(committed.revision, 20);
  assert.equal(committed.stage.artifacts?.length, 20);
  const transactionFiles = await readdir(join(output, "stages", "merge", "transactions"));
  assert.equal(transactionFiles.length, 20);
  const firstReceipt = JSON.parse(await readFile(join(output, "stages", "merge", "transactions", transactionFiles.find((name) => name.startsWith("00000001-"))!), "utf-8")) as { contentHash: string; stage?: unknown; operations: Array<{ artifactRef?: string }> };
  assert.equal(firstReceipt.stage, undefined, "transaction receipts must not materialize complete merge stages");
  assert.match(firstReceipt.operations[0]!.artifactRef ?? "", /^[a-f0-9]{64}$/);
  assert.equal((await readdir(join(output, "stages", "merge", "artifacts"))).length, 20, "changed artifacts are content-addressed and deduplicated outside receipts");
  const checkpointFiles = await readdir(join(output, "stages", "merge", "checkpoints"));
  assert.equal(checkpointFiles.length, 1, "a bounded checkpoint caps later replay length");
  const checkpointPath = join(output, "stages", "merge", "checkpoints", checkpointFiles[0]!);
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf-8")) as { revision: number; contentHash: string };
  const misplacedCheckpointPath = `${checkpointPath}.misnamed.json`;
  await rename(checkpointPath, misplacedCheckpointPath);
  const checkpointReviewer = await service.assignWorker({ ...run, taskId: "pressure-checkpoint-review", role: "reviewer" });
  await assert.rejects(u2.submitReview({ ...checkpointReviewer, packet: { version: 1, kind: "mem-import-review", checkpointId: "pressure-checkpoint-invalid", reviewedMergeRevision: checkpoint.revision, reviewedMergeHash: checkpoint.contentHash, readSet: [], findings: [], requestedActions: [] } }), /checkpoint .* filename does not match its content hash/);
  await rename(misplacedCheckpointPath, checkpointPath);
  const reviewer = await service.assignWorker({ ...run, taskId: "pressure-history-review", role: "reviewer" });
  await recordDispatch(service, run, reviewer.taskId, "reviewer");
  await u2.submitReview({ ...reviewer, packet: { version: 1, kind: "mem-import-review", checkpointId: "pressure-history", reviewedMergeRevision: 1, reviewedMergeHash: firstReceipt.contentHash, readSet: [], findings: [], requestedActions: [] } });
  const beforeFailure = committed.contentHash;
  await assert.rejects(
    u2.applyWorkerBatch({ ...merger, fence: lease.fence, expectedRevision: committed.revision, expectedContentHash: committed.contentHash, batch: { proposalHashes: ["0".repeat(64)], readSet: [{ artifactId: "interrupted", contentHash: null }], operations: [{ kind: "delete", artifactId: "interrupted" }], rationale: "This malformed interrupted transaction must not replace accepted state." } }),
    /Declared proposal/,
  );
  const afterFailure = await u2.readMergeForWorker(merger);
  assert.equal(afterFailure.revision, 20);
  assert.equal(afterFailure.contentHash, beforeFailure);
  await u2.releaseWorkerLease({ ...merger, fence: lease.fence });
  await rm(join(output, "stages", "merge", "transactions", transactionFiles.find((name) => name.startsWith("00000001-"))!));
  await assert.rejects(new MemImportU2Service(new MemImportService()).workStatus(run), /Expected exactly one immutable receipt for merge revision 1/, "the revision-16 checkpoint must not hide an earlier missing receipt");
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
  await u2.releaseCoordinatorLease({ ...run, taskId: "large-seed", fence: lease.fence });
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
});

test("mem-import model-facing mutation tools use compact receipt methods", async () => {
  const extensionSource = await readFile(join(process.cwd(), "extensions", "mem-import-tools.ts"), "utf-8");
  assert.match(extensionSource, /mem_merge_requirements[\s\S]*?readWorkerMergeRequirements\(params\)/);
  assert.match(extensionSource, /mem_merge_validate[\s\S]*?validateWorkerCommit\(params\)/);
  assert.match(extensionSource, /mem_merge_commit[\s\S]*?commitWorkerBatchReceipt\(params\)/);
  assert.match(extensionSource, /mem_merge_apply_repair_batch[\s\S]*?applyWorkerRepairBatchReceipt\(params\)/);
  assert.match(extensionSource, /mem_import_merge_state[\s\S]*?mergeControls\(params\)/);
  assert.match(extensionSource, /name: "mem_import_record_session"[\s\S]*?phase: Type\.Union[\s\S]*?hostTaskId: Type\.String[\s\S]*?hostSessionId: Type\.Optional[\s\S]*?u2\.recordCoordinatorSession\(params\)/);
  assert.match(extensionSource, /mem_import_effect_inventory[\s\S]*?u2\.effectInventory\(params\)/);
  assert.doesNotMatch(extensionSource, /return result\(await u2\.mergeState\(params\)\)/);
  assert.doesNotMatch(extensionSource, /return result\(await u2\.commitWorkerBatch\(params\)\)/);
  assert.doesNotMatch(extensionSource, /return result\(await u2\.applyWorkerRepairBatch\(params\)\)/);
  for (const toolName of [
    "mem_source_read_unit", "mem_extraction_read", "mem_proposal_inventory", "mem_proposal_read", "mem_identity_inventory", "mem_identity_read",
    "mem_source_read_worker", "mem_extraction_inventory_worker", "mem_extraction_read_worker", "mem_merge_inventory", "mem_merge_read_artifact", "mem_merge_requirements",
  ]) assert.match(extensionSource, new RegExp(`trackedEvidenceRead\\(\\"${toolName}\\"`));
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

test("identity packets require their complete proposal evidence scope in one batch", async () => {
  const { run, units } = await setup();
  const service = new MemImportService();
  const proposals = new MemImportProposalService(service);
  const identities = new MemImportIdentityService(service);
  const u2 = new MemImportU2Service(service);
  const extractor = await service.assignExtractor({ ...run, taskId: "identity-scope-extract", unitIds: units.map((unit) => unit.unitId) });
  for (const unit of units) await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage: validStage(unit) });
  const proposalHashes: string[] = [];
  for (const [index, unit] of units.entries()) {
    const artifactId = `scope-entity-${index + 1}`;
    const proposer = await service.assignWorker({ ...run, taskId: `identity-scope-proposer-${index + 1}`, role: "proposer", unitIds: [unit.unitId] });
    const proposal = await proposals.submitWorkerProposalBody({
      ...proposer,
      artifacts: [{ id: artifactId, group: "people", title: `Scope Entity ${index + 1}`, description: "Synthetic identity-scope evidence.", sections: [{ heading: "Summary", body: "This artifact tests atomic identity evidence scope." }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] }],
      candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId }],
      rationale: "Create one half of a cross-proposal identity scope.",
    });
    proposalHashes.push(proposal.contentHash);
  }
  const reconciler = await service.assignWorker({ ...run, taskId: "identity-scope-reconciler", role: "reconciler", proposalHashes });
  const identity = await identities.submitWorkerIdentity({ ...reconciler, packet: {
    version: 1, kind: "mem-import-identity", id: "identity-scope-packet", proposalHashes, baselineRevision: 0, baselineContentHash: null,
    decisions: [{ id: "identity-scope-ambiguous", provisionalId: "identity-scope", disposition: "ambiguous", blocking: false, rationale: "No canonical identity decision is needed for this scope test." }],
    rationale: "Bind both proposals into one indivisible identity evidence packet.",
  } });
  const merger = await service.assignWorker({ ...run, taskId: "identity-scope-merger", role: "merger" });
  const validation = await u2.validateWorkerCommit({
    ...merger,
    proposalHashes: [proposalHashes[0]!],
    identityProposalHashes: [identity.contentHash],
    readSet: [{ artifactId: "scope-entity-1", contentHash: null }],
    proposalAccepts: [{ proposalHash: proposalHashes[0]!, artifactIds: ["scope-entity-1"] }],
    rationale: "Reject partial acceptance of a multi-proposal identity packet.",
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => /complete proposal scope.*missing/.test(issue.message)));
});

test("merge requirements scope identity packets to one planned transaction subset", async () => {
  const { run, units } = await setup();
  const service = new MemImportService();
  const plans = new MemImportClusterPlanService(service);
  const proposals = new MemImportProposalService(service);
  const identities = new MemImportIdentityService(service);
  const u2 = new MemImportU2Service(service);
  const extractor = await service.assignExtractor({ ...run, taskId: "subset-extract", unitIds: units.map((unit) => unit.unitId) });
  for (const [index, unit] of units.entries()) {
    const stage = validStage(unit);
    stage.candidates![0]!.title = `Entity ${index + 1}`;
    await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage });
  }
  const inventory = await plans.candidateInventory({ ...run, maxItems: 100 });
  const candidateIds = inventory.candidates.map((candidate) => `${candidate.unitId}:${candidate.candidateId}`);
  const plan = await plans.submit({
    ...run,
    snapshotHash: inventory.snapshotHash,
    baselineRevision: inventory.baselineRevision,
    baselineContentHash: inventory.baselineContentHash,
    plan: {
      id: "two-transaction-plan",
      clusters: candidateIds.map((candidateId, index) => ({ id: `cluster-${index + 1}`, label: `Entity ${index + 1}`, kind: "identity" as const, candidateIds: [candidateId], rationale: "Keep this bounded identity independent." })),
      reconciliationSets: candidateIds.map((_candidateId, index) => ({ id: `set-${index + 1}`, clusterIds: [`cluster-${index + 1}`], rationale: "Reconcile only this transaction's cluster." })),
      rationale: "Keep two independent planned transactions and identity packets scoped.",
    },
  });
  const proposalHashes: string[] = [];
  const identityHashes: string[] = [];
  for (const [index, unit] of units.entries()) {
    const proposer = await service.assignWorker({ ...run, taskId: `subset-proposer-${index + 1}`, role: "proposer", planHash: plan.planHash, clusterId: `cluster-${index + 1}` });
    const artifactId = `entity-${index + 1}`;
    const proposal = await proposals.submitWorkerProposalBody({
      ...proposer,
      artifacts: [{ id: artifactId, group: "people", title: `Entity ${index + 1}`, description: `Independent entity ${index + 1}.`, sections: [{ heading: "Summary", body: `Entity ${index + 1} remains transaction-scoped.` }], provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }] }],
      candidateDispositions: [{ unitId: unit.unitId, candidateId: "local-candidate", disposition: "represented", artifactId }],
      rationale: "Create one bounded transaction proposal.",
    });
    proposalHashes.push(proposal.contentHash);
    await recordDispatch(service, run, proposer.taskId, "proposer");
    const reconciler = await service.assignWorker({ ...run, taskId: `subset-reconciler-${index + 1}`, role: "reconciler", planHash: plan.planHash, reconciliationSetId: `set-${index + 1}` });
    const identity = await identities.submitWorkerIdentity({ ...reconciler, packet: { version: 1, kind: "mem-import-identity", id: `identity-${index + 1}`, decisions: [{ id: `create-${index + 1}`, provisionalId: artifactId, disposition: "create", canonicalId: artifactId, rationale: "Create only this transaction's canonical identity." }], rationale: "Keep identity prerequisites transaction-scoped." } });
    identityHashes.push(identity.contentHash);
    await recordDispatch(service, run, reconciler.taskId, "reconciler");
  }
  const merger = await service.assignWorker({ ...run, taskId: "subset-merger", role: "merger", planHash: plan.planHash });
  assert.deepEqual(merger.proposalHashes, proposalHashes);
  assert.deepEqual(merger.identityProposalHashes, identityHashes);
  const first = await u2.readWorkerMergeRequirements({ ...merger, proposalHashes: [proposalHashes[0]!] });
  assert.deepEqual(first.requiredIdentityProposalHashes, [identityHashes[0]]);
  assert.deepEqual(first.identityCreates.map((item) => item.canonicalId), ["entity-1"]);
  const second = await u2.readWorkerMergeRequirements({ ...merger, proposalHashes: [proposalHashes[1]!] });
  assert.deepEqual(second.requiredIdentityProposalHashes, [identityHashes[1]]);
  assert.deepEqual(second.identityCreates.map((item) => item.canonicalId), ["entity-2"]);
});

test("identity-aware cluster plans bind cross-unit work, retries, reconciliation, and merge readiness", async () => {
  const { output, run, units } = await setup();
  const service = new MemImportService();
  const plans = new MemImportClusterPlanService(service);
  const proposals = new MemImportProposalService(service);
  const identities = new MemImportIdentityService(service);
  const u2 = new MemImportU2Service(service);
  const extractor = await service.assignExtractor({ ...run, taskId: "plan-extract", unitIds: units.map((unit) => unit.unitId) });
  for (const unit of units) {
    const stage = validStage(unit);
    stage.candidates![0]!.title = "Ada";
    await service.submitExtraction({ ...extractor, unitId: unit.unitId, stage });
  }

  // Seed an existing canonical identity so the plan can declare a bounded dependency.
  const canonicalAda = {
    id: "ada", group: "people" as const, title: "Ada", description: "Ada is already canonical.",
    sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
    provenance: [{ sourceId: units[0]!.sourceId, unitId: units[0]!.unitId, startAnchor: units[0]!.anchors[0]!, endAnchor: units[0]!.anchors[0]! }],
  };
  const seedLease = await u2.acquireCoordinatorLease({ ...run, taskId: "plan-seed" });
  const seeded = await u2.writeCoordinatorMerge({ ...run, taskId: "plan-seed", fence: seedLease.fence, expectedRevision: 0, expectedContentHash: null, stage: { version: 1, kind: "merge", artifacts: [canonicalAda], candidateDispositions: [], diagnostics: [] }, rationale: "Seed an existing Ada identity for planned reconciliation." });
  await u2.releaseCoordinatorLease({ ...run, taskId: "plan-seed", fence: seedLease.fence });

  const firstInventory = await plans.candidateInventory({ ...run, maxItems: 1 });
  assert.equal(firstInventory.totalCandidates, 2);
  assert.equal(firstInventory.candidates.length, 1);
  assert.equal(firstInventory.truncated, true);
  assert.ok(firstInventory.continuationCursor);
  const secondInventory = await plans.candidateInventory({ ...run, maxItems: 1, continuationCursor: firstInventory.continuationCursor });
  assert.deepEqual([...firstInventory.candidates, ...secondInventory.candidates].map((item) => `${item.unitId}:${item.candidateId}`), units.map((unit) => `${unit.unitId}:local-candidate`));

  const changed = validStage(units[1]!);
  changed.candidates![0]!.title = "Ada, recurring guard";
  await service.submitExtraction({ ...extractor, unitId: units[1]!.unitId, stage: changed });
  await assert.rejects(plans.candidateInventory({ ...run, maxItems: 1, continuationCursor: firstInventory.continuationCursor }), /stale or invalid/);
  const inventory = await plans.candidateInventory({ ...run, maxItems: 100 });
  const candidateIds = inventory.candidates.map((item) => `${item.unitId}:${item.candidateId}`);
  const dependencyHash = canonicalHash(seeded.stage.artifacts![0]);
  const planBody = {
    id: "ada-cross-unit-plan",
    clusters: [{ id: "ada-recurring", label: "Ada", kind: "identity" as const, candidateIds, rationale: "Both source units describe the recurring Ada identity." }],
    reconciliationSets: [{ id: "ada-existing", clusterIds: ["ada-recurring"], canonicalDependencies: [{ artifactId: "ada", contentHash: dependencyHash }], rationale: "Compare the recurring observations with canonical Ada." }],
    rationale: "Keep the central recurring entity together before canonical merge.",
  };
  await assert.rejects(plans.submit({ ...run, snapshotHash: firstInventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: planBody }), /snapshot is stale/);
  await assert.rejects(plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: 0, baselineContentHash: null, plan: planBody }), /canonical baseline is stale/);
  await assert.rejects(plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: { ...planBody, clusters: [{ id: "missing", label: "Incomplete Ada", kind: "coherent", candidateIds: [candidateIds[0]!], rationale: "Incomplete." }] } }), /missing/);
  await assert.rejects(plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: { ...planBody, clusters: [{ id: "duplicate", label: "Duplicate Ada", kind: "identity", candidateIds: [candidateIds[0]!, candidateIds[0]!], rationale: "This intentionally duplicates one candidate." }] } }), /appears more than once/);
  const submittedPlan = await plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: planBody });
  assert.equal(submittedPlan.idempotent, false);
  await assert.rejects(service.submitExtraction({ ...extractor, unitId: units[0]!.unitId, stage: validStage(units[0]!) }), /immutable after a cluster plan/);
  assert.equal((await plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: planBody })).idempotent, true);
  await assert.rejects(plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: { ...planBody, rationale: "A different immutable plan." } }), /already exists/);

  await assert.rejects(service.assignWorker({ ...run, taskId: "early-reconcile", role: "reconciler", planHash: submittedPlan.planHash, reconciliationSetId: "ada-existing" }), /not assignable/);
  const failedProposer = await service.assignWorker({ ...run, taskId: "plan-proposer-failed", role: "proposer", planHash: submittedPlan.planHash, clusterId: "ada-recurring" });
  assert.deepEqual(failedProposer.candidateIds, candidateIds);
  assert.deepEqual(failedProposer.unitIds, units.map((unit) => unit.unitId));
  await assert.rejects(service.assignWorker({ ...run, taskId: "plan-proposer-overlap", role: "proposer", planHash: submittedPlan.planHash, clusterId: "ada-recurring" }), /live assignment/);
  await service.recordWorkerDispatch({ ...run, taskId: failedProposer.taskId, facility: "subagent", hostTaskId: "failed-plan-proposer", requestedTools: failedProposer.tools, observedTools: failedProposer.tools, outcome: "failed" });
  await assert.rejects(service.assignWorker({ ...run, taskId: "plan-proposer-unlinked-retry", role: "proposer", planHash: submittedPlan.planHash, clusterId: "ada-recurring" }), /requires retriesTaskId/);
  const proposer = await service.assignWorker({ ...run, taskId: "plan-proposer-retry", role: "proposer", planHash: submittedPlan.planHash, clusterId: "ada-recurring", retriesTaskId: failedProposer.taskId });
  const proposedAda = {
    id: "ada", group: "people" as const, title: "Ada", description: "Ada recurs across both source units.",
    sections: [{ heading: "Summary", body: "Ada is the recurring guard observed across the corpus." }],
    provenance: units.map((unit) => ({ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! })),
  };
  const proposedWatch = {
    id: "fresh-watch", group: "things" as const, title: "Watch", description: "A newly canonical watch accompanies Ada.",
    sections: [{ heading: "Summary", body: "The watch is retained as a separate salient object." }],
    provenance: [{ sourceId: units[0]!.sourceId, unitId: units[0]!.unitId, startAnchor: units[0]!.anchors[0]!, endAnchor: units[0]!.anchors[0]! }],
  };
  const proposal = await proposals.submitWorkerProposalBody({
    ...proposer,
    artifacts: [proposedAda, proposedWatch],
    candidateDispositions: units.map((unit) => ({ unitId: unit.unitId, candidateId: "local-candidate", disposition: "merged", artifactId: "ada" })),
    rationale: "Synthesize the model-owned cross-unit Ada identity cluster.",
  });
  const storedProposal = JSON.parse(await readFile(join(output, proposal.path), "utf-8")) as { planHash: string; clusterId: string };
  assert.equal(storedProposal.planHash, submittedPlan.planHash);
  assert.equal(storedProposal.clusterId, "ada-recurring");
  await recordDispatch(service, run, proposer.taskId, "proposer");
  await assert.rejects(service.assignWorker({ ...run, taskId: "plan-proposer-second", role: "proposer", planHash: submittedPlan.planHash, clusterId: "ada-recurring" }), /effective assignment/);

  const beforeIdentity = await plans.status({ ...run, maxItems: 1 });
  assert.equal(beforeIdentity.proposedClusterCount, 1);
  assert.equal(beforeIdentity.completedReconciliationSetCount, 0);
  assert.equal(beforeIdentity.readyForMerge, false);
  assert.equal(beforeIdentity.returnedItems, 1);
  assert.equal(beforeIdentity.truncated, true);
  assert.ok(serializedModelToolResultSize(beforeIdentity) < 10_000);
  await assert.rejects(service.assignWorker({ ...run, taskId: "plan-merger-too-early", role: "merger", planHash: submittedPlan.planHash }), /not ready for merge/);

  const reconciler = await service.assignWorker({ ...run, taskId: "plan-reconciler", role: "reconciler", planHash: submittedPlan.planHash, reconciliationSetId: "ada-existing" });
  assert.deepEqual(reconciler.proposalHashes, [proposal.contentHash]);
  const identity = await identities.submitWorkerIdentity({ ...reconciler, packet: {
    version: 1, kind: "mem-import-identity", id: "ada-planned-match",
    decisions: [
      { id: "ada-match", provisionalId: "ada", disposition: "match", canonicalId: "ada", rationale: "The cross-unit evidence supports canonical Ada." },
      { id: "watch-create", provisionalId: "fresh-watch", disposition: "create", canonicalId: "fresh-watch", rationale: "The proposal introduces a distinct salient watch." },
    ],
    rationale: "Reconcile the planned recurring cluster with existing canon.",
  } });
  const storedIdentity = JSON.parse(await readFile(join(output, identity.path), "utf-8")) as { planHash: string; reconciliationSetId: string; proposalHashes: string[]; baselineRevision: number; canonicalDependencies: unknown[] };
  assert.equal(storedIdentity.planHash, submittedPlan.planHash);
  assert.equal(storedIdentity.reconciliationSetId, "ada-existing");
  assert.deepEqual(storedIdentity.proposalHashes, [proposal.contentHash]);
  assert.equal(storedIdentity.baselineRevision, seeded.revision);
  assert.equal(storedIdentity.canonicalDependencies.length, 1);
  await recordDispatch(service, run, reconciler.taskId, "reconciler");

  const ready = await new MemImportClusterPlanService(new MemImportService()).status({ ...run, maxItems: 1 });
  assert.equal(ready.readyForMerge, true);
  assert.equal(ready.completedReconciliationSetCount, 1);
  assert.deepEqual(ready.entries[0], { kind: "cluster", clusterId: "ada-recurring", label: "Ada", clusterKind: "identity", candidateCount: 2, status: "proposed", proposalHash: proposal.contentHash });
  const readyNext = await new MemImportClusterPlanService(new MemImportService()).status({ ...run, maxItems: 1, continuationCursor: ready.continuationCursor });
  assert.equal(readyNext.entries[0]!.kind, "reconciliation-set");

  // A canonical revision touching only another artifact does not stale the identity packet's explicit dependency.
  const unrelated = { ...canonicalAda, id: "bea", title: "Bea", description: "Bea is unrelated to Ada." };
  const unrelatedLease = await u2.acquireCoordinatorLease({ ...run, taskId: "plan-unrelated" });
  const unrelatedRevision = await u2.writeCoordinatorMerge({ ...run, taskId: "plan-unrelated", fence: unrelatedLease.fence, expectedRevision: seeded.revision, expectedContentHash: seeded.contentHash, stage: { version: 1, kind: "merge", artifacts: [canonicalAda, unrelated], candidateDispositions: [], diagnostics: [] }, rationale: "Add an unrelated canonical artifact without changing the declared Ada dependency." });
  await u2.releaseCoordinatorLease({ ...run, taskId: "plan-unrelated", fence: unrelatedLease.fence });

  const merger = await service.assignWorker({ ...run, taskId: "plan-merger", role: "merger", planHash: submittedPlan.planHash });
  assert.deepEqual(merger.proposalHashes, [proposal.contentHash]);
  assert.deepEqual(merger.identityProposalHashes, [identity.contentHash]);
  const requirements = await u2.readWorkerMergeRequirements({ ...merger, proposalHashes: [proposal.contentHash] });
  assert.equal(requirements.revision, unrelatedRevision.revision);
  assert.deepEqual(requirements.proposalHashes, [proposal.contentHash]);
  assert.deepEqual(requirements.requiredIdentityProposalHashes, [identity.contentHash]);
  assert.deepEqual(requirements.pendingIdentityProposalHashes, [identity.contentHash]);
  assert.deepEqual(requirements.acceptedIdentityProposalHashes, []);
  assert.deepEqual(requirements.identityCreates, [{ identityProposalHash: identity.contentHash, decisionId: "watch-create", canonicalId: "fresh-watch", requiredContentHash: null }]);
  assert.deepEqual(requirements.identityMatches, [{ identityProposalHash: identity.contentHash, decisionId: "ada-match", canonicalId: "ada", contentHash: dependencyHash }]);
  assert.deepEqual(requirements.limits, { proposals: 50, accepts: 50, synthesizedChanges: 12, totalChanges: 62 });

  for (const malformedHash of ["abc", "A".repeat(64)]) {
    const malformedHashValidation = await u2.validateWorkerCommit({ ...merger, proposalHashes: [malformedHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }], proposalAccepts: [{ proposalHash: malformedHash, artifactIds: ["ada"] }], rationale: "Reject malformed proposal hashes before proposal lookup." });
    assert.equal(malformedHashValidation.valid, false);
    assert.match(malformedHashValidation.issues[0]!.message, /SHA-256/);
  }
  const missingIdentityValidation = await u2.validateWorkerCommit({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: undefined, readSet: [{ artifactId: "ada", contentHash: dependencyHash }, { artifactId: "fresh-watch", contentHash: null }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada", "fresh-watch"] }], rationale: "Validate the intentionally incomplete identity-aware merge." });
  assert.equal(missingIdentityValidation.valid, false);
  assert.match(missingIdentityValidation.issues[0]!.message, /requires identity packet/);
  assert.equal((await u2.mergeControls(run)).revision, unrelatedRevision.revision, "validation must not mutate canonical state");
  await assert.rejects(u2.commitWorkerBatchReceipt({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: undefined, readSet: [{ artifactId: "ada", contentHash: dependencyHash }], changes: [{ kind: "accept", proposalHash: proposal.contentHash, artifactId: "ada" }], rationale: "Reject planned merge work that omits its required identity packet." }), /requires identity packet/);
  await assert.rejects(u2.commitWorkerBatchReceipt({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: ["f".repeat(64)], readSet: [{ artifactId: "ada", contentHash: dependencyHash }], changes: [{ kind: "accept", proposalHash: proposal.contentHash, artifactId: "ada" }], rationale: "Reject an identity packet outside the planned merger assignment." }), /outside this merger assignment/);
  const partial = await u2.validateWorkerCommit({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada"] }], rationale: "Reject partial grouped proposal consumption." });
  assert.equal(partial.valid, false);
  assert.match(partial.issues[0]!.message, /does not account for declared proposal artifacts: fresh-watch/);
  const missingCreateUpsert = await u2.validateWorkerCommit({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }, { artifactId: "fresh-watch", contentHash: null }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada"] }], changes: [{ kind: "delete", artifactId: "fresh-watch" }], rationale: "Reject an identity create without its required same-batch upsert." });
  assert.equal(missingCreateUpsert.valid, false);
  assert.ok(missingCreateUpsert.issues.some((issue) => /requires an upsert in the same batch/.test(issue.message)));
  const malformedUpsert = await u2.validateWorkerCommit({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }, { artifactId: "fresh-watch", contentHash: null }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada"] }], changes: [{ kind: "upsert", artifact: { ...proposedWatch, proposalHash: proposal.contentHash } } as any], rationale: "Reject merge control fields embedded in an upsert artifact." });
  assert.equal(malformedUpsert.valid, false);
  assert.match(malformedUpsert.issues[0]!.message, /unsupported fields: proposalHash/);
  await assert.rejects(u2.commitWorkerBatchReceipt({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }, { artifactId: "fresh-watch", contentHash: null }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada"] }], changes: [{ kind: "upsert", artifact: { ...proposedWatch, proposalHash: proposal.contentHash } } as any], rationale: "Reject malformed direct commit payloads before persistence." }), /unsupported fields: proposalHash/);
  assert.equal(existsSync(join(output, "stages", "merge", "artifacts")), false, "failed validation and commit must not persist artifact blobs");
  const valid = await u2.validateWorkerCommit({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }, { artifactId: "fresh-watch", contentHash: null }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada", "fresh-watch"] }], rationale: "Validate grouped acceptance for the ready identity-aware plan." });
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.valid, true);
  assert.equal(valid.acceptCount, 2);
  assert.equal(valid.synthesizedCount, 0);
  const merged = await u2.commitWorkerBatchReceipt({ ...merger, proposalHashes: [proposal.contentHash], identityProposalHashes: [identity.contentHash], readSet: [{ artifactId: "ada", contentHash: dependencyHash }, { artifactId: "fresh-watch", contentHash: null }], proposalAccepts: [{ proposalHash: proposal.contentHash, artifactIds: ["ada", "fresh-watch"] }], rationale: "Accept the ready identity-aware plan after an unrelated canonical revision." });
  assert.equal(merged.revision, unrelatedRevision.revision + 1);
  const afterRequirements = await u2.readWorkerMergeRequirements({ ...merger, proposalHashes: [proposal.contentHash] });
  assert.deepEqual(afterRequirements.proposalHashes, []);
  assert.deepEqual(afterRequirements.pendingIdentityProposalHashes, []);
  assert.deepEqual(afterRequirements.acceptedIdentityProposalHashes, [identity.contentHash]);
  assert.deepEqual(afterRequirements.identityCreates, []);

  await u2.fail({ ...run, reasonCode: "terminal-plan-test", message: "Verify the cluster-plan mutation guard after completing the focused fixture." });
  await assert.rejects(plans.submit({ ...run, snapshotHash: inventory.snapshotHash, baselineRevision: inventory.baselineRevision, baselineContentHash: inventory.baselineContentHash, plan: planBody }), /run is terminal/);
});
