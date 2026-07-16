import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { MemImportService } from "../src/mem-import/service.js";

const service = new MemImportService();

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
  quote: Type.String({ minLength: 1, description: "Exact source excerpt supporting this candidate." }),
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
  description: "Version-1 extraction envelope. Do not guess this shape from validation errors; construct this exact envelope before calling validate or submit.",
});

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
}
