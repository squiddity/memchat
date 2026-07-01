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

export type ReviewBundle = {
  manifest: SourceManifest;
  sources: Array<{ unitId: string; sourceId: string; title?: string; order: number; content: string }>;
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
  };
  reviewer?: {
    model?: string;
    skipped?: boolean;
    reason?: string;
    score?: number; // overall 1-5
    dimensionScores?: ReviewerDimensionScore[]; // per-dimension breakdown
    reconstructionSummary?: string; // reviewer's summary reconstructed from artifacts
    qaResults?: Array<{ question: string; answerable: boolean; answer: string; confidence: "high" | "medium" | "low" }>;
    notes?: string;
  };
};
