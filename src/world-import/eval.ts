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
import { manifestPath, mergedCandidatesPath, readManifest, readMergeStage, readNormalizedUnit, writeJson } from "./staging.js";
import { requireResolvedModel } from "../model-selection.js";
import type { EvaluationResult, ReviewBundle, ReviewerDimensionScore } from "./types.js";

const MAX_SOURCE_CHARS = 60_000; // total source text budget for the review bundle
const MAX_UNIT_CHARS = 12_000;   // per-unit cap so no single unit dominates
const QA_QUESTION_COUNT = 5;     // number of QA questions to generate/answer

async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

async function countMarkdownFiles(dir: string): Promise<number> {
  return (await listMarkdownFiles(dir)).length;
}

function hasRequiredFrontmatter(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return false;
  return /(^|\n)type: .+/m.test(match[1]) && /(^|\n)description: .+/m.test(match[1]);
}

function sourceLinkTargets(content: string): string[] {
  return [...content.matchAll(/\((\/sources\/units\/[^)#]+\.md#b\d{4})\)/g)].map((match) => match[1]);
}

export async function deterministicWorldImportChecks(outputRoot: string): Promise<EvaluationResult["deterministic"]> {
  const checks: EvaluationResult["deterministic"]["checks"] = [];
  checks.push({ name: "manifest exists", passed: existsSync(manifestPath(outputRoot)) });
  checks.push({ name: "merge stage exists", passed: existsSync(mergedCandidatesPath(outputRoot)) });

  let manifestUnits = 0;
  try {
    const manifest = await readManifest(outputRoot);
    manifestUnits = manifest.units.length;
    checks.push({ name: "manifest has normalized units", passed: manifest.units.length > 0, message: `${manifest.units.length} unit(s)` });
  } catch (error) {
    checks.push({ name: "manifest parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }

  let artifactCount = 0;
  try {
    const merge = await readMergeStage(outputRoot);
    artifactCount = merge.artifacts?.length ?? 0;
    checks.push({ name: "merge has artifact packets", passed: artifactCount > 0, message: `${artifactCount} artifact(s)` });
  } catch (error) {
    checks.push({ name: "merge parses", passed: false, message: error instanceof Error ? error.message : String(error) });
  }

  const worldRoot = join(outputRoot, "world");
  const markdownCount = await countMarkdownFiles(worldRoot);
  checks.push({ name: "world markdown emitted", passed: markdownCount > 0, message: `${markdownCount} markdown file(s)` });

  const conceptFiles: string[] = [];
  for (const group of ["people", "places", "things", "facts"]) {
    const groupDir = join(worldRoot, group);
    if (!existsSync(groupDir)) continue;
    const groupFiles = (await readdir(groupDir)).filter((name) => name.endsWith(".md") && name !== "index.md").map((name) => join(groupDir, name));
    conceptFiles.push(...groupFiles);
    if (groupFiles.length > 0) checks.push({ name: `${group} index exists`, passed: existsSync(join(groupDir, "index.md")) });
  }

  checks.push({ name: "root index exists", passed: existsSync(join(worldRoot, "index.md")) });
  checks.push({ name: "sources index exists", passed: existsSync(join(worldRoot, "sources", "index.md")) });
  checks.push({ name: "coverage exists", passed: existsSync(join(worldRoot, "coverage.md")) });
  checks.push({ name: "log exists", passed: existsSync(join(worldRoot, "log.md")) });

  if (conceptFiles.length > 0) {
    const conceptContents = await Promise.all(conceptFiles.map((path) => readFile(path, "utf-8")));
    checks.push({
      name: "concept frontmatter includes type and description",
      passed: conceptContents.every((content) => hasRequiredFrontmatter(content)),
      message: `${conceptFiles.length} concept file(s) checked`,
    });

    const targets = conceptContents.flatMap((content) => sourceLinkTargets(content));
    const unresolved: string[] = [];
    for (const target of targets) {
      const [pathPart, anchor] = target.split("#");
      const file = join(worldRoot, pathPart.replace(/^\//, ""));
      if (!existsSync(file)) {
        unresolved.push(target);
        continue;
      }
      const content = await readFile(file, "utf-8");
      if (!content.includes(`## ${anchor}`)) unresolved.push(target);
    }
    checks.push({
      name: "provenance source-target resolvability",
      passed: targets.length > 0 && unresolved.length === 0,
      message: targets.length > 0 ? `${targets.length - unresolved.length}/${targets.length} resolved` : "no source links found",
    });
  }

  if (manifestUnits > 0) checks.push({ name: "retained source pages emitted", passed: existsSync(join(worldRoot, "sources", "units")), message: `${manifestUnits} manifest unit(s)` });
  if (artifactCount > 0) checks.push({ name: "concept pages emitted", passed: conceptFiles.length > 0, message: `${conceptFiles.length} concept page(s)` });

  return { passed: checks.every((check) => check.passed), checks };
}

/**
 * Build a rich review bundle that includes:
 * - The source manifest
 * - Normalized source text (budgeted to MAX_SOURCE_CHARS)
 * - The merged artifact packets
 * - The emitted markdown artifacts
 */
async function buildReviewBundle(outputRoot: string): Promise<ReviewBundle> {
  const manifest = await readManifest(outputRoot);
  const merge = await readMergeStage(outputRoot);

  // Read normalized source units, respecting character budgets
  const sources: ReviewBundle["sources"] = [];
  let totalChars = 0;
  for (const entry of manifest.units) {
    if (totalChars >= MAX_SOURCE_CHARS) break;
    try {
      const unit = await readNormalizedUnit(outputRoot, entry.unitId);
      const content = unit.content.slice(0, Math.min(MAX_UNIT_CHARS, MAX_SOURCE_CHARS - totalChars));
      sources.push({ unitId: unit.unitId, sourceId: unit.sourceId, title: unit.title, order: unit.order, content });
      totalChars += content.length;
    } catch {
      // skip if a unit file is missing — still proceed with what we have
    }
  }

  // Read markdown artifacts (up to 20 per group)
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

  return { manifest, sources, merge, markdown };
}

function parseDimensionScores(text: string): ReviewerDimensionScore[] | undefined {
  // Look for the structured JSON output block
  const jsonStart = text.lastIndexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) return undefined;
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { dimensionScores?: ReviewerDimensionScore[] };
    if (Array.isArray(parsed.dimensionScores) && parsed.dimensionScores.length > 0) {
      return parsed.dimensionScores.filter(
        (d) => typeof d.dimension === "string" && typeof d.score === "number" && typeof d.justification === "string"
      );
    }
  } catch {
    // Structured parsing is optional; fall through to regex extraction
  }
  return undefined;
}

type ReviewerEval = NonNullable<EvaluationResult["reviewer"]>;

function parseQAResults(text: string): ReviewerEval["qaResults"] | undefined {
  const jsonStart = text.lastIndexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) return undefined;
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { qaResults?: ReviewerEval["qaResults"] };
    if (Array.isArray(parsed.qaResults) && parsed.qaResults.length > 0) return parsed.qaResults;
  } catch {
    // optional
  }
  return undefined;
}

function parseReconstructionSummary(text: string): string | undefined {
  // Look for a block between ### Reconstruction Summary and the next ### or end
  const match = text.match(/### Reconstruction Summary\n\n([\s\S]*?)(?=\n### |\n## |\n---|$)/);
  return match?.[1]?.trim();
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

/**
 * Build the structured reviewer prompt with:
 * 1. Reconstruction task — use world artifacts to write a narrative summary, compare to source
 * 2. QA task — answer questions about the source using only the artifacts
 * 3. Dimension scoring — per-dimension scores + evidence
 */
function buildReviewerPrompt(bundle: ReviewBundle): string {
  const sourceOverview = bundle.manifest.units
    .map((u, i) => `${i + 1}. ${u.title || u.unitId} (${u.blockCount} blocks)`)
    .join("\n");

  const sourceSample = bundle.sources
    .map((s) => `=== UNIT: ${s.title || s.unitId} (order ${s.order}) ===\n\n${s.content}`)
    .join("\n\n");

  const artifactCount = bundle.merge.artifacts?.length ?? 0;
  const groupCounts = bundle.merge.artifacts?.reduce<Record<string, number>>((acc, a) => {
    acc[a.group] = (acc[a.group] || 0) + 1;
    return acc;
  }, {}) ?? {};
  const groupSummary = Object.entries(groupCounts)
    .map(([g, c]) => `${c} ${g}`)
    .join(", ");

  const markdownEntries = Object.entries(bundle.markdown);
  const markdownBlock = markdownEntries.length > 0
    ? markdownEntries.map(([path, content]) => `--- ${path} ---\n${content}`).join("\n\n")
    : "(no markdown artifacts)";

  // Generate questions from source content for the QA task
  const questions = generateQaQuestions(bundle.sources);

  return `You are a world-import quality reviewer. Assess how well the world artifacts capture the source material.

## Source Overview

The source corpus has ${bundle.manifest.units.length} unit(s) in this order:

${sourceOverview}

## Normalized Source Text (${bundle.sources.length} units shown)

${sourceSample}

## Merged Artifact Summary

${artifactCount} artifact(s) total: ${groupSummary}

## World Markdown Artifacts (${markdownEntries.length} files shown)

${markdownBlock}

---

## Review Tasks

### Task 1: Reconstruction

Using ONLY the world artifacts above (not the raw source text), write a narrative summary of the source material. Describe the characters, places, events, and plot as they appear in the artifacts. After your reconstruction summary, note what is MISSING or INACCURATE compared to the actual source text above.

### Task 2: Question Answering

Answer these questions about the source material using ONLY the world artifacts:

${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

For each question, state:
- Whether it can be answered from the artifacts (answerable: yes/no/partial)
- The answer if answerable
- Confidence: high / medium / low

### Task 3: Dimension Scoring

Score the world library 1-5 (5 = best) on each dimension:

1. **entityRecall** — Are important characters, places, things, and events represented?
2. **detailRichness** — Do artifacts have meaningful detail (descriptions, traits, narrative context) or are they too brief?
3. **sourceCoverage** — Do artifacts span the key narrative content? Can you reconstruct the story?
4. **provenance** — Are source span references and quotes accurate and useful?
5. **mergeQuality** — Are aliases handled? Is detail preserved rather than over-summarized across sources?
6. **answerability** — Can someone answer substantive questions about the source using only the artifacts?
7. **navigability** — Do indexes, summaries, and links make the bundle easy to browse?
8. **progressiveDisclosure** — Do artifacts balance concise top-level summaries with richer detail below?
9. **duplicateNarrativeControl** — Do entity/place artifacts summarize linked events instead of repeating full event narratives unnecessarily?
10. **citationReconstructability** — Can a reader follow emitted provenance links to retained source-unit pages inside the bundle?

Provide evidence from the artifacts and source text for each score.

---

Return your results as a JSON object at the very end of your response with this exact structure:

\`\`\`json
{
  "score": <overall 1-5>,
  "dimensionScores": [
    {"dimension": "entityRecall", "score": <1-5>, "justification": "..."},
    {"dimension": "detailRichness", "score": <1-5>, "justification": "..."},
    {"dimension": "sourceCoverage", "score": <1-5>, "justification": "..."},
    {"dimension": "provenance", "score": <1-5>, "justification": "..."},
    {"dimension": "mergeQuality", "score": <1-5>, "justification": "..."},
    {"dimension": "answerability", "score": <1-5>, "justification": "..."}
  ],
  "qaResults": [
    {"question": "...", "answerable": true, "answer": "...", "confidence": "high|medium|low"}
  ]
}
\`\`\`
`;
}

/**
 * Generate a diverse set of questions from the source text for QA evaluation.
 * Questions target characters, places, events, and narrative details.
 */
function generateQaQuestions(sources: ReviewBundle["sources"]): string[] {
  const allText = sources.map((s) => s.content).join("\n\n");
  const words = allText.split(/\s+/).filter(Boolean);

  // Extract candidate person-like names (capitalized words that appear multiple times, not at sentence start)
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    const cleaned = word.replace(/[^a-zA-Z]/g, "");
    if (cleaned.length >= 2 && cleaned[0] === cleaned[0].toUpperCase() && cleaned[1] === cleaned[1].toLowerCase()) {
      wordFreq.set(cleaned, (wordFreq.get(cleaned) || 0) + 1);
    }
  }
  const topNames = [...wordFreq.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  // Build a diverse set of questions
  const questions: string[] = [];

  if (topNames.length >= 1) {
    questions.push(`Describe ${topNames[0]}. Who are they, what are their characteristics, what role do they play, and what key events are they involved in?`);
  }
  if (topNames.length >= 2) {
    questions.push(`What is the relationship between ${topNames[0]} and ${topNames[1]}? What events connect them?`);
  }

  questions.push("What is the setting or locations where the narrative takes place? Describe each location's significance.");
  questions.push("What are the key events or plot points that drive the narrative forward? List them in sequence.");
  questions.push("What important objects, items, or things appear in the narrative and what is their significance?");

  // Trim to QA_QUESTION_COUNT
  return questions.slice(0, QA_QUESTION_COUNT);
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

  // Build the rich review bundle BEFORE creating the session (I/O first)
  const bundle = await buildReviewBundle(options.outputRoot);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    systemPrompt: "You are a world-import reviewer. Score semantic output quality against source/provenance evidence. Return structured JSON with dimension scores, QA results, and a reconstruction summary.",
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
      await session.prompt(buildReviewerPrompt(bundle));
    } finally {
      unsubscribe();
    }
  } catch (error) {
    return writeEvaluationResult(options.outputRoot, { model: options.reviewerModel, skipped: true, reason: error instanceof Error ? error.message : String(error) });
  } finally {
    session.dispose();
  }

  // Parse structured results from reviewer output
  const dimensionScores = parseDimensionScores(notes);
  const qaResults = parseQAResults(notes);
  const reconstructionSummary = parseReconstructionSummary(notes);
  const score = parseReviewerScore(notes);

  return writeEvaluationResult(options.outputRoot, {
    model: options.reviewerModel,
    score,
    dimensionScores,
    qaResults,
    reconstructionSummary,
    notes: notes.trim(),
  });
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
