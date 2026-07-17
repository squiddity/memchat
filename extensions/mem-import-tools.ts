import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { MemImportService } from "../src/mem-import/service.js";
import { MemImportU2Service } from "../src/mem-import/u2-service.js";
import { MemImportProposalService } from "../src/mem-import/proposal-service.js";

const service = new MemImportService();
const u2 = new MemImportU2Service(service);
const proposals = new MemImportProposalService(service);

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `mem-import tool failed: ${message}` }],
    details: { error: message },
    isError: true,
  };
}

function renderMemImportResult(result: { details?: unknown }, context: { expanded: boolean; isPartial: boolean }, theme: any) {
  if (context.isPartial) return new Text(theme.fg("warning", "Mem-import operation in progress…"), 0, 0);
  const details = result.details as { error?: unknown } | undefined;
  if (typeof details?.error === "string") return new Text(theme.fg("error", `Mem-import failed: ${details.error}`), 0, 0);

  let text = theme.fg("success", "✓ Mem-import operation complete");
  if (context.expanded) {
    text += `\n${theme.fg("dim", JSON.stringify(result.details, null, 2))}`;
  } else {
    text += ` (${keyHint("app.tools.expand", "to expand")})`;
  }
  return new Text(text, 0, 0);
}

function registerMemImportTool(pi: ExtensionAPI, definition: Parameters<ExtensionAPI["registerTool"]>[0]) {
  pi.registerTool({ ...definition, renderResult: renderMemImportResult });
}

const actorAuditSchema = Type.Object({
  model: Type.Optional(Type.String({ minLength: 1, description: "Sanitized model identifier; never include credentials." })),
  thinking: Type.Optional(Type.String({ minLength: 1, description: "Sanitized thinking setting; never include chain-of-thought." })),
}, { additionalProperties: false });

const assignmentAuditSchema = Type.Object({
  parent: Type.Optional(actorAuditSchema),
  worker: Type.Optional(actorAuditSchema),
  adapter: Type.Optional(Type.String({ minLength: 1, description: "Worker adapter identity." })),
  profile: Type.Optional(Type.String({ minLength: 1, description: "Worker role/profile identity." })),
}, { additionalProperties: false });

const coordinatorSchema = {
  outputRoot: Type.String({ description: "Absolute or relative mem-import output root; it is canonicalized and bound when the run begins." }),
  runId: Type.String({ description: "Run identifier returned by mem_import_begin." }),
  coordinatorGrant: Type.String({ description: "Coordinator authority returned by mem_import_begin. Do not place this value in import artifacts or audit prose." }),
};

const workerSchema = {
  outputRoot: Type.String({ description: "Output root returned in the worker assignment bootstrap." }),
  runId: Type.String({ description: "Run identifier returned in the worker assignment bootstrap." }),
  taskId: Type.String({ description: "Worker task identifier returned by mem_import_assign_worker." }),
  grant: Type.String({ description: "Worker assignment grant. Use only for this assigned run/task; never persist it in artifacts." }),
};

const extractorSchema = {
  outputRoot: Type.String({ description: "Output root returned in the extractor assignment bootstrap." }),
  runId: Type.String({ description: "Run identifier returned in the extractor assignment bootstrap." }),
  taskId: Type.String({ description: "Extractor task identifier returned by mem_import_assign_extractor." }),
  grant: Type.String({ description: "Extractor assignment grant. Use only for the assigned run/task; never persist it in import artifacts." }),
};

const extractionGroupSchema = Type.Union([
  Type.Literal("people"),
  Type.Literal("places"),
  Type.Literal("things"),
  Type.Literal("facts"),
  Type.Literal("style"),
], { description: "Candidate category." });

const extractionProvenanceSchema = Type.Object({
  sourceId: Type.String({ minLength: 1, description: "Must exactly equal the assigned unit sourceId." }),
  unitId: Type.String({ minLength: 1, description: "Must exactly equal the assigned unitId." }),
  startAnchor: Type.String({ minLength: 1, description: "Inclusive local anchor returned by mem_source_read_unit." }),
  endAnchor: Type.String({ minLength: 1, description: "Inclusive local anchor returned by mem_source_read_unit." }),
  quote: Type.Optional(Type.String({ minLength: 1, description: "Optional literal source excerpt. Omit it to have the service derive the exact canonical text from the cited anchor range; never normalize typography yourself." })),
}, { additionalProperties: true });

