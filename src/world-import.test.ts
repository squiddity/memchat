import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { defaultPackageRoot, finalizeAssistantMessageForCli, renderWorldImportSkillInvocation, runWorldImportSkillWithRunners, worldImportSkill } from "./world-import/model-runner.js";
import { writeExtractionStage } from "./world-import/staging.js";
import type { EvaluationResult } from "./world-import/types.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-world-router-"));
}

function helper(args: string[], input?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/world-import/command-router.ts", ...args], {
    cwd: process.cwd(),
    input,
    encoding: "utf-8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("local world-import skill is package-loadable independent of runtime cwd", () => {
  const skill = worldImportSkill(defaultPackageRoot());
  assert.equal(skill.name, "world-import");
  assert.equal(resolve(skill.filePath), resolve("skills/world-import/SKILL.md"));
});

test("world import model runner renders structured skill invocation", () => {
  const prompt = renderWorldImportSkillInvocation({ input: "/in", outputRoot: "/out", reviewerModel: "openai/gpt-4o", dryRun: true });
  assert.match(prompt, /^\/skill:world-import /);
  assert.match(prompt, /"input":"\/in"/);
  assert.match(prompt, /"dryRun":true/);
  assert.doesNotMatch(prompt, /"stage":/);
});

test("world import model runner includes stage for staged prompts", () => {
  const prompt = renderWorldImportSkillInvocation({ input: "/in", outputRoot: "/out", stage: "extract" });
  assert.match(prompt, /"stage":"extract"/);
});

test("world import model runner renders repair-stage checkpoint fields", () => {
  const prompt = renderWorldImportSkillInvocation({ input: "/in", outputRoot: "/out", stage: "repair", checkpointId: "post-merge", reviewPacket: "/out/stages/checkpoints/post-merge-01.review.json", iteration: 1 });
  assert.match(prompt, /"stage":"repair"/);
  assert.match(prompt, /"checkpointId":"post-merge"/);
  assert.match(prompt, /"reviewPacket":"\/out\/stages\/checkpoints\/post-merge-01\.review\.json"/);
  assert.match(prompt, /"iteration":1/);
});

test("world import model runner separates assistant messages for shell readability", () => {
  assert.equal(finalizeAssistantMessageForCli("Good. Chapter I extraction saved.", true), "Good. Chapter I extraction saved.\n");
  assert.equal(finalizeAssistantMessageForCli("Already newline\n", true), "Already newline\n");
  assert.equal(finalizeAssistantMessageForCli("", false), "");
});

test("extraction stage rejects candidates without operational provenance envelope", async () => {
  const output = await tempDir();
  await assert.rejects(
    writeExtractionStage(output, { version: 1, kind: "extraction", unitId: "u", candidates: [{} as never] }),
    /id must be a non-empty string/,
  );
});

test("staged world import orchestration runs extract, merge, then review", async () => {
  const calls: string[] = [];
  const reviewResult: EvaluationResult = {
    version: 1,
    createdAt: new Date().toISOString(),
    outputRoot: "/out",
    deterministic: { passed: true, checks: [] },
    reviewer: { model: "openai/gpt-4o", score: 4 },
  };
  const result = await runWorldImportSkillWithRunners({
    input: "/in",
    outputRoot: "/out",
    sessionStrategy: "staged",
    reviewerModel: "openai/gpt-4o",
  }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: "/out", outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: false, worldMarkdownFiles: 0 } };
      return { responseText: "merge ok", model: "m", outputRoot: "/out", outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: true, worldMarkdownFiles: 3 } };
    },
    runPostMergeReview: async (options) => {
      calls.push("post-merge-review");
      return { version: 1, kind: "post-merge-review", checkpointId: options.checkpointId, iteration: options.iteration, createdAt: new Date().toISOString(), outputRoot: "/out", status: "no-action", repairRecommended: false, findings: [], requestedActions: [], reviewer: { model: options.reviewerModel, parseStatus: "valid" } };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      return reviewResult;
    },
  });
  assert.deepEqual(calls, ["extract", "merge", "post-merge-review", "review"]);
  assert.equal(result.sessionStrategy, "staged");
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "post-merge-review", "review"]);
});

