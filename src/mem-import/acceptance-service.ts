import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalHash } from "./identity-service.js";
import { type AcceptanceProbe, type PreparedAcceptanceProbe } from "./acceptance-materializer.js";
import { MemImportService } from "./service.js";
import { writeJson } from "../world-import/staging.js";

export type AcceptanceProfile = {
  protocolVersion: number;
  toolSchemaVersion: string;
  adapter: string;
  runtime: string;
  model: string;
  thinking: string;
  sourceRevision: string;
};

export type HostProbeEvidence = {
  facility: "ordinary-subagent" | "coordinator-direct";
  hostTaskId?: string;
  requestedTools: string[];
  observedTools: string[];
  toolCalls: string[];
  outcome: "completed" | "failed" | "cancelled";
};

export type AcceptanceProbeReceipt = {
  probe: AcceptanceProbe;
  status: "accepted";
  fixtureId: string;
  fixtureHash: string;
  runId: string;
  taskId?: string;
  targetTool: string;
  assignmentToolsHash: string;
  observedToolsHash: string;
  hostTaskId?: string;
  effect?: { kind: string; contentHash: string };
  completedAt: string;
};

export type AcceptanceReceipt = {
  version: 1;
  kind: "mem-import-acceptance";
  fingerprint: string;
  profile: AcceptanceProfile & { fixtureHash: string };
  status: "accepted" | "partial";
  probes: Partial<Record<AcceptanceProbe, AcceptanceProbeReceipt>>;
  updatedAt: string;
};

function sameTools(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}

function requireSafeText(value: string, label: string): void {
  if (!value.trim() || /[\r\n]/.test(value)) throw new Error(`${label} must be a non-empty single-line string`);
}

export function acceptanceFingerprint(profile: AcceptanceProfile, fixtureHash: string): string {
  for (const [key, value] of Object.entries(profile)) requireSafeText(String(value), `profile.${key}`);
  if (!/^[a-f0-9]{64}$/.test(fixtureHash)) throw new Error("fixtureHash must be a SHA-256 hash");
  return canonicalHash({ version: 1, ...profile, fixtureHash });
}

export function defaultAcceptanceStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const stateHome = env.XDG_STATE_HOME?.trim() ? resolve(env.XDG_STATE_HOME) : join(homedir(), ".local", "state");
  return join(stateHome, "memchat", "mem-import", "acceptance");
}

export function buildAssignmentBoundProbeLaunch(prepared: PreparedAcceptanceProbe, model: string, thinking: string): {
  taskId: string;
  tools: string[];
  model: string;
  thinking: string;
  task: string;
} {
  if (!prepared.assignment) throw new Error("Normalization is coordinator-owned and does not use an ordinary-subagent launch");
  requireSafeText(model, "model");
  requireSafeText(thinking, "thinking");
  return {
    taskId: prepared.assignment.taskId,
    tools: [...prepared.assignmentTools],
    model,
    thinking,
    task: [
      `Acceptance probe ${prepared.probe}.`,
      `Call ${prepared.targetTool} exactly once with this JSON body, then stop:`,
      JSON.stringify(prepared.call),
      "Do not call any other tool and do not retry.",
    ].join("\n"),
  };
}

export class MemImportAcceptanceService {
  constructor(private readonly base = new MemImportService(), private readonly now: () => Date = () => new Date()) {}