const extractionCandidateSchema = Type.Object({
  id: Type.String({ minLength: 1, description: "Unique non-empty local candidate ID within this packet." }),
  group: extractionGroupSchema,
  title: Type.String({ minLength: 1, description: "Concise non-empty candidate title." }),
  provenance: Type.Array(extractionProvenanceSchema, { minItems: 1, description: "One or more exact local source citations." }),
  payload: Type.Optional(Type.Unknown({ description: "Model-owned semantic detail. Use an object for rich extraction detail." })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Optional model-owned structured metadata." })),
}, {
  additionalProperties: true,
  description: "Extraction candidate. Keep required operational fields at this level; place unconstrained semantic detail in payload.",
});

const extractionDiagnosticSchema = Type.Object({
  level: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")]),
  message: Type.String({ minLength: 1 }),
  path: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: true });

/** Shared model-visible schema for the stage passed to validate and submit. Runtime service checks still enforce assignment-specific identity and anchors. */
export const extractionStageSchema = Type.Object({
  version: Type.Literal(1, { description: "Extraction packet format version." }),
  kind: Type.Literal("extraction", { description: "This tool accepts extraction packets only." }),
  unitId: Type.String({ minLength: 1, description: "Must exactly equal the assigned unitId and the top-level unitId argument." }),
  sourceId: Type.String({ minLength: 1, description: "Must exactly equal the assigned unit sourceId." }),
  candidates: Type.Array(extractionCandidateSchema, { description: "Extraction candidates. An empty array is structurally valid when the unit has no extractable candidates." }),
  diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema, { description: "Optional operational or model-owned uncertainty notes." })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Optional model-owned packet metadata." })),
}, {
  additionalProperties: true,
  description: "Version-1 extraction envelope. Select exact local anchors; normally omit provenance.quote so the service derives exact Unicode text from that range. Do not guess this shape from validation errors.",
});

const mergeStageSchema = Type.Object({
  version: Type.Literal(1),
  kind: Type.Literal("merge"),
  artifacts: Type.Array(Type.Unknown(), { description: "Model-authored world artifacts. Runtime validation enforces full artifact/provenance structure." }),
  candidateDispositions: Type.Optional(Type.Array(Type.Unknown(), { description: "Model-authored extraction candidate accounting dispositions." })),
  diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema)),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: true, description: "Canonical merge semantic content. Do not supply revision/contentHash controls; the service derives them atomically." });

const proposalPacketSchema = Type.Object({
  version: Type.Literal(1),
  kind: Type.Literal("mem-import-proposal"),
  id: Type.String({ minLength: 1 }),
  inputs: Type.Array(Type.Object({
    unitId: Type.String({ minLength: 1 }),
    packetHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    candidateIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 })),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
  artifacts: Type.Array(Type.Unknown()),
  candidateDispositions: Type.Optional(Type.Array(Type.Unknown())),
  diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema)),
  rationale: Type.String({ minLength: 1, description: "Concise auditable rationale, not hidden reasoning." }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false, description: "Immutable bounded shard proposal. It cannot mutate canonical merge state." });

const reviewPacketSchema = Type.Object({
  version: Type.Literal(1),
  kind: Type.Literal("mem-import-review"),
  checkpointId: Type.String({ minLength: 1 }),
  reviewedMergeRevision: Type.Integer({ minimum: 1 }),
  reviewedMergeHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  findings: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("repair"), Type.Literal("critical")]),
    summary: Type.String({ minLength: 1 }),
    sourceRefs: Type.Optional(Type.Array(Type.Unknown())),
    requestedActionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  }, { additionalProperties: true })),
  requestedActions: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.String({ minLength: 1 }),
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("repair"), Type.Literal("critical")]),
    summary: Type.String({ minLength: 1 }),
    rationale: Type.Optional(Type.String({ minLength: 1, description: "Concise user-visible rationale; never hidden reasoning." })),
    sourceRefs: Type.Optional(Type.Array(Type.Unknown())),
  }, { additionalProperties: true })),
  diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema)),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false, description: "Immutable reviewer packet, explicitly bound to a canonical merge revision/hash." });

