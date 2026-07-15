import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  loadSkillsFromDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { isUsableModel, modelLabel, requireResolvedModel, type ThinkingLevel } from "../model-selection.js";
import { resolvePiRuntimePaths } from "../pi-runtime.js";
import { emitWorldLibrary } from "./emit.js";
import { lintWorldImport, runPostMergeReviewEvaluation, runReviewerModelEvaluation, writePostMergeReviewResult } from "./eval.js";
import { buildCoveragePlan, buildRepairSummary, writeRepairSummaryFile } from "./helper-tools.js";
import { checkpointReviewPath, readMergeStage, writeStagedRepairSummary, writeStagedRepairVerification } from "./staging.js";
import type { ArtifactPacket, EvaluationResult, SourceSpanRef, StagedRepairVerification, StagedReviewActionVerification, StagedReviewCheckpoint, StagedReviewRequestedAction } from "./types.js";

export type WorldImportDebugOptions = {
  enabled?: boolean;
  showThinking?: boolean;
  showToolUpdates?: boolean;
};

export type WorldImportOutputSummary = {
  manifestExists: boolean;
  normalizedUnits: number;
  extractionStages: number;
  mergeStageExists: boolean;
  worldMarkdownFiles: number;
};

export type WorldImportSkillStage = "full" | "extract" | "merge" | "repair";
export type WorldImportSessionStrategy = "single" | "staged";
export type WorldImportStageName = WorldImportSkillStage | "merge-readiness" | "post-merge-review" | "post-merge-verify" | "review";

export type WorldImportRunOptions = {
  cwd?: string;
  packageRoot?: string;
  /** Optional credentials file; account-level pi config is never otherwise inherited. */
  authFile?: string;
  input: string;
  outputRoot: string;
  model?: string;
  reviewerModel?: string;
  stagedReview?: {
    enabled?: boolean;
    maxRepairIterations?: number;
  };
  thinking?: ThinkingLevel;
  dryRun?: boolean;
  sessionStrategy?: WorldImportSessionStrategy;
  debug?: WorldImportDebugOptions;
  onText?: (text: string) => void;
  onStatus?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolEvent?: (text: string) => void;
};

export type WorldImportStageResult = {
  stage: WorldImportStageName;
  model?: string;
  responseText?: string;
  outputSummary?: WorldImportOutputSummary;
  reviewer?: EvaluationResult["reviewer"];
  checkpoint?: StagedReviewCheckpoint;
  verification?: StagedRepairVerification;
  deterministicPassed?: boolean;
};

export type WorldImportRunResult = {
  responseText: string;
  model?: string;
  outputRoot: string;
  outputSummary: WorldImportOutputSummary;
  sessionStrategy: WorldImportSessionStrategy;
  stages: WorldImportStageResult[];
};

type WorldImportModelPromptOptions = WorldImportRunOptions & {
  stage?: WorldImportSkillStage;
  checkpointId?: string;
  reviewPacket?: string;
  iteration?: number;
};

type WorldImportModelPromptResult = Pick<WorldImportRunResult, "responseText" | "model" | "outputRoot" | "outputSummary">;

export type MergeReadinessAssessment = {
  ready: boolean;
  fingerprint: string;
  checkpoint: StagedReviewCheckpoint;
  outputSummary: WorldImportOutputSummary;
};

type WorldImportRunnerDeps = {
  runModelPrompt: (options: WorldImportModelPromptOptions) => Promise<WorldImportModelPromptResult>;
  assessMergeReadiness?: (outputRoot: string, iteration: number, reportedSummary?: WorldImportOutputSummary) => Promise<MergeReadinessAssessment>;
  runPostMergeReview?: (options: Pick<WorldImportRunOptions, "cwd" | "authFile" | "outputRoot" | "reviewerModel" | "debug" | "onStatus" | "onThinking" | "onToolEvent"> & { checkpointId: string; iteration: number }) => Promise<StagedReviewCheckpoint>;
  runReviewerEvaluation: (options: Pick<WorldImportRunOptions, "cwd" | "authFile" | "outputRoot" | "reviewerModel" | "debug" | "onStatus" | "onThinking" | "onToolEvent">) => Promise<EvaluationResult>;
};

const defaultRunnerDeps: WorldImportRunnerDeps = {
  runModelPrompt: runWorldImportModelPrompt,
  assessMergeReadiness,
  runPostMergeReview: runPostMergeReviewEvaluation,
  runReviewerEvaluation: runReviewerModelEvaluation,
};

export function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function worldImportSkill(packageRoot = defaultPackageRoot()): Skill {
  const baseDir = resolve(packageRoot, "skills", "world-import");
  if (!existsSync(resolve(baseDir, "SKILL.md"))) throw new Error(`world-import skill not found at ${resolve(baseDir, "SKILL.md")}`);
  const result = loadSkillsFromDir({ dir: baseDir, source: "memchat" });
  if (result.diagnostics.length > 0) {
    const detail = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("; ");
    throw new Error(`Failed to load world-import skill: ${detail}`);
  }
  const skill = result.skills.find((candidate) => candidate.name === "world-import");
  if (!skill) throw new Error(`world-import skill not found in ${baseDir}`);
  return skill;
}

