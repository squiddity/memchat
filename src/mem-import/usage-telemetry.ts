import type { AssignmentRole } from "./service.js";

export type MemImportUsagePhase = "extraction" | "proposal-reconciliation" | "merge" | "review-finalization";
export type MemImportUsageUnavailableReason =
  | "adapter-unavailable"
  | "host-result-missing"
  | "invalid-telemetry-record"
  | "sidecar-missing"
  | "sidecar-invalid"
  | "sidecar-stale"
  | "sidecar-unmatched";

export type MemImportUsageCost = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  total: number | null;
};

export type MemImportUsageTotals = {
  version: 1;
  sessions: number;
  turns: number;
  responses: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  cost: MemImportUsageCost;
};

export type MemImportAggregatedUsageTotals = Omit<MemImportUsageTotals, "sessions" | "turns" | "responses"> & {
  sessions: number | null;
  turns: number | null;
  responses: number | null;
};

export type MemImportModelUsage = Omit<MemImportUsageTotals, "sessions" | "turns"> & {
  provider: string;
  model: string;
};

export type MemImportUsageEvidence =
  | {
    version: 1;
    status: "available";
    source: "subagent-result" | "pi-herdr-activity-sidecar";
    usage: MemImportUsageTotals;
    usageByModel: MemImportModelUsage[];
  }
  | {
    version: 1;
    status: "unavailable";
    reason: MemImportUsageUnavailableReason;
  };

export type MemImportCoordinatorSessionRecord = {
  version: 1;
  kind: "mem-import-coordinator-session";
  runId: string;
  phase: MemImportUsagePhase;
  role: "coordinator";
  facility: "subagent" | "inline" | "unknown";
  hostAdapter?: string;
  hostTaskId: string;
  hostSessionId?: string;
  outcome: "completed" | "failed" | "cancelled";
  requestedModel?: string;
  observedModel?: string;
  requestedThinking?: string;
  observedThinking?: string;
  usageEvidence: MemImportUsageEvidence;
  usageAdapter?: string;
  hostChildId?: string;
  hostScopeId?: string;
  activitySequence?: number;
  activityUpdatedAt?: string;
  recordedAt: string;
};

export type MemImportUsageRecord = {
  phase: MemImportUsagePhase;
  role: AssignmentRole | "coordinator";
  taskId: string;
  facility: "subagent" | "inline" | "unknown";
  hostTaskId?: string;
  hostSessionId?: string;
  recordedAt?: string;
  adapter?: string;
  hostChildId?: string;
  hostScopeId?: string;
  activitySequence?: number;
  activityUpdatedAt?: string;
  duplicateOf?: string;
  evidence: MemImportUsageEvidence;
};

export type MemImportUsageAggregate = {
  version: 1;
  availability: "available" | "partial" | "unavailable";
  recordCount: number;
  availableRecordCount: number;
  unavailableRecordCount: number;
  totals: MemImportAggregatedUsageTotals;
};

export type MemImportUsageSummary = MemImportUsageAggregate & {
  /** Portable, content-free snapshots retained after adapter session cleanup. */
  records: MemImportUsageRecord[];
  roles: Array<MemImportUsageAggregate & { role: AssignmentRole | "coordinator" }>;
  phases: Array<MemImportUsageAggregate & { phase: MemImportUsagePhase }>;
  models: Array<MemImportUsageAggregate & { provider: string; model: string }>;
  unavailable: Array<{
    phase: MemImportUsagePhase;
    role: AssignmentRole | "coordinator";
    taskId: string;
    facility: "subagent" | "inline" | "unknown";
    reason: MemImportUsageUnavailableReason;
  }>;
};

export const MEM_IMPORT_ROLE_PHASE: Record<AssignmentRole, MemImportUsagePhase> = {
  extractor: "extraction",
  proposer: "proposal-reconciliation",
  reconciler: "proposal-reconciliation",
  merger: "merge",
  reviewer: "review-finalization",
  repairer: "review-finalization",
};

