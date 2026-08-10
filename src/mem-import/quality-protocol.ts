import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageEnvelope } from "./contracts.js";

export const REVIEW_MODES = ["initial-shard", "second-opinion", "verification", "broad-audit"] as const;
export type ReviewMode = typeof REVIEW_MODES[number];
export type ReviewSeverity = "info" | "warning" | "repair" | "critical";
export type ReviewDisposition = "approve" | "defer" | "reject" | "split" | "request-second-opinion";

export type ReviewFindingV2 = {
  id: string;
  fingerprint: string;
  category: string;
  severity: ReviewSeverity;
  blocking: boolean;
  summary: string;
  artifactIds: string[];
  sourceRefs: unknown[];
  proposedAction?: {
    id: string;
    acceptanceCriteria: string[];
    artifactScope: string[];
    dependencyScope: string[];
    allowCreateArtifacts: boolean;
    rationale: string;
  };
};

export type ReviewPacketV2 = {
  version: 2;
  kind: "mem-import-review";
  mode: ReviewMode;
  checkpointId: string;
  reviewedMergeRevision: number;
  reviewedMergeHash: string;
  reviewPlanHash?: string;
  shardId?: string;
  campaignId?: string;
  actionIds?: string[];
  findings: ReviewFindingV2[];
  requestedActions: Array<{
    id: string;
    type: string;
    severity: ReviewSeverity;
    summary: string;
    rationale?: string;
    sourceRefs?: unknown[];
    acceptanceCriteria?: string[];
  }>;
  actionVerdicts?: Array<{
    actionId: string;
    verdict: "satisfied" | "partially-satisfied" | "regressed" | "impossible";
    evidenceRefs: unknown[];
    rationale: string;
  }>;
  readSet?: Array<{ artifactId: string; contentHash: string | null }>;
  diagnostics?: Array<{ level: "info" | "warning" | "error"; message: string }>;
  metadata?: Record<string, unknown>;
};

export type ReviewPolicyDecision = {
  version: 1;
  kind: "mem-import-review-policy";
  reviewCheckpointId: string;
  reviewedRevision: number;
  reviewedContentHash: string;
  decisions: Array<{ actionId: string; disposition: ReviewDisposition; rationale: string; artifactScope?: string[]; dependencyScope?: string[]; allowCreateArtifacts?: boolean }>;
  budget: RepairBudget;
  rationale: string;
};

export type RepairBudget = {
  maxRepairEpisodes: number;
  maxRepairTransactions: number;
  maxChangedArtifacts: number;
  maxCreatedArtifacts: number;
  maxVerificationRounds: number;
  maxEmergencyRepairs: number;
  maxElapsedMinutes: number;
};

export type RepairCampaign = {
  version: 1;
  kind: "mem-import-repair-campaign";
  id: string;
  reviewCheckpointId: string;
  policyHash: string;
  approvedActionIds: string[];
  baselineRevision: number;
  baselineContentHash: string | null;
  artifactScope: string[];
  dependencyScope: string[];
  allowCreateArtifacts: boolean;
  budget: RepairBudget;
  consumed: {
    repairEpisodes: number;
    repairTransactions: number;
    changedArtifacts: number;
    createdArtifacts: number;
    verificationRounds: number;
    emergencyRepairs: number;
  };
  actionStatus: Record<string, "approved" | "assigned" | "applied" | "satisfied" | "partially-satisfied" | "impossible">;
  createdAt: string;
};

export type VerificationPacket = {
  version: 1;
  kind: "mem-import-repair-verification";
  campaignId: string;
  verifiedRevision: number;
  verifiedContentHash: string;
  actionVerdicts: Array<{
    actionId: string;
    verdict: "satisfied" | "partially-satisfied" | "regressed" | "impossible";
    evidenceRefs: unknown[];
    rationale: string;
  }>;
  criticalRegressions?: Array<{ id: string; summary: string; artifactIds: string[]; evidenceRefs: unknown[] }>;
  deferredObservations?: ReviewFindingV2[];
  readSet: Array<{ artifactId: string; contentHash: string | null }>;
};

export type QualityState = {
  version: 1;
  kind: "mem-import-quality-state";
  revision: number;
  contentHash: string | null;
  checkpointId?: string;
  policyHash?: string;
  campaignId?: string;
  actionStatuses: Record<string, string>;
  deferredFindingIds: string[];
  blockingFindingIds: string[];
  allowedNextTransition: "policy" | "repair" | "verification" | "finalize" | "blocked-critical" | "non-convergent-review" | "budget-exhausted";
  finalizationReadiness: "ready" | "ready-with-deferred-findings" | "blocked-critical" | "blocked-repair" | "non-convergent-review" | "budget-exhausted";
};

export const DEFAULT_REPAIR_BUDGET: RepairBudget = {
  maxRepairEpisodes: 1,
  maxRepairTransactions: 12,
  maxChangedArtifacts: 64,
  maxCreatedArtifacts: 12,
  maxVerificationRounds: 1,
  maxEmergencyRepairs: 0,
  maxElapsedMinutes: 60,
};

