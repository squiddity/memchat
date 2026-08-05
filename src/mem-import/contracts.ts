export const MEM_IMPORT_GROUPS = ["people", "places", "things", "facts", "style"] as const;

export type MemImportGroup = typeof MEM_IMPORT_GROUPS[number];

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
  group: MemImportGroup;
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
  kind: "extraction" | "merge";
  /** mem-import control metadata for the latest canonical merge snapshot. */
  revision?: number;
  contentHash?: string;
  parentContentHash?: string;
  /** Digest of transaction controls bound into canonical merge content. */
  transactionControlHash?: string;
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
  group: MemImportGroup;
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

export type LintDiagnostic = {
  code: string;
  level: "error" | "warning";
  message: string;
  path?: string;
  artifactId?: string;
  unitId?: string;
  candidateId?: string;
};

export type MemImportLintResult = {
  passed: boolean;
  diagnostics: LintDiagnostic[];
};

export type MemImportRunAudit = {
  version: 2;
  kind: "mem-import-run";
  runId: string;
  status: "running" | "finalized" | "failed";
  createdAt: string;
  finalizedAt?: string;
  source: { normalizedUnits: number; manifestHash: string };
  merge?: { revision: number; contentHash: string; revisionReceiptPath: string };
  finalization?: { passed: boolean; errorCount: number; warningCount: number; checksPath: string };
  evidenceReads?: {
    total: { calls: number; pages: number; returnedItems: number; returnedChars: number };
    roles: Array<{ role: string; assignmentCount: number; calls: number; pages: number; returnedItems: number; returnedChars: number; tools: Array<{ toolName: string; calls: number; pages: number; returnedItems: number; returnedChars: number }> }>;
  };
  usage?: import("./usage-telemetry.js").MemImportUsageSummary;
  effects: Array<{ kind: "merge" | "review" | "finalization"; path: string; contentHash: string; at: string; taskId?: string }>;
  error?: string;
};