export function renderWorldImportSkillInvocation(options: Pick<WorldImportRunOptions, "input" | "outputRoot" | "reviewerModel" | "dryRun"> & { helperCommand?: string; stage?: WorldImportSkillStage; checkpointId?: string; reviewPacket?: string; iteration?: number }): string {
  return `/skill:world-import ${JSON.stringify({
    input: options.input,
    output: options.outputRoot,
    helperCommand: options.helperCommand,
    reviewerModel: options.reviewerModel,
    dryRun: options.dryRun ?? false,
    ...(options.stage && options.stage !== "full" ? { stage: options.stage } : {}),
    ...(options.stage === "repair" ? {
      checkpointId: options.checkpointId,
      reviewPacket: options.reviewPacket,
      iteration: options.iteration,
    } : {}),
  })}`;
}

export function finalizeAssistantMessageForCli(text: string, currentMessageHadText: boolean): string {
  return currentMessageHadText && text.length > 0 && !text.endsWith("\n") ? `${text}\n` : text;
}

function status(options: WorldImportRunOptions, text: string): void {
  if (options.debug?.enabled) options.onStatus?.(`[world-import] ${text}\n`);
}

function stringifyForLog(value: unknown, maxLength = 4000): string {
  let rendered: string;
  try {
    rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    rendered = String(value);
  }
  return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}…` : rendered;
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" ? event as Record<string, unknown> : {};
}

async function countFiles(dir: string, predicate: (name: string) => boolean): Promise<number> {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) count += await countFiles(path, predicate);
    else if (entry.isFile() && predicate(entry.name)) count += 1;
  }
  return count;
}

export async function inspectWorldImportOutput(outputRoot: string): Promise<WorldImportOutputSummary> {
  const manifestPath = join(outputRoot, "sources", "manifest.json");
  let normalizedUnits = 0;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as { units?: unknown[] };
      normalizedUnits = Array.isArray(manifest.units) ? manifest.units.length : 0;
    } catch {
      normalizedUnits = 0;
    }
  }
  return {
    manifestExists: existsSync(manifestPath),
    normalizedUnits,
    extractionStages: await countFiles(join(outputRoot, "stages", "extraction"), (name) => name.endsWith(".json")),
    mergeStageExists: existsSync(join(outputRoot, "stages", "merge", "merged-candidates.json")),
    worldMarkdownFiles: await countFiles(join(outputRoot, "world"), (name) => name.endsWith(".md")),
  };
}

function readinessFingerprint(items: Array<{ code: string; message?: string; artifactId?: string; unitId?: string; candidateId?: string }>): string {
  const canonical = items.map((item) => [item.code, item.artifactId ?? "", item.unitId ?? "", item.candidateId ?? "", item.message ?? ""].join(":")).sort().join("\n");
  return createHash("sha256").update(canonical || "ready").digest("hex").slice(0, 16);
}

async function writeMergeReadinessCheckpoint(options: {
  outputRoot: string;
  iteration: number;
  diagnostics: Array<{ code: string; message: string; artifactId?: string; unitId?: string; candidateId?: string }>;
  ready: boolean;
}): Promise<StagedReviewCheckpoint> {
  const errors = options.diagnostics.slice(0, 50);
  return writePostMergeReviewResult(options.outputRoot, {
    checkpointId: "merge-readiness",
    iteration: options.iteration,
    status: options.ready ? "no-action" : "repair-requested",
    repairRecommended: !options.ready,
    findings: errors.map((diagnostic, index) => ({
      id: `readiness-${options.iteration}-${index + 1}`,
      severity: "repair",
      category: diagnostic.code.includes("candidate") ? "candidate-disposition" : diagnostic.code.includes("provenance") ? "provenance" : "other",
      summary: `[${diagnostic.code}] ${diagnostic.message}`,
      ...(diagnostic.artifactId ? { targetArtifactId: diagnostic.artifactId } : {}),
      ...(diagnostic.unitId ? { unitId: diagnostic.unitId } : {}),
      ...(diagnostic.candidateId ? { candidateId: diagnostic.candidateId } : {}),
    })),
    requestedActions: options.ready ? [] : [{
      id: `repair-merge-readiness-${options.iteration}`,
      type: "other",
      severity: "repair",
      summary: "Resume the existing merge and resolve the deterministic blockers listed in this checkpoint and stages/repair-summary.md; preserve valid durable artifacts, then emit and lint.",
      confidence: "high",
      rereadSource: false,
    }],
    reviewer: { skipped: true, reason: "deterministic merge-readiness assessment" },
  });
}

export async function assessMergeReadiness(outputRoot: string, iteration: number): Promise<MergeReadinessAssessment> {
  let summary = await inspectWorldImportOutput(outputRoot);
  const diagnostics: Array<{ code: string; message: string; artifactId?: string; unitId?: string; candidateId?: string }> = [];
  if (!summary.manifestExists || summary.normalizedUnits === 0) diagnostics.push({ code: "upstream-not-ready", message: "Normalized source manifest is missing or empty." });
  if (summary.extractionStages === 0) diagnostics.push({ code: "upstream-not-ready", message: "No extraction stages were persisted." });

  let mergeArtifactCount = 0;
  let repairSummaryWritten = false;
  if (!summary.mergeStageExists) diagnostics.push({ code: "merge-missing", message: "The merge stage was not persisted." });
  else {
    try {
      const merge = await readMergeStage(outputRoot);
      mergeArtifactCount = merge.artifacts?.length ?? 0;
      if (mergeArtifactCount === 0) diagnostics.push({ code: "no-artifacts", message: "The merge stage contains no artifacts." });
    } catch (error) {
      diagnostics.push({ code: "merge-invalid", message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (diagnostics.length === 0 && mergeArtifactCount > 0) {
    try {
      await emitWorldLibrary(outputRoot);
      const [lint, coverage] = await Promise.all([lintWorldImport(outputRoot), buildCoveragePlan(outputRoot)]);
      diagnostics.push(...lint.diagnostics.filter((item) => item.level === "error").map((item) => ({ code: item.code, message: item.message, artifactId: item.artifactId, unitId: item.unitId, candidateId: item.candidateId })));
      diagnostics.push(...coverage.recommendations.filter((item) => item.level === "error").map((item) => ({ code: item.code, message: item.message })));
      diagnostics.push(...coverage.unitCoverage.flatMap((unit) => unit.diagnostics.filter((item) => item.level === "error").map((item) => ({ code: item.code, message: item.message, unitId: item.unitId }))));
      const repairSummary = await buildRepairSummary(outputRoot, "markdown") as string;
      await writeRepairSummaryFile(outputRoot, repairSummary);
      repairSummaryWritten = true;
    } catch (error) {
      diagnostics.push({ code: "emission-incomplete", message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!repairSummaryWritten && diagnostics.length > 0) {
    const lines = ["# World import repair summary", "", "## Errors to fix before declaring success", "", ...diagnostics.map((item, index) => `${index + 1}. \`${item.code}\` — ${item.message}`), ""];
    await writeRepairSummaryFile(outputRoot, `${lines.join("\n")}\n`);
  }
  summary = await inspectWorldImportOutput(outputRoot);
  if (summary.worldMarkdownFiles === 0 && !diagnostics.some((item) => item.code === "merge-missing" || item.code === "no-artifacts")) diagnostics.push({ code: "emission-incomplete", message: "Emission produced no Markdown files." });
  const ready = diagnostics.length === 0;
  const checkpoint = await writeMergeReadinessCheckpoint({ outputRoot, iteration, diagnostics, ready });
  return { ready, fingerprint: readinessFingerprint(diagnostics), checkpoint, outputSummary: summary };
}