export default function memImportTools(pi: ExtensionAPI) {
  registerMemImportTool(pi, {
    name: "mem_import_begin",
    label: "Begin Mem Import",
    description: "Create a run scoped to one output root and return coordinator authority. This does not normalize or choose semantic work.",
    parameters: Type.Object({
      outputRoot: coordinatorSchema.outputRoot,
      audit: Type.Optional(Type.Object({ parent: Type.Optional(actorAuditSchema) }, { additionalProperties: false })),
    }),
    async execute(_id, params) {
      try { return result(await service.begin(params.outputRoot, params.audit)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_normalize",
    label: "Normalize Sources",
    description: "Deterministically normalize an input under an authorized mem-import run. It does not extract semantic candidates.",
    parameters: Type.Object({ ...coordinatorSchema, input: Type.String({ description: "Input HTML/XHTML directory, ZIP, or EPUB-like archive." }) }),
    async execute(_id, params) {
      try { return result(await service.normalize(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_status",
    label: "Mem Import Status",
    description: "Read deterministic normalization and extraction counts for an authorized coordinator run.",
    parameters: Type.Object(coordinatorSchema),
    async execute(_id, params) {
      try { return result(await service.status(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_inspect_manifest",
    label: "Inspect Source Manifest",
    description: "Read the complete normalized source manifest for an authorized coordinator run.",
    parameters: Type.Object(coordinatorSchema),
    async execute(_id, params) {
      try { return result(await service.inspectManifest(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_assign_extractor",
    label: "Assign Extractor Units",
    description: "Issue one bounded extractor assignment for normalized unit IDs. The returned bootstrap is for the selected worker only; do not persist its grant in artifacts.",
    parameters: Type.Object({
      ...coordinatorSchema,
      taskId: Type.String({ description: "Unique task identifier for this extractor attempt." }),
      unitIds: Type.Array(Type.String(), { minItems: 1, description: "Normalized unit IDs this extractor may read and submit." }),
      expiresAt: Type.Optional(Type.String({ description: "Optional future ISO timestamp for assignment expiry." })),
      supersedesTaskIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Live overlapping task IDs this new task explicitly supersedes." })),
      retriesTaskId: Type.Optional(Type.String({ minLength: 1, description: "Prior revoked or expired task this fresh task retries." })),
      audit: Type.Optional(assignmentAuditSchema),
    }),
    async execute(_id, params) {
      try { return result(await service.assignExtractor(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_revoke_assignment",
    label: "Revoke Extractor Assignment",
    description: "Revoke a bounded extractor assignment before further worker tool calls.",
    parameters: Type.Object({ ...coordinatorSchema, taskId: Type.String({ description: "Task identifier to revoke." }) }),
    async execute(_id, params) {
      try { return result(await service.revokeAssignment(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_source_read_unit",
    label: "Read Assigned Source Unit",
    description: "Read a bounded normalized source unit only when it is assigned to this extractor task. When truncated, pass continuationCursor unchanged to obtain the next monotonic page; anchors remain provenance identifiers, not arbitrary character cursors.",
    parameters: Type.Object({
      ...extractorSchema,
      unitId: Type.String({ description: "Assigned normalized unit ID." }),
      startAnchor: Type.Optional(Type.String({ description: "Optional inclusive local start anchor; requires endAnchor." })),
      endAnchor: Type.Optional(Type.String({ description: "Optional inclusive local end anchor; requires startAnchor." })),
      continuationCursor: Type.Optional(Type.String({ minLength: 1, description: "Opaque cursor returned from a truncated read. Do not combine with anchors." })),
      maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 50000, description: "Maximum returned source characters; defaults to 12000." })),
    }),
    async execute(_id, params) {
      try { return result(await service.readAssignedUnit(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_extraction_status",
    label: "Assigned Extraction Status",
    description: "Read which units in this extractor assignment have persisted extraction packets.",
    parameters: Type.Object(extractorSchema),
    async execute(_id, params) {
      try { return result(await service.extractionStatus(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_extraction_read",
    label: "Read Assigned Extraction",
    description: "Read an existing extraction packet only for a unit assigned to this extractor task.",
    parameters: Type.Object({ ...extractorSchema, unitId: Type.String({ description: "Assigned normalized unit ID." }) }),
    async execute(_id, params) {
      try { return result(await service.readExtraction(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_extraction_validate",
    label: "Validate Extraction Packet",
    description: "Validate a structured version-1 extraction packet against the assigned normalized unit without writing it. The stage schema is model-visible; assignment-specific identity, anchors, and literal quote excerpts remain runtime-checked.",
    parameters: Type.Object({ ...extractorSchema, unitId: Type.String({ description: "Assigned normalized unit ID." }), stage: extractionStageSchema }),
    async execute(_id, params) {
      try {
        await service.validateExtraction(params);
        return result({ valid: true, unitId: params.unitId });
      } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_extraction_submit",
    label: "Submit Extraction Packet",
    description: "Atomically persist a structured version-1 extraction packet only for a unit assigned to this extractor task. A revoked or superseded worker cannot replace a newer packet.",
    parameters: Type.Object({ ...extractorSchema, unitId: Type.String({ description: "Assigned normalized unit ID." }), stage: extractionStageSchema }),
    async execute(_id, params) {
      try { return result(await service.submitExtraction(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_assign_worker",
    label: "Assign Mem Import Worker",
    description: "Issue a bounded merger, reviewer, or repairer assignment. Repairers must be scoped to explicit checkpoint and action IDs.",
    parameters: Type.Object({
      ...coordinatorSchema,
      taskId: Type.String({ minLength: 1 }),
      role: Type.Union([Type.Literal("proposer"), Type.Literal("merger"), Type.Literal("reviewer"), Type.Literal("repairer")]),
      expiresAt: Type.Optional(Type.String()),
      unitIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
      candidateIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
      checkpointIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      actionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      audit: Type.Optional(assignmentAuditSchema),
    }),
    async execute(_id, params) {
      try { return result(await service.assignWorker(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_proposal_submit",
    label: "Submit Shard Proposal",
    description: "Persist an immutable bounded proposal from a scoped proposal-author assignment. This validates declared extraction packet hashes and cannot mutate canonical merge state.",
    parameters: Type.Object({ ...workerSchema, packet: proposalPacketSchema }),
    async execute(_id, params) {
      try { return result(await proposals.submitWorkerProposal(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_source_read_worker",
    label: "Read Worker Source Unit",
    description: "Read a bounded normalized source unit for an authorized merger, reviewer, or repairer. Use continuationCursor unchanged after a truncated response.",
    parameters: Type.Object({
      ...workerSchema,
      unitId: Type.String({ minLength: 1 }),
      startAnchor: Type.Optional(Type.String({ minLength: 1 })),
      endAnchor: Type.Optional(Type.String({ minLength: 1 })),
      continuationCursor: Type.Optional(Type.String({ minLength: 1 })),
      maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 50000 })),
    }),
    async execute(_id, params) {
      try { return result(await service.readWorkerUnit(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_extraction_inventory_worker",
    label: "List Extraction Inventory",
    description: "Read compact, cursor-paginated extraction packet summaries for an authorized merger, reviewer, or repairer. This never returns candidate payloads or a whole corpus.",
    parameters: Type.Object({
      ...workerSchema,
      group: Type.Optional(extractionGroupSchema),
      continuationCursor: Type.Optional(Type.String({ minLength: 1 })),
      maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try { return result(await service.readWorkerExtractionInventory(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_extraction_read_worker",
    label: "Read Extraction Packet",
    description: "Read candidates from exactly one persisted extraction packet in bounded pages. Use mem_extraction_inventory_worker first; do not request a whole corpus.",
    parameters: Type.Object({
      ...workerSchema,
      unitId: Type.String({ minLength: 1 }),
      candidateIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 })),
      continuationCursor: Type.Optional(Type.String({ minLength: 1 })),
      maxCandidates: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try { return result(await service.readWorkerExtractions(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_read",
    label: "Read Canonical Merge",
    description: "Read the latest canonical merge snapshot and its required revision/hash controls for an authorized merger, reviewer, or repairer.",
    parameters: Type.Object(workerSchema),
    async execute(_id, params) {
      try { return result(await u2.readMergeForWorker(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_merge_state",
    label: "Read Merge State",
    description: "Read the latest canonical merge snapshot and revision/hash controls as the coordinator.",
    parameters: Type.Object(coordinatorSchema),
    async execute(_id, params) {
      try { return result(await u2.mergeState(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_acquire_lease",
    label: "Acquire Merge Lease",
    description: "Acquire the fenced global merge writer lease for an authorized merger or repairer. Heartbeat every 60 seconds and release it when done; stale recovery is allowed only after expiry.",
    parameters: Type.Object(workerSchema),
    async execute(_id, params) {
      try { return result(await u2.acquireWorkerLease(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_acquire_merge_lease",
    label: "Acquire Coordinator Merge Lease",
    description: "Acquire the fenced global merge writer lease for explicit coordinator-authored merge/repair work.",
    parameters: Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }) }),
    async execute(_id, params) {
      try { return result(await u2.acquireCoordinatorLease(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_heartbeat_lease",
    label: "Heartbeat Merge Lease",
    description: "Extend a merger/repairer-owned merge lease only when its fence and assignment remain valid.",
    parameters: Type.Object({ ...workerSchema, fence: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      try { return result(await u2.heartbeatWorkerLease(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_heartbeat_merge_lease",
    label: "Heartbeat Coordinator Lease",
    description: "Extend the coordinator-owned merge lease only when its fence remains current.",
    parameters: Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), fence: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      try { return result(await u2.heartbeatCoordinatorLease(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_write",
    label: "Write Canonical Merge",
    description: "Atomically write a complete semantic merge snapshot only with a current worker lease fence and matching expected revision/hash. The service creates an immutable content-addressed revision receipt.",
    parameters: Type.Object({
      ...workerSchema,
      fence: Type.Integer({ minimum: 1 }),
      expectedRevision: Type.Integer({ minimum: 0 }),
      expectedContentHash: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
      stage: mergeStageSchema,
      rationale: Type.String({ minLength: 1, description: "Concise rationale, not hidden reasoning." }),
      checkpointId: Type.Optional(Type.String({ minLength: 1 })),
      actionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    async execute(_id, params) {
      try { return result(await u2.writeWorkerMerge(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_write_merge",
    label: "Write Coordinator Merge",
    description: "Atomically write a complete coordinator-authored merge snapshot with the same lease, CAS, immutable-history, and audit guarantees as a worker mutation.",
    parameters: Type.Object({
      ...coordinatorSchema,
      taskId: Type.String({ minLength: 1 }),
      fence: Type.Integer({ minimum: 1 }),
      expectedRevision: Type.Integer({ minimum: 0 }),
      expectedContentHash: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
      stage: mergeStageSchema,
      rationale: Type.String({ minLength: 1, description: "Concise rationale, not hidden reasoning." }),
      checkpointId: Type.Optional(Type.String({ minLength: 1 })),
      actionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    async execute(_id, params) {
      try { return result(await u2.writeCoordinatorMerge(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_release_lease",
    label: "Release Merge Lease",
    description: "Release a merger/repairer merge lease after the final mutation.",
    parameters: Type.Object({ ...workerSchema, fence: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      try { await u2.releaseWorkerLease(params); return result({ released: true }); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_release_merge_lease",
    label: "Release Coordinator Lease",
    description: "Release an explicit coordinator-owned merge lease after the final mutation or finalization.",
    parameters: Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), fence: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      try { await u2.releaseCoordinatorLease(params); return result({ released: true }); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_review_submit",
    label: "Submit Immutable Review",
    description: "Persist one immutable reviewer packet bound to an existing canonical merge revision. This cannot mutate world state.",
    parameters: Type.Object({ ...workerSchema, packet: reviewPacketSchema }),
    async execute(_id, params) {
      try { return result(await u2.submitReview(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_check_run",
    label: "Run Import Checks",
    description: "Run deterministic lint, coverage, provenance, and readiness checks without choosing semantic repairs.",
    parameters: Type.Object(coordinatorSchema),
    async execute(_id, params) {
      try { return result(await u2.checks(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_fail",
    label: "Record Import Failure",
    description: "Coordinator-only terminal failure record for an unmet capability or required-delegation gate. Keep the message concise and credential-free.",
    parameters: Type.Object({ ...coordinatorSchema, reasonCode: Type.String({ minLength: 1, maxLength: 80 }), message: Type.String({ minLength: 1, maxLength: 1000 }) }),
    async execute(_id, params) {
      try { return result(await u2.fail(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_finalize",
    label: "Finalize Mem Import",
    description: "Coordinator-only finalization. With a current coordinator lease, emit Markdown, rerun deterministic checks, write import-run v2, and refuse finalized success on error diagnostics.",
    parameters: Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), fence: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      try { return result(await u2.finalize(params)); } catch (error) { return failure(error); }
    },
  });
}