export function qualityHash(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input)
    ? input.map(canonical)
    : input && typeof input === "object"
      ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
      : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function qualityRoot(outputRoot: string): string { return join(outputRoot, "stages", "quality"); }
export function policyPath(outputRoot: string, hash: string): string { return join(qualityRoot(outputRoot), "review-policies", `${hash}.json`); }
export function campaignPath(outputRoot: string, id: string): string { return join(qualityRoot(outputRoot), "repair-campaigns", `${id}.json`); }
export function verificationPath(outputRoot: string, campaignId: string, hash: string): string { return join(qualityRoot(outputRoot), "verifications", `${campaignId}-${hash}.json`); }

export function assertBudget(value: RepairBudget): void {
  for (const [key, item] of Object.entries(value)) if (!Number.isSafeInteger(item) || item < 0) throw new Error(`budget.${key} must be a non-negative safe integer`);
  if (value.maxRepairEpisodes > 1) throw new Error("Repair campaigns are limited to one repair episode");
  if (value.maxVerificationRounds > 1) throw new Error("Repair campaigns are limited to one verification round");
}

export function validateModePacket(packet: ReviewPacketV2): void {
  if (packet.version !== 2 || packet.kind !== "mem-import-review") throw new Error("Review packet must be version 2 mem-import-review");
  if (!REVIEW_MODES.includes(packet.mode)) throw new Error("Unknown review mode");
  if (!Number.isSafeInteger(packet.reviewedMergeRevision) || packet.reviewedMergeRevision < 1) throw new Error("reviewedMergeRevision must be positive");
  if (!/^[a-f0-9]{64}$/.test(packet.reviewedMergeHash)) throw new Error("reviewedMergeHash must be a SHA-256 hex string");
  if (!Array.isArray(packet.findings) || !Array.isArray(packet.requestedActions)) throw new Error("findings and requestedActions must be arrays");
  if (!Array.isArray(packet.readSet) || packet.readSet.length > 100) throw new Error("v2 review packets require a bounded readSet");
  if (packet.mode === "verification") {
    if (!packet.campaignId || !Array.isArray(packet.actionIds) || packet.actionIds.length === 0 || !Array.isArray(packet.actionVerdicts)) throw new Error("verification packets require campaignId, actionIds, and actionVerdicts");
    if (packet.findings.length > 0 || packet.requestedActions.length > 0) throw new Error("verification packets cannot create ordinary findings or actions");
    const ids = new Set(packet.actionIds);
    if (packet.actionVerdicts.some((item) => !ids.has(item.actionId))) throw new Error("verification verdict is outside exact actionIds");
  } else if (packet.actionVerdicts !== undefined || packet.campaignId !== undefined || packet.actionIds !== undefined) {
    throw new Error("non-verification packets cannot carry verification fields");
  }
}

export function findingActionIds(packet: { findings?: Array<{ requestedActionIds?: string[]; proposedAction?: { id: string } }>; requestedActions?: Array<{ id: string }> }): string[] {
  return [...new Set([
    ...(packet.requestedActions ?? []).map((item) => item.id),
    ...(packet.findings ?? []).flatMap((item) => [...(item.requestedActionIds ?? []), ...(item.proposedAction ? [item.proposedAction.id] : [])]),
  ])].sort();
}

type LoosePacket = { version?: unknown; kind?: unknown; checkpointId?: unknown; reviewedMergeRevision?: unknown; reviewedMergeHash?: unknown; findings?: unknown; requestedActions?: unknown; mode?: unknown; actionVerdicts?: unknown; campaignId?: unknown; actionIds?: unknown };

async function readReviewPackets(outputRoot: string): Promise<LoosePacket[]> {
  const root = join(outputRoot, "stages", "reviews");
  const packets: LoosePacket[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "validity.json") {
        try { const value = JSON.parse(await readFile(path, "utf8")) as LoosePacket; if (value.kind === "mem-import-review") packets.push(value); } catch { /* malformed historical records are ignored by readiness */ }
      }
    }
  };
  await visit(root);
  return packets;
}

