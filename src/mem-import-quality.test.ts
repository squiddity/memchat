import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
  const policy = await quality.submitPolicy({ ...run, policy: { reviewCheckpointId: "cp", reviewedRevision: state.revision, reviewedContentHash: state.contentHash!, decisions: [{ actionId: "fix-one", disposition: "approve", rationale: "Required" }], budget: { maxRepairEpisodes: 1, maxRepairTransactions: 1, maxChangedArtifacts: 1, maxCreatedArtifacts: 0, maxVerificationRounds: 1, maxEmergencyRepairs: 0, maxElapsedMinutes: 1 }, rationale: "Bounded campaign" } });
  assert.ok(policy.campaign);
  assert.deepEqual((await quality.campaignState({ ...run, campaignId: policy.campaign!.id })).approvedActionIds, ["fix-one"]);
  assert.equal((await quality.qualityState(run)).allowedNextTransition, "repair");
  await assert.rejects(quality.assertCampaignScope({ ...run, campaignId: policy.campaign!.id, actionIds: ["other"] }), /frozen campaign action set/);
});
