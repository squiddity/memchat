import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SourceManifest, WorldImportInvocation, WorldImportInvocationPrompt, WorldImportRunAudit, WorldImportRunStatus } from "./types.js";

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[-:.]/g, "").replace("Z", "Z")}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function credentialConfiguration(authFile?: string): "explicit-auth-file" | "project-default" {
  return authFile ? "explicit-auth-file" : "project-default";
}

export function canonicalSkillInvocation(options: {
  input: string;
  reviewerModel?: string;
  dryRun?: boolean;
  stage?: string;
  checkpointId?: string;
  iteration?: number;
}): string {
  return `/skill:world-import ${JSON.stringify({
    input: basename(options.input),
    output: "<output-root>",
    reviewerModel: options.reviewerModel,
    dryRun: options.dryRun ?? false,
    ...(options.stage && options.stage !== "full" ? { stage: options.stage } : {}),
    ...(options.stage === "repair" ? { checkpointId: options.checkpointId, iteration: options.iteration } : {}),
  })}`;
}

export function skillPromptDescriptor(exactPrompt: string, options: Parameters<typeof canonicalSkillInvocation>[0]): WorldImportInvocationPrompt {
  return {
    kind: "world-import-skill",
    canonical: canonicalSkillInvocation(options),
    promptSha256: sha256(exactPrompt),
    promptChars: exactPrompt.length,
  };
}

export function generatedPromptDescriptor(promptBuilder: string, prompt: string): WorldImportInvocationPrompt {
  return {
    kind: "generated-review",
    promptBuilder,
    promptSha256: sha256(prompt),
    promptChars: prompt.length,
  };
}

export function initialImportRunAudit(options: {
  input: string;
  sessionStrategy: "single" | "staged";
  dryRun?: boolean;
  maxRepairIterations: number;
  authFile?: string;
  packageVersion?: string;
  skillHash?: string;
}): WorldImportRunAudit {
  const startedAt = new Date().toISOString();
  return {
    version: 1,
    kind: "world-import-run",
    runId: createRunId(),
    status: "running",
    startedAt,
    source: { name: basename(options.input) },
    workflow: {
      sessionStrategy: options.sessionStrategy,
      dryRun: options.dryRun ?? false,
      maxRepairIterations: options.maxRepairIterations,
    },
    software: {
      ...(options.packageVersion ? { packageVersion: options.packageVersion } : {}),
      ...(options.skillHash ? { worldImportSkillHash: options.skillHash } : {}),
      promptContractVersion: 1,
    },
    credentials: { configuration: credentialConfiguration(options.authFile) },
    invocations: [],
  };
}

export function beginInvocation(audit: WorldImportRunAudit, input: Omit<WorldImportInvocation, "id" | "status" | "startedAt">): WorldImportInvocation {
  const invocation: WorldImportInvocation = {
    ...input,
    id: `invocation-${String(audit.invocations.length + 1).padStart(2, "0")}`,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  audit.invocations.push(invocation);
  return invocation;
}

export function finishInvocation(invocation: WorldImportInvocation, details: {
  status: Extract<WorldImportInvocation["status"], "completed" | "failed" | "skipped">;
  resolvedModel?: string;
  thinking?: string;
  responseText?: string;
  outputSummaryAfter?: WorldImportInvocation["outputSummaryAfter"];
  error?: string;
}): void {
  const completedAt = new Date().toISOString();
  invocation.status = details.status;
  invocation.completedAt = completedAt;
  invocation.durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(invocation.startedAt));
  if (details.resolvedModel) invocation.resolvedModel = details.resolvedModel;
  if (details.thinking) invocation.thinking = details.thinking;
  if (details.responseText !== undefined) {
    invocation.responseSha256 = sha256(details.responseText);
    invocation.responseChars = details.responseText.length;
  }
  if (details.outputSummaryAfter) invocation.outputSummaryAfter = details.outputSummaryAfter;
  if (details.error) invocation.error = sanitizeAuditText(details.error);
}

export function sanitizeAuditText(value: string): string {
  return value
    .replace(/(?:\/[^\s:]+)+/g, "<path>")
    .replace(/(?:sk|gho|AIza|Bearer)[_ -]?[A-Za-z0-9._-]{8,}/gi, "<redacted>")
    .slice(0, 500);
}

export async function manifestSourceIdentity(outputRoot: string): Promise<Pick<WorldImportRunAudit["source"], "contentHash" | "normalizedUnits">> {
  try {
    const manifest = JSON.parse(await readFile(join(outputRoot, "sources", "manifest.json"), "utf-8")) as SourceManifest;
    const hashes = manifest.units.map((unit) => unit.contentHash).sort().join("\n");
    return { ...(hashes ? { contentHash: sha256(hashes) } : {}), normalizedUnits: manifest.units.length };
  } catch {
    return {};
  }
}

export async function packageAuditMetadata(packageRoot: string): Promise<{ packageVersion?: string; skillHash?: string }> {
  try {
    const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf-8")) as { version?: unknown };
    const skillFiles = [
      join(packageRoot, "skills", "world-import", "SKILL.md"),
      join(packageRoot, "skills", "world-import", "references", "workflow.md"),
      join(packageRoot, "skills", "world-import", "references", "contracts.md"),
      join(packageRoot, "skills", "world-import", "references", "artifact-format.md"),
      join(packageRoot, "skills", "world-import", "references", "helper-tools.md"),
    ];
    const contents = await Promise.all(skillFiles.map((path) => readFile(path, "utf-8")));
    return { ...(typeof pkg.version === "string" ? { packageVersion: pkg.version } : {}), skillHash: sha256(contents.join("\n\u0000\n")) };
  } catch {
    return {};
  }
}

export function terminalAuditStatus(options: { dryRun?: boolean; failed?: boolean }): WorldImportRunStatus {
  if (options.failed) return "failed";
  return options.dryRun ? "dry-run-completed" : "completed";
}
