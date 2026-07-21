import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { MemImportService } from "../src/mem-import/service.js";
import { MemImportU2Service } from "../src/mem-import/u2-service.js";
import { MemImportProposalService } from "../src/mem-import/proposal-service.js";
import { MemImportCompendiumService } from "../src/mem-import/compendium-service.js";
import { MemImportIdentityService } from "../src/mem-import/identity-service.js";

const service = new MemImportService();
const u2 = new MemImportU2Service(service);
const proposals = new MemImportProposalService(service);
const compendia = new MemImportCompendiumService(service);
const identities = new MemImportIdentityService(service);

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
  endAnchor: Type.String({ minLength: 1, description: "Inclusive local anchor returned by mem_source_read_unit. The service derives the exact stored quote from this anchor range." }),
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
  description: "Version-1 extraction envelope. Select exact local anchors. Quote text is service-owned and derived from that range; do not supply provenance.quote.",
});

const artifactProvenanceSchema = Type.Object({
  sourceId: Type.String({ minLength: 1, description: "Exact sourceId from candidate provenance." }),
  unitId: Type.String({ minLength: 1, description: "Exact unitId from candidate provenance." }),
  startAnchor: Type.String({ minLength: 1, description: "Exact inclusive local start anchor." }),
  endAnchor: Type.String({ minLength: 1, description: "Exact inclusive local end anchor. Quote text is derived by the service." }),
}, { additionalProperties: false });

const artifactSchema = Type.Object({
  id: Type.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$", description: "Stable provisional or canonical artifact ID." }),
  group: extractionGroupSchema,
  type: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1, description: "Concise source-supported summary." }),
  resource: Type.Optional(Type.String({ minLength: 1 })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 })),
  timestamp: Type.Optional(Type.String({ minLength: 1 })),
  sections: Type.Array(Type.Object({ heading: Type.String({ minLength: 1 }), body: Type.String({ minLength: 1 }) }, { additionalProperties: false }), { minItems: 1, description: "At least one titled Markdown section." }),
  provenance: Type.Array(artifactProvenanceSchema, { minItems: 1, description: "Exact local source anchors; omit quote." }),
  related: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false, description: "Complete provenance-backed world artifact." });

const candidateDispositionSchema = Type.Object({
  unitId: Type.String({ minLength: 1, description: "Unit containing the extraction candidate." }),
  candidateId: Type.String({ minLength: 1, description: "Local candidate ID from that unit packet." }),
  disposition: Type.Union([Type.Literal("represented"), Type.Literal("merged"), Type.Literal("deferred"), Type.Literal("dropped")]),
  artifactId: Type.Optional(Type.String({ minLength: 1, description: "Target artifact for represented or merged candidates." })),
  reason: Type.Optional(Type.String({ minLength: 1, description: "Explanation for deferred or dropped candidates." })),
}, { additionalProperties: false, description: "Accounting decision for one extraction candidate." });

const mergeStageSchema = Type.Object({
  version: Type.Literal(1),
  kind: Type.Literal("merge"),
  artifacts: Type.Array(artifactSchema, { description: "Complete model-authored world artifacts." }),
  candidateDispositions: Type.Optional(Type.Array(candidateDispositionSchema, { description: "Extraction candidate accounting dispositions." })),
  diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema)),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: true, description: "Canonical merge semantic content. Do not supply revision/contentHash controls; the service derives them atomically." });

const mergeBatchSchema = Type.Object({
  proposalHashes: Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { minItems: 1, maxItems: 50 }),
  identityProposalHashes: Type.Optional(Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { maxItems: 100 })),
  readSet: Type.Array(Type.Object({ artifactId: Type.String({ minLength: 1 }), contentHash: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]) }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
  operations: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal("upsert"), artifact: artifactSchema }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("delete"), artifactId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  ]), { minItems: 1, maxItems: 12 }),
  candidateDispositions: Type.Optional(Type.Array(candidateDispositionSchema)),
  conflictOperations: Type.Optional(Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal("create"), conflictId: Type.String({ minLength: 1 }), blocking: Type.Boolean(), summary: Type.String({ minLength: 1 }), identityDecisionId: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Union([Type.Literal("resolve"), Type.Literal("defer")]), conflictId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  ]), { maxItems: 100 })),
  rationale: Type.String({ minLength: 1, description: "Concise auditable rationale, not hidden reasoning." }),
}, { additionalProperties: false, description: "Bounded proposal-backed canonical delta. The service materializes latest state and writes an immutable transaction receipt." });

const mergeCommitChangeSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("accept"),
    proposalHash: Type.String({ pattern: "^[a-f0-9]{64}$", description: "Proposal containing the artifact." }),
    artifactId: Type.String({ minLength: 1, description: "Artifact ID to accept byte-for-byte from that proposal." }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("upsert"),
    artifact: artifactSchema,
  }, { additionalProperties: false, description: "Intentional synthesized replacement supported by declared proposals." }),
  Type.Object({
    kind: Type.Literal("delete"),
    artifactId: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
]);

const identityPacketSchema = Type.Object({
  version: Type.Literal(1),
  kind: Type.Literal("mem-import-identity"),
  id: Type.String({ minLength: 1 }),
  proposalHashes: Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { minItems: 1, maxItems: 100 }),
  baselineRevision: Type.Integer({ minimum: 0 }),
  baselineContentHash: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
  decisions: Type.Array(Type.Union([
    Type.Object({ id: Type.String({ minLength: 1 }), provisionalId: Type.String({ minLength: 1 }), disposition: Type.Literal("match"), canonicalId: Type.String({ minLength: 1 }), alternatives: Type.Optional(Type.Array(Type.Object({ canonicalId: Type.String({ minLength: 1 }), artifactHash: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })), summary: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }), { maxItems: 25 })), evidenceRefs: Type.Optional(Type.Array(Type.Unknown())), rationale: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String({ minLength: 1 }), provisionalId: Type.String({ minLength: 1 }), disposition: Type.Literal("create"), canonicalId: Type.String({ minLength: 1 }), evidenceRefs: Type.Optional(Type.Array(Type.Unknown())), rationale: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String({ minLength: 1 }), provisionalId: Type.String({ minLength: 1 }), disposition: Type.Literal("ambiguous"), alternatives: Type.Optional(Type.Array(Type.Object({ canonicalId: Type.String({ minLength: 1 }), artifactHash: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })), summary: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }), { maxItems: 25 })), evidenceRefs: Type.Optional(Type.Array(Type.Unknown())), conflictId: Type.Optional(Type.String({ minLength: 1 })), blocking: Type.Optional(Type.Boolean()), rationale: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  ]), { minItems: 1, maxItems: 100 }),
  diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema)),
  rationale: Type.String({ minLength: 1, description: "Concise auditable rationale; never hidden reasoning." }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false, description: "Immutable model-authored match/create/ambiguous reconciliation packet. It cannot mutate canonical state." });

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
  readSet: Type.Optional(Type.Array(Type.Object({ artifactId: Type.String({ minLength: 1 }), contentHash: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]) }, { additionalProperties: false }), { maxItems: 100, description: "Exact bounded canonical artifacts inspected by this review." })),
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
    name: "mem_import_begin_compendium",
    label: "Begin Compendium Run",
    description: "Create a new run under a persistent compendium root. Compendium identity and work identity are durable; semantic merge remains model-owned.",
    parameters: Type.Object({
      compendiumRoot: Type.String({ minLength: 1 }),
      compendiumId: Type.String({ minLength: 1 }),
      workId: Type.String({ minLength: 1 }),
      audit: Type.Optional(Type.Object({ parent: Type.Optional(actorAuditSchema) }, { additionalProperties: false })),
    }),
    async execute(_id, params) {
      try { return result(await compendia.begin(params)); } catch (error) { return failure(error); }
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
    name: "mem_import_normalize_compendium_run",
    label: "Normalize Compendium Run",
    description: "Normalize a compendium run and record a content-derived duplicate-work decision without choosing semantic merge behavior.",
    parameters: Type.Object({ ...coordinatorSchema, compendiumRoot: Type.String({ minLength: 1 }), input: Type.String({ minLength: 1 }) }),
    async execute(_id, params) {
      try { return result(await compendia.normalize(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_inspect_compendium",
    label: "Inspect Compendium",
    description: "Read persistent compendium/run records and duplicate-source decisions.",
    parameters: Type.Object({ compendiumRoot: Type.String({ minLength: 1 }) }),
    async execute(_id, params) {
      try { return result(await compendia.inspect(params.compendiumRoot)); } catch (error) { return failure(error); }
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
    name: "mem_import_effect_inventory",
    label: "Inspect Assignment Effects",
    description: "Read bounded authoritative assignment, dispatch, retry-lineage, and immutable effect-hash summaries without worker prose or filesystem access.",
    parameters: Type.Object({
      ...coordinatorSchema,
      continuationCursor: Type.Optional(Type.String({ minLength: 1 })),
      maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    }, { additionalProperties: false }),
    async execute(_id, params) {
      try { return result(await service.effectInventory(params)); } catch (error) { return failure(error); }
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
    name: "mem_import_extraction_candidates",
    label: "Inspect Extraction Candidates",
    description: "Read a bounded page of exact candidate IDs, groups, and titles from one persisted extraction packet. Use this coordinator tool to size proposer shards and pass qualified unitId:candidateId scopes without loading candidate payloads.",
    parameters: Type.Object({
      ...coordinatorSchema,
      unitId: Type.String({ minLength: 1 }),
      continuationCursor: Type.Optional(Type.String({ minLength: 1 })),
      maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }, { additionalProperties: false }),
    async execute(_id, params) {
      try { return result(await service.inspectExtractionCandidates(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_record_dispatch",
    label: "Record Worker Dispatch",
    description: "Persist host-issued ordinary-subagent dispatch/lifecycle evidence for one assigned semantic worker. Finalization rejects effects lacking a completed exact-allowlist ordinary-subagent receipt.",
    parameters: Type.Object({
      ...coordinatorSchema,
      taskId: Type.String({ minLength: 1 }),
      facility: Type.Union([Type.Literal("ordinary-subagent"), Type.Literal("managed-agent"), Type.Literal("inline"), Type.Literal("unknown")]),
      hostTaskId: Type.String({ minLength: 1, maxLength: 256, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$", description: "Sanitized opaque host-issued child/session identifier; never a path, grant, or prompt." }),
      requestedTools: Type.Array(Type.String({ minLength: 1 })),
      observedTools: Type.Array(Type.String({ minLength: 1 })),
      outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled")]),
      requestedModel: Type.Optional(Type.String({ minLength: 1 })),
      observedModel: Type.Optional(Type.String({ minLength: 1 })),
      requestedThinking: Type.Optional(Type.String({ minLength: 1 })),
      observedThinking: Type.Optional(Type.String({ minLength: 1 })),
    }),
    async execute(_id, params) {
      try { return result(await service.recordWorkerDispatch(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_assignment_brief",
    label: "Render Worker Assignment Brief",
    description: "Render the exact non-persistent bootstrap a launcher must paste into one child task. It validates the current assignment grant but never writes it to import artifacts.",
    parameters: Type.Object({
      ...coordinatorSchema,
      taskId: Type.String({ minLength: 1 }),
      grant: Type.String({ minLength: 1, description: "Current assignment grant returned by the assignment tool; use only to render this child bootstrap." }),
    }),
    async execute(_id, params) {
      try { return result(await service.assignmentBrief(params)); } catch (error) { return failure(error); }
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
    description: "Validate an extraction packet without writing it. Assignment identity and local anchors are runtime-checked; stored quote text is always derived from the cited anchor range.",
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
    description: "Issue a role-scoped semantic worker assignment. The result is the complete child bootstrap and includes the exact host-enforced tools array. For a retry, revoke the prior non-extractor assignment and use a fresh taskId; retriesTaskId and supersedesTaskIds are extractor-only fields.",
    parameters: Type.Union([
      Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), role: Type.Literal("proposer"), unitIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }), candidateIds: Type.Optional(Type.Array(Type.String({ minLength: 1, description: "Optional candidate subset. Omit to assign every candidate in unitIds. Local IDs are auto-qualified only when unique; use unitId:candidateId when repeated across units." }), { minItems: 1, maxItems: 100 })), expiresAt: Type.Optional(Type.String()), audit: Type.Optional(assignmentAuditSchema) }, { additionalProperties: false }),
      Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), role: Type.Literal("reconciler"), proposalHashes: Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { minItems: 1, maxItems: 100 }), expiresAt: Type.Optional(Type.String()), audit: Type.Optional(assignmentAuditSchema) }, { additionalProperties: false }),
      Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), role: Type.Literal("merger"), proposalHashes: Type.Optional(Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { minItems: 1, maxItems: 100 })), expiresAt: Type.Optional(Type.String()), audit: Type.Optional(assignmentAuditSchema) }, { additionalProperties: false }),
      Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), role: Type.Literal("reviewer"), expiresAt: Type.Optional(Type.String()), audit: Type.Optional(assignmentAuditSchema) }, { additionalProperties: false }),
      Type.Object({ ...coordinatorSchema, taskId: Type.String({ minLength: 1 }), role: Type.Literal("repairer"), checkpointIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }), actionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }), expiresAt: Type.Optional(Type.String()), audit: Type.Optional(assignmentAuditSchema) }, { additionalProperties: false }),
    ]),
    async execute(_id, params) {
      try { return result(await service.assignWorker(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_identity_submit",
    label: "Submit Identity Reconciliation",
    description: "Persist an immutable bounded match/create/ambiguous reconciliation proposal from a scoped reconciler assignment. It cannot mutate canonical state.",
    parameters: Type.Object({ ...workerSchema, packet: identityPacketSchema }),
    async execute(_id, params) {
      try { return result(await identities.submitWorkerIdentity(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_proposal_submit",
    label: "Submit Shard Proposal",
    description: "Submit one bounded semantic shard. The service derives packet identity and extraction hashes, requires exactly one disposition for every assigned candidate, derives quotes, and persists an immutable proposal.",
    parameters: Type.Object({
      ...workerSchema,
      artifacts: Type.Array(artifactSchema, { maxItems: 100, description: "Complete provisional artifacts synthesized from this assigned shard." }),
      candidateDispositions: Type.Array(candidateDispositionSchema, { maxItems: 100, description: "Exactly one accounting decision for every assigned extraction candidate." }),
      rationale: Type.String({ minLength: 1, description: "Concise auditable rationale, not hidden reasoning." }),
      diagnostics: Type.Optional(Type.Array(extractionDiagnosticSchema)),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }, { additionalProperties: false }),
    async execute(_id, params) {
      try { return result(await proposals.submitWorkerProposalBody(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_proposal_inventory",
    label: "List Assigned Proposals",
    description: "List immutable shard proposals visible to this reconciler, merger, or repairer. Use proposalHash with mem_proposal_read; do not reconstruct proposals from extraction packets.",
    parameters: Type.Object({ ...workerSchema, continuationCursor: Type.Optional(Type.String({ minLength: 1 })), maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, params) {
      try { return result(await proposals.inventoryWorkerProposals(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_proposal_read",
    label: "Read Assigned Proposal",
    description: "Read one immutable shard proposal in bounded artifact pages. Pass continuationCursor unchanged until truncated is false.",
    parameters: Type.Object({
      ...workerSchema,
      proposalHash: Type.String({ pattern: "^[a-f0-9]{64}$", description: "Exact proposalHash returned by assignment or mem_proposal_inventory." }),
      continuationCursor: Type.Optional(Type.String({ minLength: 1 })),
      maxArtifacts: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try { return result(await proposals.readWorkerProposal(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_identity_inventory",
    label: "List Identity Packets",
    description: "List immutable identity packets visible to this merger or repairer.",
    parameters: Type.Object({ ...workerSchema, continuationCursor: Type.Optional(Type.String({ minLength: 1 })), maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, params) {
      try { return result(await identities.inventoryWorkerIdentity(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_identity_read",
    label: "Read Identity Packet",
    description: "Read one immutable identity packet in bounded decision pages. Pass continuationCursor unchanged until truncated is false.",
    parameters: Type.Object({ ...workerSchema, identityProposalHash: Type.String({ pattern: "^[a-f0-9]{64}$" }), continuationCursor: Type.Optional(Type.String({ minLength: 1 })), maxDecisions: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, params) {
      try { return result(await identities.readWorkerIdentity(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_source_read_worker",
    label: "Read Worker Source Unit",
    description: "Read a bounded normalized source unit for an authorized semantic worker. Use continuationCursor unchanged after a truncated response.",
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
    description: "Read compact cursor-paginated extraction summaries for an authorized semantic worker. This never returns candidate payloads or a whole corpus.",
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
    name: "mem_merge_inventory",
    label: "List Canonical Inventory",
    description: "Read compact cursor-paginated canonical artifact summaries for an authorized merger, reviewer, or repairer. Use this instead of loading a complete canonical snapshot.",
    parameters: Type.Object({ ...workerSchema, group: Type.Optional(extractionGroupSchema), continuationCursor: Type.Optional(Type.String({ minLength: 1 })), maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, params) {
      try { return result(await u2.readMergeInventoryForWorker(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_read_artifact",
    label: "Read Canonical Artifact",
    description: "Read one explicit canonical artifact by ID for an authorized merger, reviewer, or repairer.",
    parameters: Type.Object({ ...workerSchema, artifactId: Type.String({ minLength: 1 }) }),
    async execute(_id, params) {
      try { return result(await u2.readMergeArtifactForWorker(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_commit",
    label: "Commit Bounded Merge",
    description: "Commit one proposal-backed batch and return a compact transaction receipt. Accept proposal artifacts by reference when unchanged. The service carries proposal candidate accounting and owns lease, fence, and current-revision CAS internally.",
    parameters: Type.Object({
      ...workerSchema,
      proposalHashes: Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { minItems: 1, maxItems: 50, description: "Immutable proposals supporting this batch." }),
      identityProposalHashes: Type.Optional(Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), { maxItems: 100 })),
      readSet: Type.Array(Type.Object({ artifactId: Type.String({ minLength: 1 }), contentHash: Type.Optional(Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()])) }, { additionalProperties: false }), { minItems: 1, maxItems: 100, description: "Copy artifactContentHash from canonical reads. For an observed-absent target, use null or omit contentHash; omission is normalized to null and still fails stale if the artifact exists." }),
      changes: Type.Array(mergeCommitChangeSchema, { minItems: 1, maxItems: 62, description: "Weighted batch: at most 50 lightweight accepts and at most 12 synthesized upsert/delete changes." }),
      conflictOperations: Type.Optional(Type.Array(Type.Union([
        Type.Object({ kind: Type.Literal("create"), conflictId: Type.String({ minLength: 1 }), blocking: Type.Boolean(), summary: Type.String({ minLength: 1 }), identityDecisionId: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
        Type.Object({ kind: Type.Union([Type.Literal("resolve"), Type.Literal("defer")]), conflictId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      ]), { maxItems: 100 })),
      rationale: Type.String({ minLength: 1, description: "Concise auditable rationale, not hidden reasoning." }),
    }, { additionalProperties: false }),
    async execute(_id, params) {
      try { return result(await u2.commitWorkerBatchReceipt(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_merge_inventory",
    label: "List Coordinator Canonical Inventory",
    description: "Read compact cursor-paginated canonical artifact summaries as the coordinator.",
    parameters: Type.Object({ ...coordinatorSchema, group: Type.Optional(extractionGroupSchema), continuationCursor: Type.Optional(Type.String({ minLength: 1 })), maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, params) {
      try { return result(await u2.mergeInventory(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_work_status",
    label: "Read Import Work Status",
    description: "Summarize durable progress: canonical revision, consumed proposals, candidate accounting gaps, and open conflicts. Use this to resume without conversation history.",
    parameters: Type.Object(coordinatorSchema),
    async execute(_id, params) {
      try { return result(await u2.workStatus(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_import_merge_state",
    label: "Read Merge Controls",
    description: "Read compact canonical revision/hash controls, counts, conflicts, accounting, and review validity as the coordinator. Use bounded inventory and explicit artifact reads for canonical content.",
    parameters: Type.Object(coordinatorSchema),
    async execute(_id, params) {
      try { return result(await u2.mergeControls(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_acquire_lease",
    label: "Acquire Merge Lease",
    description: "Acquire the fenced global merge writer lease for an authorized merger or repairer. Heartbeat every 60 seconds and release it when done; stale recovery is allowed only after expiry.",
    parameters: Type.Object(workerSchema),
    async execute(_id, params) {
      try {
        await service.authorizeWorker({ ...params, capability: "merge:lease", role: "repairer" });
        return result(await u2.acquireWorkerLease(params));
      } catch (error) { return failure(error); }
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
      try {
        await service.authorizeWorker({ ...params, capability: "merge:lease", role: "repairer" });
        return result(await u2.heartbeatWorkerLease(params));
      } catch (error) { return failure(error); }
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
    name: "mem_merge_apply_repair_batch",
    label: "Apply Scoped Repair Batch",
    description: "Apply a bounded repairer-only canonical delta and return a compact transaction receipt. The repairer must cite its assigned checkpoint and action IDs; unrelated mutation is rejected.",
    parameters: Type.Object({
      ...workerSchema,
      fence: Type.Integer({ minimum: 1 }),
      expectedRevision: Type.Integer({ minimum: 0 }),
      expectedContentHash: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
      checkpointId: Type.String({ minLength: 1 }),
      actionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      batch: mergeBatchSchema,
    }),
    async execute(_id, params) {
      try { return result(await u2.applyWorkerRepairBatchReceipt(params)); } catch (error) { return failure(error); }
    },
  });

  registerMemImportTool(pi, {
    name: "mem_merge_release_lease",
    label: "Release Merge Lease",
    description: "Release a merger/repairer merge lease after the final mutation.",
    parameters: Type.Object({ ...workerSchema, fence: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      try {
        await service.authorizeWorker({ ...params, capability: "merge:lease", role: "repairer" });
        await u2.releaseWorkerLease(params);
        return result({ released: true });
      } catch (error) { return failure(error); }
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
    description: "Run deterministic lint, coverage, provenance, identity, dispatch, and readiness checks without choosing semantic repairs.",
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
