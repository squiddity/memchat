import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemImportService } from "./mem-import/service.js";
import { MemImportCanonicalService } from "./mem-import/canonical-service.js";
import { MemImportQualityService } from "./mem-import/quality-service.js";
import { validateModePacket, assertBudget } from "./mem-import/quality-protocol.js";

test("quality protocol separates v2 modes and bounds repair budgets", () => {
  assert.throws(() => assertBudget({ maxRepairEpisodes: 2, maxRepairTransactions: 1, maxChangedArtifacts: 1, maxCreatedArtifacts: 0, maxVerificationRounds: 1, maxEmergencyRepairs: 0, maxElapsedMinutes: 1 }), /one repair episode/);
  assert.throws(() => validateModePacket({ version: 2, kind: "mem-import-review", mode: "verification", checkpointId: "cp", reviewedMergeRevision: 1, reviewedMergeHash: "0".repeat(64), findings: [], requestedActions: [], readSet: [] }), /campaignId/);
  assert.doesNotThrow(() => validateModePacket({ version: 2, kind: "mem-import-review", mode: "initial-shard", checkpointId: "cp", reviewedMergeRevision: 1, reviewedMergeHash: "0".repeat(64), findings: [], requestedActions: [], readSet: [] }));
});

test("deferred non-blocking policy finalizes with visible quality debt", async () => {
  const root = await mkdtemp(join(tmpdir(), "memchat-quality-deferred-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "one.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>");
  const service = new MemImportService();
  const run = await service.begin(output);
  const manifest = await service.normalize({ ...run, input });
  const unit = manifest.units[0]!;
  const extractor = await service.assignExtractor({ ...run, taskId: "deferred-extractor", unitIds: [unit.unitId] });
  await service.submitExtraction({
    ...extractor,
    unitId: unit.unitId,
    stage: {
      version: 1,
      kind: "extraction",
      unitId: unit.unitId,
      sourceId: unit.sourceId,
      candidates: [{
        id: "ada",
        group: "people",
        title: "Ada",
        provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
      }],
    },
  });
  await service.recordWorkerDispatch({ ...run, taskId: extractor.taskId, facility: "subagent", hostTaskId: "host-deferred-extractor", requestedTools: extractor.tools, observedTools: extractor.tools, outcome: "completed" });
  const canonical = new MemImportCanonicalService(service);
  const mergeLease = await canonical.acquireCoordinatorLease({ ...run, taskId: "deferred-seed" });
  const merged = await canonical.writeCoordinatorMerge({
    ...run,
    taskId: "deferred-seed",
    fence: mergeLease.fence,
    expectedRevision: 0,
    expectedContentHash: null,
    rationale: "Seed a canonical artifact for deferred quality debt.",
    stage: {
      version: 1,
      kind: "merge",
      artifacts: [{
        id: "ada",
        group: "people",
        title: "Ada",
        description: "Ada guards the glass tower.",
        sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
        provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: unit.anchors[0]!, endAnchor: unit.anchors[0]! }],
      }],
      candidateDispositions: [{ unitId: unit.unitId, candidateId: "ada", disposition: "represented", artifactId: "ada" }],
      diagnostics: [],
    },
  });
  await canonical.releaseCoordinatorLease({ ...run, taskId: "deferred-seed", fence: mergeLease.fence });
  const reviewer = await service.assignWorker({ ...run, taskId: "deferred-reviewer", role: "reviewer" });
  await service.recordWorkerDispatch({ ...run, taskId: reviewer.taskId, facility: "subagent", hostTaskId: "host-deferred-reviewer", requestedTools: reviewer.tools, observedTools: reviewer.tools, outcome: "completed" });
  await canonical.submitReview({
    ...reviewer,
    packet: {
      version: 1,
      kind: "mem-import-review",
      checkpointId: "deferred-checkpoint",
      reviewedMergeRevision: merged.revision,
      reviewedMergeHash: merged.contentHash!,
      findings: [],
      requestedActions: [{ id: "optional-links", type: "enrichment", severity: "repair", summary: "Add optional traversal links." }],
      readSet: [],
    },
  });
  const quality = new MemImportQualityService(service);
  const policy = await quality.submitPolicy({
    ...run,
    policy: {
      reviewCheckpointId: "deferred-checkpoint",
      reviewedRevision: merged.revision,
      reviewedContentHash: merged.contentHash!,
      decisions: [{ actionId: "optional-links", disposition: "defer", rationale: "Defer optional enrichment to a later campaign." }],
      budget: { maxRepairEpisodes: 1, maxRepairTransactions: 1, maxChangedArtifacts: 1, maxCreatedArtifacts: 0, maxVerificationRounds: 1, maxEmergencyRepairs: 0, maxElapsedMinutes: 1 },
      rationale: "The ingest is correct without optional traversal enrichment.",
    },
  });
  assert.equal(policy.campaign, undefined);
  assert.equal((await quality.qualityState(run)).finalizationReadiness, "ready-with-deferred-findings");
  const finalLease = await canonical.acquireCoordinatorLease({ ...run, taskId: "deferred-finalize" });
  const final = await canonical.finalize({ ...run, taskId: "deferred-finalize", fence: finalLease.fence });
  assert.equal(final.finalized, true);
  await canonical.releaseCoordinatorLease({ ...run, taskId: "deferred-finalize", fence: finalLease.fence });
  const audit = JSON.parse(await readFile(join(output, "stages", "import-run.json"), "utf8")) as { status: string; quality?: { finalizationReadiness?: string } };
  assert.equal(audit.status, "finalized-with-deferred-findings");
  assert.equal(audit.quality?.finalizationReadiness, "ready-with-deferred-findings");
  assert.equal((await canonical.workStatus(run)).terminalStatus, "finalized-with-deferred-findings");
});

