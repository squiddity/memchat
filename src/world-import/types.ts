export const WORLD_IMPORT_GROUPS = ["people", "places", "things", "facts", "style"] as const;

export type WorldImportGroup = typeof WORLD_IMPORT_GROUPS[number];

export type SourceKind = "html" | "xhtml" | "archive-entry";

export type SourceRole = "body" | "frontmatter" | "toc" | "backmatter" | "cover" | "unknown";

export type SourceBlockKind = "heading" | "paragraph" | "list-item" | "quote" | "pre" | "poem" | "block";

export type SourceBlock = {
  anchor: string;
  index: number;
  text: string;
  kind?: SourceBlockKind;
  sourceTag?: string;
  sourceClass?: string;
};

export type NormalizedSourceUnit = {
  sourceId: string;
  unitId: string;
  title?: string;
  kind: SourceKind;
  role?: SourceRole;
  inputPath: string;
  archivePath?: string;
  sourceEntryPath?: string;
  portableSourceKey?: string;
  archiveContentHash?: string;
  order: number;
  sourceHash: string;
  contentHash: string;
  normalizerVersion: 2;
  content: string;
  blocks: SourceBlock[];
  metadata?: Record<string, unknown>;
};

export type SourceManifestEntry = {
  sourceId: string;
  unitId: string;
  title?: string;
  kind: SourceKind;
  role?: SourceRole;
  inputPath: string;
  archivePath?: string;
  sourceEntryPath?: string;
  portableSourceKey?: string;
  archiveContentHash?: string;
  order: number;
  blockCount: number;
  anchors: string[];
  blockKinds?: SourceBlockKind[];
  normalizedPath: string;
  sourceHash: string;
  contentHash: string;
  normalizerVersion: 2;
  metadata?: Record<string, unknown>;
};

export type ManifestDiagnostic = {
  level: "info" | "warning" | "error";
  path?: string;
  message: string;
};

export type SourceManifest = {
  version: 1;
  createdAt: string;
  inputRoot: string;
  outputRoot: string;
  units: SourceManifestEntry[];
  diagnostics: ManifestDiagnostic[];
  metadata?: Record<string, unknown>;
};

export type SourceSpanRef = {
  sourceId: string;
  unitId: string;
  startAnchor: string;
  endAnchor: string;
  quote: string;
};

export type ExtractionCandidate = {
  id: string;
  group: WorldImportGroup;
  title: string;
  provenance: SourceSpanRef[];
  payload?: unknown;
  metadata?: Record<string, unknown>;
};

export type CandidateDispositionStatus = "represented" | "merged" | "deferred" | "dropped";

export type CandidateDisposition = {
  unitId?: string;
  candidateId: string;
  disposition: CandidateDispositionStatus;
  artifactId?: string;
  reason?: string;
};

export type StageEnvelope = {
  version: 1;
  kind: "extraction" | "merge" | "review";
  unitId?: string;
  sourceId?: string;
  candidates?: ExtractionCandidate[];
  artifacts?: ArtifactPacket[];
  candidateDispositions?: CandidateDisposition[];
  diagnostics?: ManifestDiagnostic[];
  metadata?: Record<string, unknown>;
};

export type StagedReviewFindingSeverity = "info" | "warning" | "repair" | "critical";

export type StagedReviewActionType =
  | "add-artifact"
  | "strengthen-artifact"
  | "add-narrative-surface"
  | "record-omission"
  | "strengthen-provenance"
  | "repair-candidate-disposition"
  | "other";

export type StagedReviewRequestedAction = {
  id: string;
  type: StagedReviewActionType;
  severity: StagedReviewFindingSeverity;
  summary: string;
  rationale?: string;
  targetArtifactId?: string;
  targetArtifactPath?: string;
  candidateId?: string;
  unitId?: string;
  sourceRefs?: SourceSpanRef[];
  confidence?: "low" | "medium" | "high";
  rereadSource?: boolean;
};

export type StagedReviewFinding = {
  id: string;
  severity: StagedReviewFindingSeverity;
  category: "narrative-surface" | "object-coverage" | "omission-visibility" | "provenance" | "candidate-disposition" | "other";
  summary: string;
  evidence?: string;
  targetArtifactId?: string;
  targetArtifactPath?: string;
  candidateId?: string;
  unitId?: string;
  sourceRefs?: SourceSpanRef[];
  requestedActionIds?: string[];
};

export type StagedReviewStatus = "no-action" | "repair-requested" | "repair-attempted" | "verified-repaired" | "residual" | "skipped";

export type StagedReviewParseStatus = "valid" | "partial" | "missing" | "invalid";

