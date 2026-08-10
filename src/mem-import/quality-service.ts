import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemImportCanonicalService } from "./canonical-service.js";
import { MemImportService } from "./service.js";
import {
  DEFAULT_REPAIR_BUDGET,
  assertBudget,
  campaignPath,
  findingActionIds,
  policyPath,
  qualityHash,
  qualityRoot,
  readQualityReadiness,
  validateModePacket,
  verificationPath,
  type RepairBudget,
  type RepairCampaign,
  type ReviewPacketV2,
  type ReviewPolicyDecision,
  type VerificationPacket,
} from "./quality-protocol.js";
import { writeJson } from "./stage-store.js";
import type { StageEnvelope } from "./contracts.js";

type CoordinatorAuthority = { outputRoot: string; runId: string; coordinatorGrant: string };

type StoredReview = {
  version?: unknown;
  kind?: unknown;
  checkpointId?: unknown;
  reviewedMergeRevision?: unknown;
  reviewedMergeHash?: unknown;
  findings?: unknown;
  requestedActions?: unknown;
};

function assertId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens`);
}
function qualityDir(outputRoot: string, name: string): string { return join(qualityRoot(outputRoot), name); }

async function reviewPackets(outputRoot: string): Promise<StoredReview[]> {
  const root = join(outputRoot, "stages", "reviews");
  const packets: StoredReview[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "validity.json") {
        try { const packet = JSON.parse(await readFile(path, "utf8")) as StoredReview; if (packet.kind === "mem-import-review") packets.push(packet); } catch { /* malformed records are not known actions */ }
      }
    }
  };
  await visit(root);
  return packets;
}

function policyBudget(value: Partial<RepairBudget> | undefined): RepairBudget {
  const budget = { ...DEFAULT_REPAIR_BUDGET, ...(value ?? {}) };
  assertBudget(budget);
  return budget;
}

export class MemImportQualityService {
  private readonly canonical: MemImportCanonicalService;
  constructor(private readonly base: MemImportService, now?: () => Date) {
    this.canonical = new MemImportCanonicalService(base, now);
  }

  /** Parent-only durable checkpoint policy. It cannot mutate canonical state. */
  async submitPolicy(options: CoordinatorAuthority & { policy: Omit<ReviewPolicyDecision, "version" | "kind"> }): Promise<{ policyHash: string; campaign?: RepairCampaign }> {
    return this.base.withRunMutation(options.outputRoot, async () => {
      const run = await this.base.authorizeCoordinatorMutation(options);
      const state = await this.canonical.mergeState(options);
      const policy = options.policy;
      assertId(policy.reviewCheckpointId, "reviewCheckpointId");
      if (policy.reviewedRevision !== state.revision) throw new Error("Review policy is stale: reviewed revision does not match canonical state");
      if (!state.contentHash || policy.reviewedContentHash !== state.contentHash) throw new Error("Review policy is stale: reviewed content hash does not match canonical state");
      const packets = await reviewPackets(run.outputRoot);
      const checkpointPackets = packets.filter((packet) => packet.checkpointId === policy.reviewCheckpointId && packet.reviewedMergeRevision === policy.reviewedRevision && packet.reviewedMergeHash === policy.reviewedContentHash);
      if (checkpointPackets.length === 0) throw new Error("Review policy references an unknown or stale checkpoint");
      const known = new Set(checkpointPackets.flatMap((packet) => findingActionIds({ findings: Array.isArray(packet.findings) ? packet.findings as any[] : [], requestedActions: Array.isArray(packet.requestedActions) ? packet.requestedActions as any[] : [] })));
      const seen = new Set<string>();
      for (const decision of policy.decisions) {
        assertId(decision.actionId, "decision.actionId");
        if (!known.has(decision.actionId)) throw new Error(`Review policy action ${decision.actionId} is not present in checkpoint`);
        if (seen.has(decision.actionId)) throw new Error(`Review policy action ${decision.actionId} is duplicated`);
        seen.add(decision.actionId);
        if (!decision.rationale.trim()) throw new Error("Review policy decisions require rationale");
      }
      const normalized: ReviewPolicyDecision = {
        version: 1,
        kind: "mem-import-review-policy",
        reviewCheckpointId: policy.reviewCheckpointId,
        reviewedRevision: policy.reviewedRevision,
        reviewedContentHash: policy.reviewedContentHash,
        decisions: [...policy.decisions].sort((a, b) => a.actionId.localeCompare(b.actionId)),
        budget: policyBudget(policy.budget),
        rationale: policy.rationale,
      };
      const policyHash = qualityHash(normalized);
      const path = policyPath(run.outputRoot, policyHash);
      await mkdir(join(qualityRoot(run.outputRoot), "review-policies"), { recursive: true });
      if (!existsSync(path)) await writeJson(path, { ...normalized, runId: run.runId, createdAt: new Date().toISOString() });
      const approved = normalized.decisions.filter((decision) => decision.disposition === "approve");
      for (const decision of approved) {
        if (!decision.artifactScope || decision.artifactScope.length === 0) throw new Error(`Approved repair action ${decision.actionId} requires a non-empty artifactScope`);
        if (decision.dependencyScope === undefined) throw new Error(`Approved repair action ${decision.actionId} requires an explicit dependencyScope`);
      }
      if (approved.length === 0) return { policyHash };
      const campaignId = `campaign-${policyHash.slice(0, 24)}`;
      const campaign: RepairCampaign = {
        version: 1,
        kind: "mem-import-repair-campaign",
        id: campaignId,
        reviewCheckpointId: normalized.reviewCheckpointId,
        policyHash,
        approvedActionIds: approved.map((decision) => decision.actionId),
        baselineRevision: normalized.reviewedRevision,
        baselineContentHash: normalized.reviewedContentHash,
        artifactScope: [...new Set(approved.flatMap((decision) => decision.artifactScope ?? []))].sort(),
        dependencyScope: [...new Set(approved.flatMap((decision) => decision.dependencyScope ?? []))].sort(),
        allowCreateArtifacts: approved.some((decision) => decision.allowCreateArtifacts === true),
        budget: normalized.budget,
        consumed: { repairEpisodes: 0, repairTransactions: 0, changedArtifacts: 0, createdArtifacts: 0, verificationRounds: 0, emergencyRepairs: 0 },
        actionStatus: Object.fromEntries(approved.map((decision) => [decision.actionId, "approved"])),
        createdAt: new Date().toISOString(),
      };
      const campaignFile = campaignPath(run.outputRoot, campaignId);
      await mkdir(qualityDir(run.outputRoot, "repair-campaigns"), { recursive: true });
      if (existsSync(campaignFile)) {
        const existing = JSON.parse(await readFile(campaignFile, "utf8")) as RepairCampaign;
        if (qualityHash({ ...existing, runId: undefined, createdAt: undefined }) !== qualityHash({ ...campaign, runId: undefined, createdAt: undefined })) throw new Error("Repair campaign already exists with different immutable scope or budget");
      } else await writeJson(campaignFile, { ...campaign, runId: run.runId });
      return { policyHash, campaign };
    });
  }

  async checkpointState(options: CoordinatorAuthority & { checkpointId: string }): Promise<{ checkpointId: string; revision: number; contentHash: string; actionIds: string[]; packetCount: number }> {
    const run = await this.base.authorizeCoordinator(options);
    const packets = (await reviewPackets(run.outputRoot)).filter((packet) => packet.checkpointId === options.checkpointId);
    if (packets.length === 0) throw new Error("Unknown review checkpoint");
    const packet = packets.at(-1)!;
    if (typeof packet.reviewedMergeRevision !== "number" || typeof packet.reviewedMergeHash !== "string") throw new Error("Review checkpoint is malformed");
    const actionIds = [...new Set(packets.flatMap((item) => findingActionIds({ findings: Array.isArray(item.findings) ? item.findings as any[] : [], requestedActions: Array.isArray(item.requestedActions) ? item.requestedActions as any[] : [] })))] .sort();
    return { checkpointId: options.checkpointId, revision: packet.reviewedMergeRevision, contentHash: packet.reviewedMergeHash, actionIds, packetCount: packets.length };
  }

  async policyState(options: CoordinatorAuthority & { policyHash: string }): Promise<ReviewPolicyDecision> {
    await this.base.authorizeCoordinator(options);
    const path = policyPath(options.outputRoot, options.policyHash);
    if (!existsSync(path)) throw new Error("Unknown review policy");
    return JSON.parse(await readFile(path, "utf8")) as ReviewPolicyDecision;
  }

  async campaignState(options: CoordinatorAuthority & { campaignId: string }): Promise<RepairCampaign> {
    await this.base.authorizeCoordinator(options);
    assertId(options.campaignId, "campaignId");
    const path = campaignPath(options.outputRoot, options.campaignId);
    if (!existsSync(path)) throw new Error("Unknown repair campaign");
    const campaign = JSON.parse(await readFile(path, "utf8")) as RepairCampaign;
    if (campaign.version !== 1 || campaign.kind !== "mem-import-repair-campaign") throw new Error("Invalid repair campaign");
    return campaign;
  }

  async submitVerification(options: CoordinatorAuthority & { packet: VerificationPacket }): Promise<{ verificationHash: string; path: string }> {
    return this.base.withRunMutation(options.outputRoot, async () => {
      const run = await this.base.authorizeCoordinatorMutation(options);
      const campaign = await this.campaignState({ ...options, campaignId: options.packet.campaignId });
      const state = await this.canonical.mergeState(options);
      const packet = options.packet;
      if (packet.version !== 1 || packet.kind !== "mem-import-repair-verification" || packet.campaignId !== campaign.id) throw new Error("Verification packet is not bound to this campaign");
      if (packet.verifiedRevision !== state.revision || packet.verifiedContentHash !== state.contentHash) throw new Error("Verification packet is stale");
      const expected = new Set(campaign.approvedActionIds);
      const provided = new Set(packet.actionVerdicts.map((item) => item.actionId));
      if (provided.size !== expected.size || [...expected].some((id) => !provided.has(id))) throw new Error("Verification must judge exactly the approved campaign action IDs");
      if (packet.actionVerdicts.some((item) => !expected.has(item.actionId))) throw new Error("Verification action is outside campaign scope");
      if (!Array.isArray(packet.readSet) || packet.readSet.some((item) => !item || typeof item.artifactId !== "string")) throw new Error("Verification readSet is invalid");
      const artifactMap = new Map((state.stage.artifacts ?? []).map((artifact) => [artifact.id, qualityHash(artifact)]));
      for (const item of packet.readSet) if ((artifactMap.get(item.artifactId) ?? null) !== item.contentHash) throw new Error(`Verification readSet is stale for ${item.artifactId}`);
      if (campaign.consumed.verificationRounds >= campaign.budget.maxVerificationRounds) throw new Error("Verification budget exhausted");
      const verificationHash = qualityHash(packet);
      const path = verificationPath(run.outputRoot, campaign.id, verificationHash);
      await mkdir(qualityDir(run.outputRoot, "verifications"), { recursive: true });
      if (existsSync(path)) return { verificationHash, path: path.slice(run.outputRoot.length + 1) };
      await writeJson(path, { ...packet, runId: run.runId, submittedAt: new Date().toISOString() });
      const next: RepairCampaign = {
        ...campaign,
        consumed: { ...campaign.consumed, verificationRounds: campaign.consumed.verificationRounds + 1 },
        actionStatus: Object.fromEntries(packet.actionVerdicts.map((item) => [item.actionId, item.verdict === "satisfied" ? "satisfied" : item.verdict === "impossible" ? "impossible" : "partially-satisfied"])) as RepairCampaign["actionStatus"],
      };
      if (next.consumed.verificationRounds > next.budget.maxVerificationRounds) throw new Error("Verification budget exhausted");
      await writeJson(campaignPath(run.outputRoot, campaign.id), next);
      return { verificationHash, path: path.slice(run.outputRoot.length + 1) };
    });
  }

  async qualityState(options: CoordinatorAuthority): Promise<ReturnType<typeof readQualityReadiness>> {
    const run = await this.base.authorizeCoordinator(options);
    const state = await this.canonical.mergeState(options);
    return readQualityReadiness(run.outputRoot, state.stage);
  }

  /** Read-only structural guard used by finalization and tests. */
  async assertCampaignScope(options: CoordinatorAuthority & { campaignId: string; actionIds: string[] }): Promise<RepairCampaign> {
    const campaign = await this.campaignState(options);
    const requested = [...new Set(options.actionIds)].sort();
    if (requested.length !== campaign.approvedActionIds.length || requested.some((id, index) => id !== [...campaign.approvedActionIds].sort()[index])) throw new Error("Requested repair action scope does not equal the frozen campaign action set");
    return campaign;
  }
}