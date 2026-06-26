export type WorldImportGroup = "people" | "places" | "things" | "facts";

export type SourceKind = "html" | "xhtml" | "archive-entry";

export type SourceBlock = {
  anchor: string;
  index: number;
  text: string;
};

export type NormalizedSourceUnit = {
  sourceId: string;
  unitId: string;
  title?: string;
  kind: SourceKind;
  inputPath: string;
  archivePath?: string;
  order: number;
  content: string;
  blocks: SourceBlock[];
};

export type SourceManifestEntry = {
  sourceId: string;
  unitId: string;
  title?: string;
  kind: SourceKind;
  inputPath: string;
  archivePath?: string;
  order: number;
  blockCount: number;
  anchors: string[];
  normalizedPath: string;
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
};

export type SourceSpanRef = {
  sourceId: string;
  unitId: string;
  startAnchor: string;
  endAnchor: string;
  quote: string;
};

export type StageEnvelope = {
  version: 1;
  kind: "extraction" | "merge" | "review";
  unitId?: string;
  sourceId?: string;
  candidates?: unknown[];
  artifacts?: ArtifactPacket[];
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
  title: string;
  sections: MarkdownSection[];
  provenance: SourceSpanRef[];
  related?: string[];
  metadata?: Record<string, unknown>;
};

export type RereadRequest = {
  reason: string;
  sourceId: string;
  unitId: string;
  startAnchor: string;
  endAnchor: string;
};

export type EvaluationResult = {
  version: 1;
  createdAt: string;
  outputRoot: string;
  deterministic: {
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; message?: string }>;
  };
  reviewer?: {
    model?: string;
    skipped?: boolean;
    reason?: string;
    score?: number;
    notes?: string;
  };
};