export type StagedReviewCheckpoint = {
  version: 1;
  kind: "post-merge-review";
  checkpointId: string;
  iteration: number;
  createdAt: string;
  outputRoot: string;
  status: StagedReviewStatus;
  repairRecommended: boolean;
  findings: StagedReviewFinding[];
  requestedActions: StagedReviewRequestedAction[];
  reviewer?: {
    model?: string;
    skipped?: boolean;
    reason?: string;
    parseStatus?: StagedReviewParseStatus;
    parseErrors?: string[];
    notes?: string;
  };
};

export type StagedReviewActionVerificationStatus = "verified" | "residual" | "not-deterministically-verifiable";

export type StagedReviewActionVerification = {
  actionId: string;
  status: StagedReviewActionVerificationStatus;
  checks: Array<{ name: string; passed: boolean; message: string; path?: string; diagnosticCodes?: string[] }>;
  residualExplanation?: string;
};

export type StagedRepairVerification = {
  version: 1;
  kind: "post-merge-verify";
  checkpointId: string;
  iteration: number;
  createdAt: string;
  outputRoot: string;
  status: Extract<StagedReviewStatus, "verified-repaired" | "residual">;
  actionResults: StagedReviewActionVerification[];
};

export type StagedRepairSummary = {
  version: 1;
  kind: "post-merge-repair";
  checkpointId: string;
  iteration: number;
  createdAt: string;
  outputRoot: string;
  status: Exclude<StagedReviewStatus, "repair-requested" | "skipped" | "no-action">;
  reviewPacketPath: string;
  requestedActionIds: string[];
  responseText?: string;
  outputSummary?: {
    manifestExists: boolean;
    normalizedUnits: number;
    extractionStages: number;
    mergeStageExists: boolean;
    worldMarkdownFiles: number;
  };
  residualFindings?: StagedReviewFinding[];
};

export type MarkdownSection = {
  heading: string;
  body: string;
};

export type ArtifactPacket = {
  id: string;
  group: WorldImportGroup;
  type?: string;
  title: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  sections: MarkdownSection[];
  provenance: SourceSpanRef[];
  related?: string[];
  metadata?: Record<string, unknown>;
};

export type ReviewBundleSource = {
  unitId: string;
  sourceId: string;
  title?: string;
  order: number;
  content: string;
  sourcePagePath?: string;
};

export type ReviewBundleCandidateAccounting = {
  extractionCandidateCount: number;
  counts: Record<"represented" | "merged" | "deferred" | "dropped" | "unaccounted", number>;
  droppedOrDeferred: Array<{ unitId?: string; candidateId: string; disposition: "deferred" | "dropped"; reason?: string }>;
};

export type ReviewBundle = {
  manifest: SourceManifest;
  sources: ReviewBundleSource[];
  sourceCoverage: { bodyUnitCount: number; sampledBodyUnitCount: number; coverageTruncated: boolean };
  candidateAccounting: ReviewBundleCandidateAccounting;
  artifactInventory: Array<{ id: string; group: WorldImportGroup; title: string; sectionCount: number; bodyChars: number; provenanceCount: number; relatedCount: number }>;
  merge: StageEnvelope;
  markdown: Record<string, string>;
};

export type RereadRequest = {
  reason: string;
  sourceId: string;
  unitId: string;
  startAnchor: string;
  endAnchor: string;
};

export type ReviewerDimensionScore = {
  dimension: string;
  score: number; // 1-5
  justification: string;
};

export type LintDiagnostic = {
  code: string;
  level: "error" | "warning";
  message: string;
  path?: string;
  artifactId?: string;
  unitId?: string;
  candidateId?: string;
};

export type WorldImportLintResult = {
  passed: boolean;
  diagnostics: LintDiagnostic[];
};

export type EvaluationResult = {
  version: 1;
  createdAt: string;
  outputRoot: string;
  deterministic: {
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; message?: string; diagnostics?: LintDiagnostic[] }>;
    lint?: WorldImportLintResult;
    riskSignals?: LintDiagnostic[];
    provenanceAudit?: {
      warnings: number;
      diagnostics: LintDiagnostic[];
    };
  };
  reviewer?: {
    model?: string;
    skipped?: boolean;
    reason?: string;
    score?: number; // overall 1-5
    dimensionScores?: ReviewerDimensionScore[]; // per-dimension breakdown
    reconstructionSummary?: string; // reviewer's summary reconstructed from artifacts
    qaResults?: Array<{ question: string; answerable: boolean; answer: string; confidence: "high" | "medium" | "low" }>;
    parseStatus?: "valid" | "partial" | "missing" | "invalid";
    parseErrors?: string[];
    authoritativeScore?: boolean;
    notes?: string;
  };
};