test("staged orchestration routes actionable post-merge review into one repair pass", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged", reviewerModel: "openai/gpt-4o" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: false, worldMarkdownFiles: 0 } };
      if (options.stage === "repair") {
        assert.equal(options.checkpointId, "post-merge");
        assert.match(options.reviewPacket ?? "", /post-merge-01\.review\.json$/);
        assert.equal(options.iteration, 1);
        return { responseText: "repair ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: true, worldMarkdownFiles: 4 } };
      }
      return { responseText: "merge ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: true, worldMarkdownFiles: 3 } };
    },
    runPostMergeReview: async (options) => {
      calls.push("post-merge-review");
      return { version: 1, kind: "post-merge-review", checkpointId: options.checkpointId, iteration: options.iteration, createdAt: new Date().toISOString(), outputRoot: output, status: "repair-requested", repairRecommended: true, findings: [{ id: "finding-1", severity: "repair", category: "object-coverage", summary: "Missing thing page for Friar Lawrence's letter." }], requestedActions: [{ id: "action-1", type: "add-artifact", severity: "repair", summary: "Add durable things artifact for the letter.", confidence: "high", rereadSource: true }] };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      return { version: 1, createdAt: new Date().toISOString(), outputRoot: output, deterministic: { passed: true, checks: [] }, reviewer: { model: "openai/gpt-4o", score: 4 } };
    },
  });
  assert.deepEqual(calls, ["extract", "merge", "post-merge-review", "repair", "review"]);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "post-merge-review", "repair", "review"]);
  assert.equal(result.outputSummary.worldMarkdownFiles, 4);
  const reviewArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.review.json"), "utf-8"));
  assert.equal(reviewArtifact.status, "repair-attempted");
  const repairArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.repair.json"), "utf-8"));
  assert.equal(repairArtifact.status, "repair-attempted");
  assert.deepEqual(repairArtifact.requestedActionIds, ["action-1"]);
});

test("staged orchestration records skipped checkpoint when reviewer config is absent", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: false, worldMarkdownFiles: 0 } };
      return { responseText: "merge ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: true, worldMarkdownFiles: 3 } };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      throw new Error("review should not run");
    },
  });
  assert.deepEqual(calls, ["extract", "merge"]);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "post-merge-review"]);
  const reviewArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.review.json"), "utf-8"));
  assert.equal(reviewArtifact.status, "skipped");
  assert.equal(reviewArtifact.reviewer.reason, "no reviewer model configured");
});

test("staged dry-run stops after extract", async () => {
  const calls: string[] = [];
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: "/out", sessionStrategy: "staged", dryRun: true }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      return { responseText: "extract ok", model: "m", outputRoot: "/out", outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 0, mergeStageExists: false, worldMarkdownFiles: 0 } };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      throw new Error("review should not run");
    },
  });
  assert.deepEqual(calls, ["extract"]);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract"]);
});

test("staged orchestration fails fast when extract writes no stages", async () => {
  await assert.rejects(() => runWorldImportSkillWithRunners({ input: "/in", outputRoot: "/out", sessionStrategy: "staged" }, {
    runModelPrompt: async () => ({ responseText: "extract ok", model: "m", outputRoot: "/out", outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 0, mergeStageExists: false, worldMarkdownFiles: 0 } }),
    runReviewerEvaluation: async () => ({ version: 1, createdAt: new Date().toISOString(), outputRoot: "/out", deterministic: { passed: true, checks: [] } }),
  }), /produced no extraction stage files/);
});

test("staged orchestration skips review when merge emits no markdown", async () => {
  const calls: string[] = [];
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: "/out", sessionStrategy: "staged", reviewerModel: "openai/gpt-4o" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: "/out", outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: false, worldMarkdownFiles: 0 } };
      return { responseText: "merge ok", model: "m", outputRoot: "/out", outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: true, worldMarkdownFiles: 0 } };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      throw new Error("review should not run");
    },
  });
  assert.deepEqual(calls, ["extract", "merge"]);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge"]);
});

test("helper command flow normalizes, writes generic merge packet, and emits markdown", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");

  const normalized = helper(["normalize", "--input", input, "--output", output]);
  assert.equal(normalized.status, 0, normalized.stderr);
  const units = JSON.parse(helper(["list-units", "--output", output]).stdout) as Array<{ unitId: string; sourceId: string }>;
  assert.equal(units.length, 1);
  const unitText = helper(["read-unit", "--output", output, "--unit", units[0].unitId]);
  assert.match(unitText.stdout, /\[b0001\] Ada guards/);

  const merge = {
    version: 1,
    kind: "merge",
    artifacts: [{
      id: "ada",
      group: "people",
      title: "Ada",
      sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
      provenance: [{ sourceId: units[0].sourceId, unitId: units[0].unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." }],
    }],
  };
  const wrote = helper(["write-merge", "--output", output], JSON.stringify(merge));
  assert.equal(wrote.status, 0, wrote.stderr);
  const emitted = helper(["emit", "--output", output]);
  assert.equal(emitted.status, 0, emitted.stderr);
  const markdown = await readFile(join(output, "world", "people", "ada.md"), "utf-8");
  assert.match(markdown, /# Ada/);
  assert.match(markdown, /## Provenance/);
  assert.match(markdown, /\(\.\.\/sources\/units\/.+?#b0001\)/);
  const sourcePage = await readFile(join(output, "world", "sources", "units", `${units[0].unitId}.md`), "utf-8");
  assert.match(sourcePage, /type: "Source Unit"/);
  assert.match(sourcePage, /^## b0001$/m);
  assert.doesNotMatch(sourcePage, /^## b0001 \(/m);
  assert.match(sourcePage, /Ada guards the glass tower/);
  const sourceIndex = await readFile(join(output, "world", "sources", "index.md"), "utf-8");
  assert.match(sourceIndex, /\(units\/.+?\.md\)/);
  const coverage = await readFile(join(output, "world", "coverage.md"), "utf-8");
  assert.match(coverage, /\[Ada\]\(people\/ada\.md\)/);
});
