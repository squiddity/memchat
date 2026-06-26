import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { manifestPath, mergedCandidatesPath, readManifest, readMergeStage, writeJson } from "./staging.js";
import { requireResolvedModel } from "../model-selection.js";
import type { EvaluationResult } from "./types.js";

async function countMarkdownFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) count += await countMarkdownFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

export async function deterministicWorldImportChecks(outputRoot: string): Promise<EvaluationResult["deterministic"]> {
  const checks: EvaluationResult["deterministic"]["checks"] = [];
  checks.push({ name: "manifest exists", passed: existsSync(manifestPath(outputRoot)) });
  checks.push({ name: "merge stage exists", passed: existsSync(mergedCandidatesPath(outputRoot)) });
  try {
    const manifest = await readManifest(outputRoot);
    checks.push({ name: "manifest has normalized units", passed: manifest.units.length > 0, message: `${manifest.units.length} unit(s)` });
  } catch (error) {
    checks.push({ name: "manifest parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }
  try {
    const merge = await readMergeStage(outputRoot);
    checks.push({ name: "merge has artifact packets", passed: (merge.artifacts?.length ?? 0) > 0, message: `${merge.artifacts?.length ?? 0} artifact(s)` });
  } catch (error) {
    checks.push({ name: "merge parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }
  const markdownCount = await countMarkdownFiles(join(outputRoot, "world"));
  checks.push({ name: "world markdown emitted", passed: markdownCount > 0, message: `${markdownCount} markdown file(s)` });
  return { passed: checks.every((check) => check.passed), checks };
}

async function reviewBundle(outputRoot: string): Promise<string> {
  const manifest = await readManifest(outputRoot);
  const merge = await readMergeStage(outputRoot);
  const worldRoot = join(outputRoot, "world");
  const markdown: Record<string, string> = {};
  if (existsSync(worldRoot)) {
    for (const group of ["people", "places", "things", "facts"]) {
      const groupDir = join(worldRoot, group);
      if (!existsSync(groupDir)) continue;
      for (const file of (await readdir(groupDir)).filter((name) => name.endsWith(".md")).slice(0, 20)) {
        markdown[`${group}/${file}`] = await readFile(join(groupDir, file), "utf-8");
      }
    }
  }
  return JSON.stringify({ manifest, merge, markdown }, null, 2);
}

function parseReviewerScore(text: string): number | undefined {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { score?: unknown };
      if (typeof parsed.score === "number") return parsed.score;
    } catch {
      // Reviewer prose is still useful; score is optional.
    }
  }
  const match = text.match(/score\D+(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
}

export async function runReviewerModelEvaluation(options: { outputRoot: string; reviewerModel?: string; cwd?: string }): Promise<EvaluationResult> {
  const deterministic = await deterministicWorldImportChecks(options.outputRoot);
  if (!options.reviewerModel) return writeEvaluationResult(options.outputRoot, { skipped: true, reason: "no reviewer model configured" });
  if (!deterministic.passed) return writeEvaluationResult(options.outputRoot, { model: options.reviewerModel, skipped: true, reason: "deterministic checks failed" });

  const cwd = resolve(options.cwd ?? process.cwd());
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(resolve(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, resolve(agentDir, "models.json"));
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    systemPrompt: "You are a world-import reviewer. Score semantic output quality against source/provenance evidence. Return concise JSON with score and notes.",
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "builtin",
    thinkingLevel: "off",
  });
  let notes = "";
  try {
    await session.setModel(requireResolvedModel(options.reviewerModel, session.modelRegistry));
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") notes += event.assistantMessageEvent.delta;
    });
    try {
      await session.prompt(JSON.stringify({
        task: "score world import output from 1-5 for recall, deduplication, provenance correctness, conflict visibility, and artifact usefulness",
        outputRoot: options.outputRoot,
        bundle: JSON.parse(await reviewBundle(options.outputRoot)),
      }));
    } finally {
      unsubscribe();
    }
  } catch (error) {
    return writeEvaluationResult(options.outputRoot, { model: options.reviewerModel, skipped: true, reason: error instanceof Error ? error.message : String(error) });
  } finally {
    session.dispose();
  }
  return writeEvaluationResult(options.outputRoot, { model: options.reviewerModel, score: parseReviewerScore(notes), notes: notes.trim() });
}

export async function writeEvaluationResult(outputRoot: string, reviewer?: EvaluationResult["reviewer"]): Promise<EvaluationResult> {
  const result: EvaluationResult = {
    version: 1,
    createdAt: new Date().toISOString(),
    outputRoot,
    deterministic: await deterministicWorldImportChecks(outputRoot),
    reviewer,
  };
  await writeJson(join(outputRoot, "stages", "review.json"), result);
  return result;
}