function helperCommandFor(cwd: string, packageRoot: string): string {
  return cwd === packageRoot ? "npm run world-import-helper --" : "memchat-world-import-helper";
}

function stageLabel(stage: WorldImportStageName): string {
  return stage === "full" ? "full" : `stage ${stage}`;
}

function summarizeReviewResult(result: EvaluationResult): string {
  const reviewer = result.reviewer;
  if (!reviewer) return `deterministicPassed=${result.deterministic.passed}`;
  if (reviewer.skipped) return `deterministicPassed=${result.deterministic.passed}; reviewerSkipped=true; reason=${reviewer.reason ?? "unknown"}`;
  return `deterministicPassed=${result.deterministic.passed}; reviewerSkipped=false; score=${reviewer.score ?? "none"}`;
}

function summarizeCheckpoint(checkpoint: StagedReviewCheckpoint): string {
  if (checkpoint.reviewer?.skipped) return `status=${checkpoint.status}; skipped=true; reason=${checkpoint.reviewer.reason ?? "unknown"}`;
  return `status=${checkpoint.status}; repairRecommended=${checkpoint.repairRecommended}; actions=${checkpoint.requestedActions.length}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function artifactPacketHash(artifact: ArtifactPacket): string {
  return createHash("sha256").update(canonicalJson(artifact)).digest("hex");
}

export async function attachPreRepairArtifactHashes(outputRoot: string, checkpoint: StagedReviewCheckpoint): Promise<StagedReviewCheckpoint> {
  if (!checkpoint.requestedActions.some((action) => action.type === "strengthen-artifact" || action.type === "strengthen-provenance")) return checkpoint;
  const merge = await readMergeStage(outputRoot);
  const artifacts = new Map((merge.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  return {
    ...checkpoint,
    requestedActions: checkpoint.requestedActions.map((action) => {
      if (action.type !== "strengthen-artifact" && action.type !== "strengthen-provenance") return action;
      const artifact = action.targetArtifactId ? artifacts.get(action.targetArtifactId) : undefined;
      return artifact ? { ...action, preRepairArtifactHash: artifactPacketHash(artifact) } : action;
    }),
  };
}

async function emittedArtifactExists(outputRoot: string, artifactId: string): Promise<boolean> {
  const root = join(outputRoot, "world");
  const scan = async (dir: string): Promise<boolean> => {
    if (!existsSync(dir)) return false;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && await scan(path)) return true;
      if (entry.isFile() && entry.name.endsWith(".md") && (await readFile(path, "utf-8")).includes(`id: "${artifactId}"`)) return true;
    }
    return false;
  };
  return scan(root);
}

async function groupIndexContainsArtifact(outputRoot: string, artifact: NonNullable<Awaited<ReturnType<typeof readMergeStage>>["artifacts"]>[number]): Promise<boolean> {
  const indexPath = join(outputRoot, "world", artifact.group, "index.md");
  return existsSync(indexPath) && (await readFile(indexPath, "utf-8")).includes(artifact.id);
}

function relevantLintDiagnostics(action: StagedReviewRequestedAction, diagnostics: Awaited<ReturnType<typeof lintWorldImport>>["diagnostics"]): Awaited<ReturnType<typeof lintWorldImport>>["diagnostics"] {
  return diagnostics.filter((diagnostic) => (
    (action.targetArtifactId !== undefined && diagnostic.artifactId === action.targetArtifactId)
    || (action.candidateId !== undefined && diagnostic.candidateId === action.candidateId)
    || (action.unitId !== undefined && diagnostic.unitId === action.unitId)
  ));
}

function anchorNumber(anchor: string): number | undefined {
  const match = /^b(\d+)$/.exec(anchor);
  return match ? Number(match[1]) : undefined;
}

function sourceRefsOverlap(left: SourceSpanRef, right: SourceSpanRef): boolean {
  if (left.sourceId !== right.sourceId || left.unitId !== right.unitId) return false;
  const leftStart = anchorNumber(left.startAnchor);
  const leftEnd = anchorNumber(left.endAnchor);
  const rightStart = anchorNumber(right.startAnchor);
  const rightEnd = anchorNumber(right.endAnchor);
  if ([leftStart, leftEnd, rightStart, rightEnd].some((value) => value === undefined)) {
    return left.startAnchor === right.startAnchor && left.endAnchor === right.endAnchor;
  }
  return leftStart! <= rightEnd! && rightStart! <= leftEnd!;
}

function requestedSourceRefsPresent(action: StagedReviewRequestedAction, artifact: ArtifactPacket): boolean {
  return (action.sourceRefs ?? []).every((requested) => artifact.provenance.some((actual) => sourceRefsOverlap(requested, actual)));
}

export async function verifyPostMergeRepair(outputRoot: string, checkpoint: StagedReviewCheckpoint): Promise<StagedRepairVerification> {
  let merge: Awaited<ReturnType<typeof readMergeStage>>;
  let lint: Awaited<ReturnType<typeof lintWorldImport>>;
  try {
    [merge, lint] = await Promise.all([readMergeStage(outputRoot), lintWorldImport(outputRoot)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      version: 1, kind: "post-merge-verify", checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration, createdAt: new Date().toISOString(), outputRoot, status: "residual",
      actionResults: checkpoint.requestedActions.map((action) => ({ actionId: action.id, status: "residual", checks: [{ name: "verification inputs", passed: false, message }], residualExplanation: "Merge output or deterministic lint could not be read after repair." })),
    };
  }
  const actionResults: StagedReviewActionVerification[] = [];
  for (const action of checkpoint.requestedActions) {
    if (action.type === "strengthen-artifact" || action.type === "strengthen-provenance") {
      if (!action.targetArtifactId || !action.preRepairArtifactHash) {
        actionResults.push({ actionId: action.id, status: "not-deterministically-verifiable", checks: [], residualExplanation: `Action type ${action.type} requires a targetArtifactId and pre-repair artifact hash for structural verification.` });
        continue;
      }
      const artifact = (merge.artifacts ?? []).find((item) => item.id === action.targetArtifactId);
      const artifactExists = artifact !== undefined;
      const changed = artifact ? artifactPacketHash(artifact) !== action.preRepairArtifactHash : false;
      const requestedRefsPresent = artifact ? requestedSourceRefsPresent(action, artifact) : false;
      const markdownExists = artifactExists ? await emittedArtifactExists(outputRoot, action.targetArtifactId) : false;
      const indexed = artifact ? await groupIndexContainsArtifact(outputRoot, artifact) : false;
      const relevantDiagnostics = relevantLintDiagnostics(action, lint.diagnostics);
      const scopedLintClean = relevantDiagnostics.every((diagnostic) => diagnostic.level !== "error");
      const checks = [
        { name: "merge artifact", passed: artifactExists, message: artifactExists ? `Artifact ${action.targetArtifactId} exists in merge output.` : `Artifact ${action.targetArtifactId} is absent from merge output.` },
        { name: "artifact changed", passed: changed, message: changed ? "Artifact packet changed from its pre-repair baseline." : "Artifact packet did not change from its pre-repair baseline." },
        { name: "requested source refs", passed: requestedRefsPresent, message: requestedRefsPresent ? `${action.sourceRefs?.length ?? 0} requested source ref(s) are represented by overlapping artifact provenance.` : "One or more requested source refs are not represented by artifact provenance." },
        { name: "emitted markdown", passed: markdownExists, message: markdownExists ? `Emitted markdown exists for ${action.targetArtifactId}.` : `Emitted markdown is absent for ${action.targetArtifactId}.` },
        { name: "group index", passed: indexed, message: indexed ? `Group index includes ${action.targetArtifactId}.` : `Group index does not include ${action.targetArtifactId}.` },
        { name: "target-scoped lint", passed: scopedLintClean, message: scopedLintClean ? "No target-scoped lint errors remain." : "Target-scoped lint errors remain.", ...(relevantDiagnostics.length > 0 ? { diagnosticCodes: relevantDiagnostics.map((diagnostic) => diagnostic.code) } : {}) },
      ];
      const passed = checks.every((check) => check.passed);
      actionResults.push({ actionId: action.id, status: passed ? "verified-structural" : "residual", checks, ...(passed ? {} : { residualExplanation: "Structural repair checks did not all pass." }) });
      continue;
    }
    if (action.type === "record-omission" || action.type === "other") {
      actionResults.push({ actionId: action.id, status: "not-deterministically-verifiable", checks: [], residualExplanation: `Action type ${action.type} has no deterministic predicate.` });
      continue;
    }
    if (action.type === "repair-candidate-disposition") {
      const disposition = (merge.candidateDispositions ?? []).find((item) => item.candidateId === action.candidateId && (action.unitId === undefined || item.unitId === action.unitId));
      const passed = disposition !== undefined;
      actionResults.push({ actionId: action.id, status: passed ? "verified" : "residual", checks: [{ name: "candidate disposition", passed, message: passed ? `Disposition ${disposition?.disposition} found for ${action.unitId ?? "any unit"}:${action.candidateId ?? "unknown candidate"}.` : "Requested candidate disposition was not found." }], ...(passed ? {} : { residualExplanation: "The requested candidate disposition is absent." }) });
      continue;
    }
    const artifact = (merge.artifacts ?? []).find((item) => item.id === action.targetArtifactId);
    const artifactExists = artifact !== undefined;
    const markdownExists = artifactExists && action.targetArtifactId ? await emittedArtifactExists(outputRoot, action.targetArtifactId) : false;
    const indexed = artifactExists ? await groupIndexContainsArtifact(outputRoot, artifact) : false;
    const relevantDiagnostics = relevantLintDiagnostics(action, lint.diagnostics);
    const cleanRefs = relevantDiagnostics.every((diagnostic) => !["unresolved-provenance-unit", "provenance-source-mismatch", "unresolved-provenance-anchor"].includes(diagnostic.code));
    const checks = [
      { name: "merge artifact", passed: artifactExists, message: artifactExists ? `Artifact ${action.targetArtifactId} exists in merge output.` : "Requested targetArtifactId is absent from merge output." },
      { name: "emitted markdown", passed: markdownExists, message: markdownExists ? `Emitted markdown exists for ${action.targetArtifactId}.` : "Emitted markdown for the requested artifact is absent." },
      { name: "group index", passed: indexed, message: indexed ? `Group index includes ${action.targetArtifactId}.` : "Group index does not include the requested artifact." },
      { name: "resolved provenance", passed: cleanRefs, message: cleanRefs ? "No action-scoped provenance resolution errors." : "Action-scoped provenance resolution errors remain.", ...(relevantDiagnostics.length > 0 ? { diagnosticCodes: relevantDiagnostics.map((diagnostic) => diagnostic.code) } : {}) },
    ];
    const passed = checks.every((check) => check.passed);
    actionResults.push({ actionId: action.id, status: passed ? "verified" : "residual", checks, ...(passed ? {} : { residualExplanation: "Structural repair checks did not all pass." }) });
  }
  const status = actionResults.every((result) => result.status === "verified" || result.status === "verified-structural") ? "verified-repaired" : "residual";
  return { version: 1, kind: "post-merge-verify", checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration, createdAt: new Date().toISOString(), outputRoot, status, actionResults };
}

function writeSkippedPostMergeCheckpoint(outputRoot: string, reason: string): Promise<StagedReviewCheckpoint> {
  return writePostMergeReviewResult(outputRoot, {
    checkpointId: "post-merge",
    iteration: 1,
    status: "skipped",
    repairRecommended: false,
    findings: [],
    requestedActions: [],
    reviewer: { skipped: true, reason },
  });
}

export async function runWorldImportModelPrompt(options: WorldImportModelPromptOptions): Promise<WorldImportModelPromptResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const packageRoot = resolve(options.packageRoot ?? defaultPackageRoot());
  const helperCommand = helperCommandFor(cwd, packageRoot);
  const { agentDir, authPath, modelsPath } = resolvePiRuntimePaths({ cwd, authFile: options.authFile });
  status(options, `cwd=${cwd}`);
  status(options, `packageRoot=${packageRoot}`);
  status(options, `input=${resolve(options.input)}`);
  status(options, `output=${resolve(options.outputRoot)}`);
  status(options, `agentDir=${agentDir}`);
  status(options, `helperCommand=${helperCommand}`);
  status(options, `authPath=${authPath} (${existsSync(authPath) ? "exists" : "missing"})`);
  status(options, `modelsPath=${modelsPath} (${existsSync(modelsPath) ? "exists" : "missing"})`);
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, packages: [packageRoot] });
  status(options, "loading world-import skill");
  const skill = worldImportSkill(packageRoot);
  status(options, `loaded skill ${skill.name} from ${skill.filePath}`);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: (current) => ({ skills: [...current.skills, skill], diagnostics: current.diagnostics }),
  });
  await resourceLoader.reload();
  status(options, `resource loader ready; creating ${stageLabel(options.stage ?? "full")} session`);

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    thinkingLevel: options.thinking ?? "low",
  });

  try {
    status(options, `session created; initial model=${isUsableModel(session.model) ? modelLabel(session.model) : "none"}; thinking=${session.thinkingLevel}`);
    if (options.model) {
      status(options, `resolving requested model=${options.model}`);
      await session.setModel(requireResolvedModel(options.model, session.modelRegistry));
    }
    if (options.thinking) session.setThinkingLevel(options.thinking);
    if (!isUsableModel(session.model)) throw new Error("No usable model selected. Pass --model provider/model or configure a default pi model.");
    status(options, `active model=${modelLabel(session.model)}; thinking=${session.thinkingLevel}`);

    let responseText = "";
    let thinkingStarted = false;
    let currentAssistantMessageHadText = false;
    const debugTools = options.debug?.enabled;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") currentAssistantMessageHadText = false;
      if (event.type === "message_update") {
        const messageEvent = event.assistantMessageEvent;
        if (messageEvent.type === "text_delta") {
          currentAssistantMessageHadText = true;
          responseText += messageEvent.delta;
          options.onText?.(messageEvent.delta);
        } else if (messageEvent.type === "thinking_delta" && options.debug?.showThinking) {
          if (!thinkingStarted) {
            thinkingStarted = true;
            options.onThinking?.("\n[world-import thinking]\n");
          }
          options.onThinking?.(messageEvent.delta);
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        const finalized = finalizeAssistantMessageForCli(responseText, currentAssistantMessageHadText);
        if (finalized !== responseText) {
          responseText = finalized;
          options.onText?.("\n");
        }
        currentAssistantMessageHadText = false;
      }
      if (debugTools && event.type === "tool_execution_start") {
        options.onToolEvent?.(`\n[world-import tool/start] ${event.toolName} ${stringifyForLog(event.args)}\n`);
      }
      if (debugTools && options.debug?.showToolUpdates && event.type === "tool_execution_update") {
        options.onToolEvent?.(`\n[world-import tool/update] ${stringifyForLog(eventRecord(event))}\n`);
      }
      if (debugTools && event.type === "tool_execution_end") {
        const record = eventRecord(event);
        options.onToolEvent?.(`\n[world-import tool/end] ${event.toolName} ${event.isError ? "error" : "ok"} ${stringifyForLog(record.details ?? record.result ?? record, 8000)}\n`);
      }
    });
    try {
      const prompt = renderWorldImportSkillInvocation({ ...options, helperCommand, stage: options.stage ?? "full" });
      status(options, `prompt=${prompt}`);
      status(options, `invoking ${stageLabel(options.stage ?? "full")} model/skill`);
      await session.prompt(prompt);
      status(options, `${stageLabel(options.stage ?? "full")} model/skill run completed`);
    } finally {
      unsubscribe();
    }
    const outputSummary = await inspectWorldImportOutput(options.outputRoot);
    status(options, `output summary=${JSON.stringify(outputSummary)}`);
    return { responseText, model: modelLabel(session.model), outputRoot: options.outputRoot, outputSummary };
  } finally {
    status(options, `disposing ${stageLabel(options.stage ?? "full")} session`);
    session.dispose();
  }
}

export async function runWorldImportSkillWithRunners(options: WorldImportRunOptions, deps: WorldImportRunnerDeps = defaultRunnerDeps): Promise<WorldImportRunResult> {
  const sessionStrategy = options.sessionStrategy ?? "staged";
  const stages: WorldImportStageResult[] = [];

  if (sessionStrategy === "single") {
    status(options, "starting full session");
    const full = await deps.runModelPrompt({ ...options, stage: "full" });
    stages.push({ stage: "full", model: full.model, responseText: full.responseText, outputSummary: full.outputSummary });
    status(options, `full session completed; worldMarkdownFiles=${full.outputSummary.worldMarkdownFiles}`);
    const checkpoint = await writeSkippedPostMergeCheckpoint(options.outputRoot, "single-session mode has no orchestrator-visible merge boundary");
    stages.push({ stage: "post-merge-review", checkpoint });
    return { ...full, sessionStrategy, stages };
  }

  status(options, "starting stage extract session");
  const extract = await deps.runModelPrompt({ ...options, stage: "extract" });
  stages.push({ stage: "extract", model: extract.model, responseText: extract.responseText, outputSummary: extract.outputSummary });
  status(options, `extract session completed; extractionStages=${extract.outputSummary.extractionStages}; normalizedUnits=${extract.outputSummary.normalizedUnits}`);

  if (options.dryRun) {
    status(options, "dry-run requested; stopping after extract stage");
    return { ...extract, sessionStrategy, stages };
  }

  if (extract.outputSummary.extractionStages === 0) {
    throw new Error("extract session completed but produced no extraction stage files");
  }

  status(options, "starting stage merge session");
  let latestOutput: WorldImportModelPromptResult;
  let mergeWorkerError: unknown;
  try {
    const merge = await deps.runModelPrompt({ ...options, stage: "merge" });
    latestOutput = merge;
    stages.push({ stage: "merge", model: merge.model, responseText: merge.responseText, outputSummary: merge.outputSummary });
    status(options, `merge session completed; worldMarkdownFiles=${merge.outputSummary.worldMarkdownFiles}; mergeStageExists=${merge.outputSummary.mergeStageExists}`);
  } catch (error) {
    mergeWorkerError = error;
    const outputSummary = await inspectWorldImportOutput(options.outputRoot);
    latestOutput = { responseText: error instanceof Error ? error.message : String(error), outputRoot: options.outputRoot, outputSummary };
    stages.push({ stage: "merge", responseText: latestOutput.responseText, outputSummary });
    status(options, `merge worker failed; assessing durable output: ${latestOutput.responseText}`);
  }

  const stagedReviewEnabled = options.stagedReview?.enabled ?? true;
  const maxRepairIterations = options.stagedReview?.maxRepairIterations ?? 1;
  const readinessAssessor = deps.assessMergeReadiness ?? (async (outputRoot: string, iteration: number, reportedSummary?: WorldImportOutputSummary): Promise<MergeReadinessAssessment> => {
    const outputSummary = reportedSummary ?? await inspectWorldImportOutput(outputRoot);
    const ready = outputSummary.mergeStageExists && outputSummary.worldMarkdownFiles > 0;
    const checkpoint: StagedReviewCheckpoint = {
      version: 1, kind: "post-merge-review", checkpointId: "merge-readiness", iteration, createdAt: new Date().toISOString(), outputRoot,
      status: ready ? "no-action" : "repair-requested", repairRecommended: !ready,
      findings: ready ? [] : [{ id: `readiness-${iteration}`, severity: "repair", category: "other", summary: "Merge stage or emitted Markdown is missing." }],
      requestedActions: ready ? [] : [{ id: `repair-merge-readiness-${iteration}`, type: "other", severity: "repair", summary: "Resume the merge, persist artifacts, emit, and lint.", confidence: "high", rereadSource: false }],
      reviewer: { skipped: true, reason: "reported output summary fallback" },
    };
    return { ready, fingerprint: ready ? "ready" : `${outputSummary.mergeStageExists}:${outputSummary.worldMarkdownFiles}`, checkpoint, outputSummary };
  });

  let readinessIteration = 1;
  let readiness = await readinessAssessor(options.outputRoot, readinessIteration, latestOutput.outputSummary);
  stages.push({ stage: "merge-readiness", checkpoint: readiness.checkpoint, outputSummary: readiness.outputSummary, deterministicPassed: readiness.ready });
  latestOutput = { ...latestOutput, outputSummary: readiness.outputSummary };
  let previousFingerprint = readiness.fingerprint;
  let lastWorkerError = mergeWorkerError;
  let recoveryAttempts = 0;
  while (!readiness.ready && recoveryAttempts < maxRepairIterations) {
    const reviewPacket = checkpointReviewPath(options.outputRoot, "merge-readiness", readinessIteration);
    status(options, `merge is not ready; starting bounded recovery ${recoveryAttempts + 1}/${maxRepairIterations}; packet=${reviewPacket}`);
    let repair: WorldImportModelPromptResult;
    try {
      repair = await deps.runModelPrompt({ ...options, stage: "repair", checkpointId: "merge-readiness", reviewPacket, iteration: readinessIteration });
      lastWorkerError = undefined;
    } catch (error) {
      lastWorkerError = error;
      const outputSummary = await inspectWorldImportOutput(options.outputRoot);
      repair = { responseText: error instanceof Error ? error.message : String(error), outputRoot: options.outputRoot, outputSummary };
      status(options, `merge recovery worker failed; reassessing durable output: ${repair.responseText}`);
    }
    latestOutput = repair;
    stages.push({ stage: "repair", model: repair.model, responseText: repair.responseText, outputSummary: repair.outputSummary });
    recoveryAttempts++;
    readinessIteration++;
    readiness = await readinessAssessor(options.outputRoot, readinessIteration, repair.outputSummary);
    stages.push({ stage: "merge-readiness", checkpoint: readiness.checkpoint, outputSummary: readiness.outputSummary, deterministicPassed: readiness.ready });
    latestOutput = { ...latestOutput, outputSummary: readiness.outputSummary };
    if (!readiness.ready && readiness.fingerprint === previousFingerprint) {
      const cause = lastWorkerError ? `; last worker error: ${lastWorkerError instanceof Error ? lastWorkerError.message : String(lastWorkerError)}` : "";
      throw new Error(`merge stalled after recovery attempt ${recoveryAttempts}: deterministic readiness diagnostics did not change (fingerprint ${readiness.fingerprint})${cause}`);
    }
    previousFingerprint = readiness.fingerprint;
  }
  if (!readiness.ready) {
    const cause = lastWorkerError ? `; last worker error: ${lastWorkerError instanceof Error ? lastWorkerError.message : String(lastWorkerError)}` : "";
    throw new Error(`merge is not ready after ${recoveryAttempts + 1} model attempt(s); deterministic recovery budget exhausted${cause}`);
  }
  status(options, `merge readiness passed after ${recoveryAttempts + 1} model attempt(s)`);
  const checkpointId = "post-merge";
  let checkpoint: StagedReviewCheckpoint;
  if (!stagedReviewEnabled) {
    checkpoint = await writeSkippedPostMergeCheckpoint(options.outputRoot, "staged review disabled");
  } else if (!options.reviewerModel) {
    checkpoint = await writeSkippedPostMergeCheckpoint(options.outputRoot, "no reviewer model configured");
  } else {
    status(options, "starting post-merge review checkpoint");
    checkpoint = await (deps.runPostMergeReview ?? runPostMergeReviewEvaluation)({
      cwd: options.cwd,
      authFile: options.authFile,
      outputRoot: options.outputRoot,
      reviewerModel: options.reviewerModel,
      debug: options.debug,
      onStatus: options.onStatus,
      onThinking: options.onThinking,
      onToolEvent: options.onToolEvent,
      checkpointId,
      iteration: 1,
    });
  }
  const checkpointWithBaselines = await attachPreRepairArtifactHashes(options.outputRoot, checkpoint);
  if (checkpointWithBaselines !== checkpoint) checkpoint = await writePostMergeReviewResult(options.outputRoot, checkpointWithBaselines);
  else checkpoint = checkpointWithBaselines;
  const checkpointStageIndex = stages.push({ stage: "post-merge-review", checkpoint }) - 1;
  status(options, `post-merge review checkpoint completed; ${summarizeCheckpoint(checkpoint)}`);

  if (checkpoint.status === "repair-requested" && checkpoint.requestedActions.length > 0) {
    if (maxRepairIterations < 1) {
      checkpoint = await writePostMergeReviewResult(options.outputRoot, { ...checkpoint, status: "residual", repairRecommended: true, createdAt: new Date().toISOString() });
      stages[checkpointStageIndex] = { stage: "post-merge-review", checkpoint };
      status(options, "post-merge repair skipped; max repair iterations exhausted before repair");
    } else {
      const reviewPacket = checkpointReviewPath(options.outputRoot, checkpointId, checkpoint.iteration);
      status(options, `starting repair stage for ${checkpoint.requestedActions.length} requested action(s)`);
      let repair: WorldImportModelPromptResult;
      let semanticRepairWorkerError: unknown;
      try {
        repair = await deps.runModelPrompt({ ...options, stage: "repair", checkpointId, reviewPacket, iteration: checkpoint.iteration });
      } catch (error) {
        semanticRepairWorkerError = error;
        const outputSummary = await inspectWorldImportOutput(options.outputRoot);
        repair = { responseText: error instanceof Error ? error.message : String(error), outputRoot: options.outputRoot, outputSummary };
        status(options, `post-merge repair worker failed; reassessing durable output: ${repair.responseText}`);
      }
      latestOutput = repair;
      stages.push({ stage: "repair", model: repair.model, responseText: repair.responseText, outputSummary: repair.outputSummary });
      await writeStagedRepairSummary(options.outputRoot, {
        version: 1,
        kind: "post-merge-repair",
        checkpointId,
        iteration: checkpoint.iteration,
        createdAt: new Date().toISOString(),
        outputRoot: options.outputRoot,
        status: "repair-attempted",
        reviewPacketPath: reviewPacket,
        requestedActionIds: checkpoint.requestedActions.map((action) => action.id),
        responseText: repair.responseText,
        outputSummary: repair.outputSummary,
        residualFindings: checkpoint.findings,
      });
      readinessIteration++;
      const postRepairReadiness = await readinessAssessor(options.outputRoot, readinessIteration, repair.outputSummary);
      stages.push({ stage: "merge-readiness", checkpoint: postRepairReadiness.checkpoint, outputSummary: postRepairReadiness.outputSummary, deterministicPassed: postRepairReadiness.ready });
      latestOutput = { ...latestOutput, outputSummary: postRepairReadiness.outputSummary };
      if (!postRepairReadiness.ready) {
        const cause = semanticRepairWorkerError ? `; worker error: ${semanticRepairWorkerError instanceof Error ? semanticRepairWorkerError.message : String(semanticRepairWorkerError)}` : "";
        throw new Error(`post-merge semantic repair left deterministic blockers (fingerprint ${postRepairReadiness.fingerprint})${cause}`);
      }
      const verification = await verifyPostMergeRepair(options.outputRoot, checkpoint);
      await writeStagedRepairVerification(options.outputRoot, verification);
      checkpoint = await writePostMergeReviewResult(options.outputRoot, { ...checkpoint, status: verification.status, createdAt: new Date().toISOString() });
      stages[checkpointStageIndex] = { stage: "post-merge-review", checkpoint };
      stages.push({ stage: "post-merge-verify", verification });
      status(options, `repair stage completed; worldMarkdownFiles=${postRepairReadiness.outputSummary.worldMarkdownFiles}; mergeStageExists=${postRepairReadiness.outputSummary.mergeStageExists}; verification=${verification.status}`);
    }
  }

  if (!options.reviewerModel) {
    status(options, "final review stage skipped; reviewer model disabled");
    return { ...latestOutput, sessionStrategy, stages };
  }

  status(options, "starting stage review session");
  const review = await deps.runReviewerEvaluation({
    cwd: options.cwd,
    authFile: options.authFile,
    outputRoot: options.outputRoot,
    reviewerModel: options.reviewerModel,
    debug: options.debug,
    onStatus: options.onStatus,
    onThinking: options.onThinking,
    onToolEvent: options.onToolEvent,
  });
  stages.push({ stage: "review", reviewer: review.reviewer, deterministicPassed: review.deterministic.passed });
  status(options, `review session completed; ${summarizeReviewResult(review)}`);

  return { ...latestOutput, sessionStrategy, stages };
}

export async function runWorldImportSkill(options: WorldImportRunOptions): Promise<WorldImportRunResult> {
  return runWorldImportSkillWithRunners(options, defaultRunnerDeps);
}