test("parent policy freezes approved actions and quality state exposes repair transition", async () => {
  const root = await mkdtemp(join(tmpdir(), "memchat-quality-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "one.html"), "<html><body><p>One.</p></body></html>");
  const service = new MemImportService();
  const run = await service.begin(output);
  await service.normalize({ ...run, input });
  const canonical = new MemImportCanonicalService(service);
  const lease = await canonical.acquireCoordinatorLease({ ...run, taskId: "seed" });
  await canonical.writeCoordinatorMerge({ ...run, taskId: "seed", fence: lease.fence, expectedRevision: 0, expectedContentHash: null, rationale: "seed", stage: { version: 1, kind: "merge", artifacts: [], candidateDispositions: [], diagnostics: [] } });
  await canonical.releaseCoordinatorLease({ ...run, taskId: "seed", fence: lease.fence });
  const reviewer = await service.assignWorker({ ...run, taskId: "review", role: "reviewer" });
  const state = await canonical.mergeState(run);
  await canonical.submitReview({ ...reviewer, packet: { version: 1, kind: "mem-import-review", checkpointId: "cp", reviewedMergeRevision: state.revision, reviewedMergeHash: state.contentHash!, findings: [], requestedActions: [{ id: "fix-one", type: "repair", severity: "repair", summary: "Fix one" }], readSet: [] } });
  const quality = new MemImportQualityService(service);
  const policy = await quality.submitPolicy({ ...run, policy: { reviewCheckpointId: "cp", reviewedRevision: state.revision, reviewedContentHash: state.contentHash!, decisions: [{ actionId: "fix-one", disposition: "approve", rationale: "Required", artifactScope: ["ada"], dependencyScope: [] }], budget: { maxRepairEpisodes: 1, maxRepairTransactions: 1, maxChangedArtifacts: 1, maxCreatedArtifacts: 0, maxVerificationRounds: 1, maxEmergencyRepairs: 0, maxElapsedMinutes: 1 }, rationale: "Bounded campaign" } });
  assert.ok(policy.campaign);

  // A fresh repair coordinator is launched without policy prose or a campaign
  // ID. It must discover the durable identity from the typed quality state,
  // then use that identity to read and bind the frozen campaign.
  const freshQuality = new MemImportQualityService(new MemImportService());
  const qualityState = await freshQuality.qualityState(run);
  assert.equal(qualityState.allowedNextTransition, "repair");
  assert.equal(qualityState.campaignId, policy.campaign!.id);
  const discoveredCampaign = await freshQuality.campaignState({ ...run, campaignId: qualityState.campaignId! });
  assert.deepEqual(discoveredCampaign.approvedActionIds, ["fix-one"]);

  const freshRepair = new MemImportService();
  const assignment = await freshRepair.assignWorker({
    ...run,
    taskId: "fresh-repair",
    role: "repairer",
    checkpointIds: [discoveredCampaign.reviewCheckpointId],
    actionIds: discoveredCampaign.approvedActionIds,
    repairCampaignId: qualityState.campaignId,
  });
  assert.equal(assignment.repairCampaignId, discoveredCampaign.id);
  await assert.rejects(freshQuality.assertCampaignScope({ ...run, campaignId: discoveredCampaign.id, actionIds: ["other"] }), /frozen campaign action set/);
});