  async validateProbe(prepared: PreparedAcceptanceProbe, evidence: HostProbeEvidence): Promise<AcceptanceProbeReceipt> {
    if (evidence.outcome !== "completed") throw new Error(`Acceptance probe ended ${evidence.outcome}`);
    if (evidence.toolCalls.length !== 1 || evidence.toolCalls[0] !== prepared.targetTool) throw new Error(`Acceptance probe must call ${prepared.targetTool} exactly once`);
    if (!sameTools(evidence.requestedTools, prepared.assignmentTools) || !sameTools(evidence.observedTools, prepared.assignmentTools)) throw new Error("Acceptance probe host tools do not exactly match the prepared assignment");
    const common = {
      probe: prepared.probe,
      status: "accepted" as const,
      fixtureId: prepared.fixtureId,
      fixtureHash: prepared.fixtureHash,
      runId: prepared.runId,
      targetTool: prepared.targetTool,
      assignmentToolsHash: canonicalHash([...prepared.assignmentTools].sort()),
      observedToolsHash: canonicalHash([...evidence.observedTools].sort()),
      completedAt: this.now().toISOString(),
    };
    if (prepared.probe === "normalize") {
      if (evidence.facility !== "coordinator-direct") throw new Error("Normalization acceptance must be coordinator-direct");
      const status = await this.base.status({ outputRoot: prepared.outputRoot, runId: prepared.runId, coordinatorGrant: prepared.coordinatorGrant });
      if (!status.normalized || status.unitCount !== prepared.expected.unitCount) throw new Error("Normalization acceptance effect does not match the fixture expectation");
      return common;
    }
    if (evidence.facility !== "ordinary-subagent" || !evidence.hostTaskId) throw new Error("Semantic acceptance requires an ordinary-subagent host identity");
    const assignment = prepared.assignment;
    if (!assignment) throw new Error("Semantic acceptance probe is missing its live assignment");
    requireSafeText(evidence.hostTaskId, "hostTaskId");
    const inventory = [] as Awaited<ReturnType<MemImportService["effectInventory"]>>["entries"]; 
    let continuationCursor: string | undefined;
    do {
      const page = await this.base.effectInventory({
        outputRoot: prepared.outputRoot,
        runId: prepared.runId,
        coordinatorGrant: prepared.coordinatorGrant,
        maxItems: 20,
        ...(continuationCursor ? { continuationCursor } : {}),
      });
      inventory.push(...page.entries);
      continuationCursor = page.continuationCursor;
    } while (continuationCursor);
    const targetEntries = inventory.filter((entry) => entry.taskId === assignment.taskId && entry.effect);
    const effects = targetEntries.map((entry) => entry.effect!);
    if (effects.length !== 1) throw new Error(`Acceptance probe task must have exactly one durable effect; found ${effects.length}`);
    const dispatch = targetEntries[0]!.dispatch;
    if (!dispatch || dispatch.facility !== "ordinary-subagent" || dispatch.outcome !== "completed" || !dispatch.exactToolMatch || dispatch.hostTaskId !== evidence.hostTaskId) throw new Error("Acceptance probe durable dispatch does not match authoritative host evidence");
    const expectedKind = prepared.expected.kind;
    if (typeof expectedKind !== "string" || effects[0]!.kind !== expectedKind) throw new Error(`Acceptance probe effect kind ${effects[0]!.kind} does not match expected ${String(expectedKind)}`);
    return { ...common, taskId: assignment.taskId, hostTaskId: evidence.hostTaskId, effect: effects[0] };
  }

  async persistProbe(options: {
    stateRoot?: string;
    profile: AcceptanceProfile;
    prepared: PreparedAcceptanceProbe;
    evidence: HostProbeEvidence;
    requiredProbes?: AcceptanceProbe[];
  }): Promise<{ path: string; receipt: AcceptanceReceipt }> {
    const probe = await this.validateProbe(options.prepared, options.evidence);
    const fingerprint = acceptanceFingerprint(options.profile, options.prepared.fixtureHash);
    const stateRoot = resolve(options.stateRoot ?? defaultAcceptanceStateRoot());
    const path = join(stateRoot, `${fingerprint}.json`);
    let prior: AcceptanceReceipt | undefined;
    try {
      const { readFile } = await import("node:fs/promises");
      prior = JSON.parse(await readFile(path, "utf-8")) as AcceptanceReceipt;
    } catch {
      prior = undefined;
    }
    if (prior && (prior.version !== 1 || prior.kind !== "mem-import-acceptance" || prior.fingerprint !== fingerprint)) throw new Error("Existing acceptance receipt does not match its fingerprint");
    const probes = { ...(prior?.probes ?? {}), [probe.probe]: probe };
    const required = options.requiredProbes ?? ["normalize", "extractor", "proposer", "merger", "reviewer"];
    const receipt: AcceptanceReceipt = {
      version: 1,
      kind: "mem-import-acceptance",
      fingerprint,
      profile: { ...options.profile, fixtureHash: options.prepared.fixtureHash },
      status: required.every((name) => probes[name]?.status === "accepted") ? "accepted" : "partial",
      probes,
      updatedAt: this.now().toISOString(),
    };
    await writeJson(path, receipt);
    return { path, receipt };
  }
}