export async function readQualityReadiness(outputRoot: string, stage: StageEnvelope): Promise<QualityState> {
  const packets = await readReviewPackets(outputRoot);
  const policiesRoot = join(qualityRoot(outputRoot), "review-policies");
  const policies: Array<ReviewPolicyDecision & { policyHash: string }> = [];
  if (existsSync(policiesRoot)) for (const name of await readdir(policiesRoot)) {
    if (!name.endsWith(".json")) continue;
    try {
      const value = JSON.parse(await readFile(join(policiesRoot, name), "utf8")) as ReviewPolicyDecision;
      if (value.version === 1 && value.kind === "mem-import-review-policy") policies.push({ ...value, policyHash: name.slice(0, -5) });
    } catch { /* ignore malformed quality records */ }
  }
  const policy = policies.sort((a, b) => a.policyHash.localeCompare(b.policyHash)).at(-1);
  const campaignsRoot = join(qualityRoot(outputRoot), "repair-campaigns");
  const campaigns: RepairCampaign[] = [];
  if (existsSync(campaignsRoot)) for (const name of await readdir(campaignsRoot)) {
    if (!name.endsWith(".json")) continue;
    try { const value = JSON.parse(await readFile(join(campaignsRoot, name), "utf8")) as RepairCampaign; if (value.version === 1 && value.kind === "mem-import-repair-campaign") campaigns.push(value); } catch { /* malformed campaigns cannot authorize a transition */ }
  }
  const campaign = campaigns.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
  const actionStatuses: Record<string, string> = campaign?.actionStatus ? { ...campaign.actionStatus } : {};
  const deferredFindingIds: string[] = [];
  const blockingFindingIds: string[] = [];
  const currentPackets = packets.filter((packet) => packet.reviewedMergeRevision === stage.revision && packet.reviewedMergeHash === stage.contentHash);
  const decisions = new Map(policy?.decisions.map((decision) => [decision.actionId, decision]) ?? []);
  for (const packet of currentPackets) {
    const findings = Array.isArray(packet.findings) ? packet.findings as Array<Record<string, unknown>> : [];
    for (const finding of findings) {
      const id = typeof finding.id === "string" ? finding.id : "unknown";
      const severity = finding.severity;
      const blocking = finding.blocking === true || severity === "critical";
      const actionId = typeof (finding.proposedAction as Record<string, unknown> | undefined)?.id === "string"
        ? String((finding.proposedAction as Record<string, unknown>).id)
        : id;
      const decision = decisions.get(actionId);
      const campaignStatus = campaign?.actionStatus[actionId];
      if ((decision?.disposition === "defer" || decision?.disposition === "reject") && !blocking) {
        if (decision.disposition === "defer") deferredFindingIds.push(id);
      } else if (campaignStatus === "satisfied") { /* approved action is verified */ }
      else if (blocking || severity === "repair" || severity === "critical") blockingFindingIds.push(id);
    }
    const requested = Array.isArray(packet.requestedActions) ? packet.requestedActions as Array<Record<string, unknown>> : [];
    for (const action of requested) {
      const id = typeof action.id === "string" ? action.id : "unknown";
      const decision = decisions.get(id);
      if (decision && !campaign?.actionStatus[id]) actionStatuses[id] = decision.disposition;
      if ((decision?.disposition === "defer" || decision?.disposition === "reject") && action.severity !== "critical") {
        if (decision.disposition === "defer") deferredFindingIds.push(id);
      } else if (campaign?.actionStatus[id] === "satisfied") { /* approved action is verified */ }
      else if (action.severity === "repair" || action.severity === "critical") blockingFindingIds.push(id);
    }
  }
  const uniqueBlocking = [...new Set(blockingFindingIds)];
  const uniqueDeferred = [...new Set(deferredFindingIds)];
  const hasCritical = currentPackets.some((packet) => (packet.findings as Array<{ severity?: string; id?: string }> ?? []).some((finding) => finding.severity === "critical" && campaign?.actionStatus[finding.id ?? ""] !== "satisfied"));
  const budgetExhausted = campaign ? campaign.consumed.repairTransactions > campaign.budget.maxRepairTransactions || campaign.consumed.verificationRounds > campaign.budget.maxVerificationRounds : false;
  const nonConvergent = campaign ? Object.values(campaign.actionStatus).some((status) => status === "partially-satisfied" || status === "impossible") && campaign.consumed.verificationRounds >= campaign.budget.maxVerificationRounds : false;
  const staleCampaign = Boolean(campaign && campaign.consumed.repairTransactions > 0 && currentPackets.length === 0);
  const noCurrentReview = currentPackets.length === 0;
  const readiness = budgetExhausted ? "budget-exhausted" : nonConvergent ? "non-convergent-review" : hasCritical ? "blocked-critical" : noCurrentReview || staleCampaign || uniqueBlocking.length > 0 ? "blocked-repair" : uniqueDeferred.length > 0 ? "ready-with-deferred-findings" : "ready";
  return {
    version: 1,
    kind: "mem-import-quality-state",
    revision: stage.revision ?? 0,
    contentHash: stage.contentHash ?? null,
    ...(policy ? { policyHash: policy.policyHash, checkpointId: policy.reviewCheckpointId } : {}),
    ...(campaign ? { campaignId: campaign.id } : {}),
    actionStatuses,
    deferredFindingIds: uniqueDeferred,
    blockingFindingIds: uniqueBlocking,
    allowedNextTransition: readiness === "ready" || readiness === "ready-with-deferred-findings" ? "finalize" : readiness === "budget-exhausted" ? "budget-exhausted" : readiness === "non-convergent-review" ? "non-convergent-review" : hasCritical ? "blocked-critical" : campaign ? (campaign.consumed.repairTransactions === 0 ? "repair" : "verification") : "policy",
    finalizationReadiness: readiness,
  };
}