const TOKEN_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens", "totalTokens"] as const;
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;
const IDENTIFIER = /^[^\r\n]{1,200}$/;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function metric(value: unknown, name: string, integer: boolean): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${name} must be null or a non-negative ${integer ? "safe integer" : "finite number"}`);
  }
  return value;
}

function normalizeCost(value: unknown, name: string): MemImportUsageCost {
  const raw = object(value, name);
  return {
    input: metric(raw.input, `${name}.input`, false),
    output: metric(raw.output, `${name}.output`, false),
    cacheRead: metric(raw.cacheRead, `${name}.cacheRead`, false),
    cacheWrite: metric(raw.cacheWrite, `${name}.cacheWrite`, false),
    total: metric(raw.total, `${name}.total`, false),
  };
}

function normalizeTotals(value: unknown, name: string): MemImportUsageTotals {
  const raw = object(value, name);
  if (raw.version !== 1) throw new Error(`${name}.version must be 1`);
  return {
    version: 1,
    sessions: count(raw.sessions, `${name}.sessions`),
    turns: count(raw.turns, `${name}.turns`),
    responses: count(raw.responses, `${name}.responses`),
    inputTokens: metric(raw.inputTokens, `${name}.inputTokens`, true),
    outputTokens: metric(raw.outputTokens, `${name}.outputTokens`, true),
    cacheReadTokens: metric(raw.cacheReadTokens, `${name}.cacheReadTokens`, true),
    cacheWriteTokens: metric(raw.cacheWriteTokens, `${name}.cacheWriteTokens`, true),
    reasoningTokens: metric(raw.reasoningTokens, `${name}.reasoningTokens`, true),
    totalTokens: metric(raw.totalTokens, `${name}.totalTokens`, true),
    cost: normalizeCost(raw.cost, `${name}.cost`),
  };
}

function normalizeModelUsage(value: unknown, name: string): MemImportModelUsage {
  const raw = object(value, name);
  if (raw.version !== 1) throw new Error(`${name}.version must be 1`);
  if (typeof raw.provider !== "string" || typeof raw.model !== "string" || !IDENTIFIER.test(raw.provider) || !IDENTIFIER.test(raw.model)) {
    throw new Error(`${name} has an invalid provider or model`);
  }
  return {
    version: 1,
    provider: raw.provider,
    model: raw.model,
    responses: count(raw.responses, `${name}.responses`),
    inputTokens: metric(raw.inputTokens, `${name}.inputTokens`, true),
    outputTokens: metric(raw.outputTokens, `${name}.outputTokens`, true),
    cacheReadTokens: metric(raw.cacheReadTokens, `${name}.cacheReadTokens`, true),
    cacheWriteTokens: metric(raw.cacheWriteTokens, `${name}.cacheWriteTokens`, true),
    reasoningTokens: metric(raw.reasoningTokens, `${name}.reasoningTokens`, true),
    totalTokens: metric(raw.totalTokens, `${name}.totalTokens`, true),
    cost: normalizeCost(raw.cost, `${name}.cost`),
  };
}

/** Validate and normalize host telemetry into an allowlisted, content-free shape. */
export function validateUsageEvidence(value: unknown): MemImportUsageEvidence {
  const raw = object(value, "usageEvidence");
  if (raw.version !== 1) throw new Error("usageEvidence.version must be 1");
  if (raw.status === "unavailable") {
    if (![
      "adapter-unavailable", "host-result-missing", "invalid-telemetry-record",
      "sidecar-missing", "sidecar-invalid", "sidecar-stale", "sidecar-unmatched",
    ].includes(String(raw.reason))) throw new Error("Invalid unavailable usage reason");
    return { version: 1, status: "unavailable", reason: raw.reason as MemImportUsageUnavailableReason };
  }
  if (raw.status !== "available" || !["subagent-result", "pi-herdr-activity-sidecar"].includes(String(raw.source))) throw new Error("Invalid usage evidence status or source");
  if (!Array.isArray(raw.usageByModel) || raw.usageByModel.length > 32) throw new Error("usageEvidence.usageByModel must contain at most 32 entries");
  const usageByModel = raw.usageByModel.map((item, index) => normalizeModelUsage(item, `usageEvidence.usageByModel[${index}]`));
  const seen = new Set<string>();
  for (const modelUsage of usageByModel) {
    const key = `${modelUsage.provider}\0${modelUsage.model}`;
    if (seen.has(key)) throw new Error("usageEvidence.usageByModel contains a duplicate provider/model bucket");
    seen.add(key);
  }
  const usage = normalizeTotals(raw.usage, "usageEvidence.usage");
  if (safeIntegerSum(usageByModel.map((item) => item.responses)) !== usage.responses) throw new Error("usageEvidence model responses do not match usage totals");
  for (const field of TOKEN_FIELDS) {
    if (usage[field] !== null && usageByModel.every((item) => item[field] !== null) && safeIntegerSum(usageByModel.map((item) => item[field]!)) !== usage[field]) {
      throw new Error(`usageEvidence model ${field} do not match usage totals`);
    }
  }
  for (const field of COST_FIELDS) {
    if (usage.cost[field] === null || !usageByModel.every((item) => item.cost[field] !== null)) continue;
    const modelTotal = safeFiniteSum(usageByModel.map((item) => item.cost[field]!));
    if (modelTotal === null || Math.abs(modelTotal - usage.cost[field]!) > Math.max(1e-12, Math.abs(usage.cost[field]!) * 1e-9)) {
      throw new Error(`usageEvidence model cost.${field} does not match usage totals`);
    }
  }
  return { version: 1, status: "available", source: raw.source as "subagent-result" | "pi-herdr-activity-sidecar", usage, usageByModel };
}

function safeIntegerSum(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (total > Number.MAX_SAFE_INTEGER - value) return null;
    total += value;
  }
  return total;
}

function safeFiniteSum(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function emptyAggregateTotals(): MemImportAggregatedUsageTotals {
  return {
    version: 1, sessions: null, turns: null, responses: null,
    inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: null,
    cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null },
  };
}

function aggregateEvidence(evidence: MemImportUsageEvidence[]): MemImportUsageAggregate {
  const available = evidence.filter((item): item is Extract<MemImportUsageEvidence, { status: "available" }> => item.status === "available");
  const complete = available.length > 0 && available.length === evidence.length;
  const totals = emptyAggregateTotals();
  for (const field of ["sessions", "turns", "responses"] as const) totals[field] = complete ? safeIntegerSum(available.map((item) => item.usage[field])) : null;
  for (const field of TOKEN_FIELDS) totals[field] = complete && available.every((item) => item.usage[field] !== null)
    ? safeIntegerSum(available.map((item) => item.usage[field]!))
    : null;
  for (const field of COST_FIELDS) totals.cost[field] = complete && available.every((item) => item.usage.cost[field] !== null)
    ? safeFiniteSum(available.map((item) => item.usage.cost[field]!))
    : null;
  return {
    version: 1,
    availability: complete ? "available" : available.length > 0 ? "partial" : "unavailable",
    recordCount: evidence.length,
    availableRecordCount: available.length,
    unavailableRecordCount: evidence.length - available.length,
    totals,
  };
}

function aggregateModelUsage(items: MemImportModelUsage[]): MemImportUsageAggregate {
  const totals = emptyAggregateTotals();
  totals.responses = items.length > 0 ? safeIntegerSum(items.map((item) => item.responses)) : null;
  for (const field of TOKEN_FIELDS) totals[field] = items.length > 0 && items.every((item) => item[field] !== null)
    ? safeIntegerSum(items.map((item) => item[field]!))
    : null;
  for (const field of COST_FIELDS) totals.cost[field] = items.length > 0 && items.every((item) => item.cost[field] !== null)
    ? safeFiniteSum(items.map((item) => item.cost[field]!))
    : null;
  return {
    version: 1,
    availability: items.length > 0 ? "available" : "unavailable",
    recordCount: items.length,
    availableRecordCount: items.length,
    unavailableRecordCount: 0,
    totals,
  };
}

export function aggregateUsageTelemetry(records: MemImportUsageRecord[]): MemImportUsageSummary {
  const effectiveRecords = records.filter((item) => !item.duplicateOf);
  const aggregate = aggregateEvidence(effectiveRecords.map((item) => item.evidence));
  const roles = [...new Set(effectiveRecords.map((item) => item.role))].sort().map((role) => ({ role, ...aggregateEvidence(effectiveRecords.filter((item) => item.role === role).map((item) => item.evidence)) }));
  const phases = [...new Set(effectiveRecords.map((item) => item.phase))].sort().map((phase) => ({ phase, ...aggregateEvidence(effectiveRecords.filter((item) => item.phase === phase).map((item) => item.evidence)) }));
  const modelRecords = new Map<string, { provider: string; model: string; usages: MemImportModelUsage[] }>();
  for (const record of effectiveRecords) {
    if (record.evidence.status !== "available") continue;
    for (const modelUsage of record.evidence.usageByModel) {
      const key = `${modelUsage.provider}\0${modelUsage.model}`;
      const bucket = modelRecords.get(key) ?? { provider: modelUsage.provider, model: modelUsage.model, usages: [] };
      bucket.usages.push(modelUsage);
      modelRecords.set(key, bucket);
    }
  }
  const models = [...modelRecords.values()]
    .sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`))
    .map((item) => ({ provider: item.provider, model: item.model, ...aggregateModelUsage(item.usages) }));
  const unavailable = effectiveRecords.flatMap((record) => record.evidence.status === "unavailable" ? [{
    phase: record.phase,
    role: record.role,
    taskId: record.taskId,
    facility: record.facility,
    reason: record.evidence.reason,
  }] : []);
  return { ...aggregate, records, roles, phases, models, unavailable };
}
