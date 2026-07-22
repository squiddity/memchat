import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  materializeAcceptanceProbe,
  releaseAcceptanceProbeLease,
  type AcceptanceProbe,
} from "./acceptance-materializer.js";
import {
  MemImportAcceptanceService,
  type AcceptanceProfile,
  type AcceptanceReceipt,
  type HostProbeEvidence,
} from "./acceptance-service.js";
import type { AssignmentBoundAcceptanceHost } from "./pi-sdk-acceptance-adapter.js";
import { MemImportService } from "./service.js";
import { MemImportU2Service } from "./u2-service.js";

export const CORE_ACCEPTANCE_PROBES = ["normalize", "extractor", "proposer", "merger", "reviewer"] as const satisfies readonly AcceptanceProbe[];
export const ALL_ACCEPTANCE_PROBES = ["normalize", "extractor", "proposer", "reconciler", "merger", "reviewer", "repairer"] as const satisfies readonly AcceptanceProbe[];

export type FocusedAcceptanceResult = {
  receiptPath: string;
  receipt: AcceptanceReceipt;
  probes: Array<{ probe: AcceptanceProbe; hostTaskId?: string; effectKind?: string; effectHash?: string }>;
};

export async function runFocusedAcceptance(options: {
  fixtureRoot: string;
  stateRoot?: string;
  disposableRoot?: string;
  profile: Omit<AcceptanceProfile, "adapter" | "runtime">;
  host: AssignmentBoundAcceptanceHost;
  probes?: AcceptanceProbe[];
  requiredProbes?: AcceptanceProbe[];
}): Promise<FocusedAcceptanceResult> {
  const fixtureRoot = resolve(options.fixtureRoot);
  const disposableRoot = resolve(options.disposableRoot ?? await mkdtemp(join(tmpdir(), "memchat-focused-acceptance-")));
  const probes = options.probes ?? [...CORE_ACCEPTANCE_PROBES];
  if (probes.length === 0 || new Set(probes).size !== probes.length) throw new Error("Focused acceptance probes must be a non-empty unique list");
  const requiredProbes = options.requiredProbes ?? probes;
  if (requiredProbes.length === 0 || new Set(requiredProbes).size !== requiredProbes.length) throw new Error("Focused acceptance requiredProbes must be a non-empty unique list");
  const profile: AcceptanceProfile = { ...options.profile, adapter: options.host.adapter, runtime: options.host.runtime };
  const summaries: FocusedAcceptanceResult["probes"] = [];
  let latest: Awaited<ReturnType<MemImportAcceptanceService["persistProbe"]>> | undefined;
  for (const probe of probes) {
    const outputRoot = join(disposableRoot, `${String(probes.indexOf(probe) + 1).padStart(2, "0")}-${probe}`, "output");
    const base = new MemImportService();
    const canonical = new MemImportU2Service(base);
    const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot, probe, services: { base, canonical } });
    let evidence: HostProbeEvidence;
    try {
      if (probe === "normalize") {
        await base.normalize(prepared.call as Parameters<MemImportService["normalize"]>[0]);
        evidence = { facility: "coordinator-direct", requestedTools: prepared.assignmentTools, observedTools: prepared.assignmentTools, toolCalls: [prepared.targetTool], outcome: "completed" };
      } else {
        evidence = await options.host.launch(prepared, { model: profile.model, thinking: profile.thinking });
        if (evidence.facility !== "ordinary-subagent" || !evidence.hostTaskId) throw new Error(`Acceptance host returned invalid semantic lifecycle evidence for ${probe}`);
        await base.recordWorkerDispatch({
          outputRoot: prepared.outputRoot,
          runId: prepared.runId,
          coordinatorGrant: prepared.coordinatorGrant,
          taskId: prepared.assignment!.taskId,
          facility: evidence.facility,
          hostTaskId: evidence.hostTaskId,
          requestedTools: evidence.requestedTools,
          observedTools: evidence.observedTools,
          outcome: evidence.outcome,
          requestedModel: profile.model,
          observedModel: evidence.observedModel,
          requestedThinking: profile.thinking,
          observedThinking: evidence.observedThinking,
        });
      }
      latest = await new MemImportAcceptanceService(base).persistProbe({
        stateRoot: options.stateRoot,
        profile,
        prepared,
        evidence,
        requiredProbes,
      });
      const effect = latest.receipt.probes[probe]?.effect;
      summaries.push({ probe, ...(evidence.hostTaskId ? { hostTaskId: evidence.hostTaskId } : {}), ...(effect ? { effectKind: effect.kind, effectHash: effect.contentHash } : {}) });
    } finally {
      await releaseAcceptanceProbeLease(prepared, canonical);
    }
  }
  if (!latest) throw new Error("Focused acceptance produced no receipt");
  return { receiptPath: latest.path, receipt: latest.receipt, probes: summaries };
}
