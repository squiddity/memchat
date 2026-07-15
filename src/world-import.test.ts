import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeArtifact } from "./world-import/helper-tools.js";
import { artifactPacketHash, assessMergeReadiness, attachPreRepairArtifactHashes, defaultPackageRoot, finalizeAssistantMessageForCli, inspectWorldImportOutput, renderWorldImportSkillInvocation, runWorldImportSkillWithRunners, verifyPostMergeRepair, worldImportSkill } from "./world-import/model-runner.js";
import { readImportRun, writeExtractionStage, writeJson } from "./world-import/staging.js";
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

test("world-import skill keeps process supervision outside the runner model", async () => {
  const skill = worldImportSkill(defaultPackageRoot());
  const [instructions, helperReference] = await Promise.all([
    readFile(skill.filePath, "utf-8"),
    readFile(join(skill.baseDir, "references", "helper-tools.md"), "utf-8"),
  ]);

  assert.doesNotMatch(instructions, /herdr\s+pane/i);
  assert.doesNotMatch(helperReference, /herdr\s+pane/i);
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

test("world import runner defaults to staged orchestration", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  const reviewResult: EvaluationResult = {
    version: 1,
    createdAt: new Date().toISOString(),
    outputRoot: output,
    deterministic: { passed: true, checks: [] },
    reviewer: { model: "openai/gpt-4o", score: 4 },
  };
  const result = await runWorldImportSkillWithRunners({
    input: "/in",
    outputRoot: output,
    reviewerModel: "openai/gpt-4o",
  }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: false, worldMarkdownFiles: 0 } };
      return { responseText: "merge ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: true, worldMarkdownFiles: 3 } };
    },
    runPostMergeReview: async (options) => {
      calls.push("post-merge-review");
      return { version: 1, kind: "post-merge-review", checkpointId: options.checkpointId, iteration: options.iteration, createdAt: new Date().toISOString(), outputRoot: output, status: "no-action", repairRecommended: false, findings: [], requestedActions: [], reviewer: { model: options.reviewerModel, parseStatus: "valid" } };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      return reviewResult;
    },
  });
  assert.deepEqual(calls, ["extract", "merge", "post-merge-review", "review"]);
  assert.equal(result.sessionStrategy, "staged");
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "post-merge-review", "review"]);
  const audit = await readImportRun(output);
  assert.equal(audit?.status, "completed");
  assert.deepEqual(audit?.invocations.map((item) => item.purpose), ["extract", "merge", "post-merge-review", "final-review"]);
  assert.ok(audit?.invocations.every((item) => item.status === "completed"));
  assert.equal(audit?.invocations[0].invocation.kind, "world-import-skill");
  assert.equal(audit?.invocations.at(-1)?.purpose, "final-review");
  assert.equal(audit?.invocations.at(-1)?.thinking, "low");
  assert.match(audit?.invocations[0].invocation.canonical ?? "", /"output":"<output-root>"/);
  assert.doesNotMatch(JSON.stringify(audit), /\/tmp\/memchat-world-router/);
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
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "post-merge-review", "repair", "merge-readiness", "post-merge-verify", "review"]);
  assert.equal(result.outputSummary.worldMarkdownFiles, 4);
  const reviewArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.review.json"), "utf-8"));
  assert.equal(reviewArtifact.status, "residual");
  const repairArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.repair.json"), "utf-8"));
  assert.equal(repairArtifact.status, "repair-attempted");
  assert.deepEqual(repairArtifact.requestedActionIds, ["action-1"]);
  const verifyArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.verify.json"), "utf-8"));
  assert.equal(verifyArtifact.kind, "post-merge-verify");
  assert.equal(verifyArtifact.status, "residual");
  assert.equal(verifyArtifact.actionResults[0].actionId, "action-1");
});

test("staged orchestration reassesses durable state after a semantic repair worker error", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  const readySummary = { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: true, worldMarkdownFiles: 4 };
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged", reviewerModel: "openai/gpt-4o" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { ...readySummary, mergeStageExists: false, worldMarkdownFiles: 0 } };
      if (options.stage === "repair") throw new Error("semantic repair transport failed after persistence");
      return { responseText: "merge ok", model: "m", outputRoot: output, outputSummary: readySummary };
    },
    assessMergeReadiness: async (_outputRoot, iteration) => ({
      ready: true,
      fingerprint: "ready",
      outputSummary: readySummary,
      checkpoint: { version: 1, kind: "post-merge-review", checkpointId: "merge-readiness", iteration, createdAt: new Date().toISOString(), outputRoot: output, status: "no-action", repairRecommended: false, findings: [], requestedActions: [] },
    }),
    runPostMergeReview: async (options) => {
      calls.push("post-merge-review");
      return { version: 1, kind: "post-merge-review", checkpointId: options.checkpointId, iteration: options.iteration, createdAt: new Date().toISOString(), outputRoot: output, status: "repair-requested", repairRecommended: true, findings: [{ id: "finding", severity: "repair", category: "other", summary: "Repair durable state." }], requestedActions: [{ id: "action", type: "other", severity: "repair", summary: "Repair durable state." }] };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      return { version: 1, createdAt: new Date().toISOString(), outputRoot: output, deterministic: { passed: true, checks: [] }, reviewer: { model: "openai/gpt-4o", score: 4 } };
    },
  });
  assert.deepEqual(calls, ["extract", "merge", "post-merge-review", "repair", "review"]);
  assert.equal(result.outputSummary.worldMarkdownFiles, 4);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "post-merge-review", "repair", "merge-readiness", "post-merge-verify", "review"]);
});

test("semantic repair readiness re-emits before add-artifact verification", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  assert.equal(helper(["normalize", "--input", input, "--output", output]).status, 0);
  const [unit] = JSON.parse(helper(["list-units", "--output", output]).stdout) as Array<{ unitId: string; sourceId: string }>;
  const provenance = [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." }];
  const extraction = { version: 1, kind: "extraction", unitId: unit.unitId, candidates: [{ id: "ada-local", group: "people", title: "Ada", provenance, payload: { description: "Ada guards the glass tower." } }], diagnostics: [] };
  assert.equal(helper(["write-extraction", "--output", output, "--unit", unit.unitId], JSON.stringify(extraction)).status, 0);
  await writeArtifact({ outputRoot: output, mode: "upsert", artifact: { id: "ada", group: "people", title: "Ada", sections: [{ heading: "Summary", body: "Ada guards the glass tower." }], provenance, metadata: { representedCandidateIds: [`${unit.unitId}:ada-local`] } } });
  assert.equal((await assessMergeReadiness(output, 99)).ready, true);

  const calls: string[] = [];
  const result = await runWorldImportSkillWithRunners({ input, outputRoot: output, sessionStrategy: "staged", reviewerModel: "openai/gpt-4o" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "repair") {
        const wrote = await writeArtifact({ outputRoot: output, mode: "upsert", artifact: { id: "glass-tower", group: "places", title: "Glass Tower", sections: [{ heading: "Summary", body: "A tower guarded by Ada." }], provenance } });
        assert.equal(wrote.wrote, true);
      }
      return { responseText: `${options.stage} ok`, model: "m", outputRoot: output, outputSummary: await inspectWorldImportOutput(output) };
    },
    assessMergeReadiness,
    runPostMergeReview: async (options) => {
      calls.push("post-merge-review");
      return { version: 1, kind: "post-merge-review", checkpointId: options.checkpointId, iteration: options.iteration, createdAt: new Date().toISOString(), outputRoot: output, status: "repair-requested", repairRecommended: true, findings: [{ id: "missing-tower", severity: "repair", category: "other", summary: "Glass Tower is missing." }], requestedActions: [{ id: "add-tower", type: "add-artifact", severity: "repair", summary: "Add Glass Tower.", targetArtifactId: "glass-tower" }] };
    },
    runReviewerEvaluation: async () => {
      calls.push("review");
      return { version: 1, createdAt: new Date().toISOString(), outputRoot: output, deterministic: { passed: true, checks: [] }, reviewer: { model: "openai/gpt-4o", score: 4 } };
    },
  });
  assert.deepEqual(calls, ["extract", "merge", "post-merge-review", "repair", "review"]);
  const verification = result.stages.find((stage) => stage.stage === "post-merge-verify")?.verification;
  assert.equal(verification?.status, "verified-repaired");
  assert.equal(verification?.actionResults[0].status, "verified");
  assert.match(await readFile(join(output, "world", "places", "glass-tower.md"), "utf-8"), /# Glass Tower/);
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
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "post-merge-review"]);
  const reviewArtifact = JSON.parse(await readFile(join(output, "stages", "checkpoints", "post-merge-01.review.json"), "utf-8"));
  assert.equal(reviewArtifact.status, "skipped");
  assert.equal(reviewArtifact.reviewer.reason, "no reviewer model configured");
});

test("staged dry-run stops after extract", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged", dryRun: true }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 0, mergeStageExists: false, worldMarkdownFiles: 0 } };
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
  const output = await tempDir();
  await assert.rejects(() => runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged" }, {
    runModelPrompt: async () => ({ responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 0, mergeStageExists: false, worldMarkdownFiles: 0 } }),
    runReviewerEvaluation: async () => ({ version: 1, createdAt: new Date().toISOString(), outputRoot: output, deterministic: { passed: true, checks: [] } }),
  }), /produced no extraction stage files/);
  const audit = await readImportRun(output);
  assert.equal(audit?.status, "failed");
  assert.equal(audit?.invocations[0].status, "completed");
});

test("staged orchestration routes zero-output merge through bounded readiness recovery", async () => {
  const calls: string[] = [];
  const output = await tempDir();
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: false, worldMarkdownFiles: 0 } };
      if (options.stage === "repair") {
        assert.equal(options.checkpointId, "merge-readiness");
        assert.match(options.reviewPacket ?? "", /merge-readiness-01\.review\.json$/);
        return { responseText: "recovered", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: true, worldMarkdownFiles: 5 } };
      }
      return { responseText: "merge incomplete", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 2, extractionStages: 2, mergeStageExists: false, worldMarkdownFiles: 0 } };
    },
    runReviewerEvaluation: async () => { throw new Error("review should not run without reviewer model"); },
  });
  assert.deepEqual(calls, ["extract", "merge", "repair"]);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "repair", "merge-readiness", "post-merge-review"]);
  assert.equal(result.outputSummary.worldMarkdownFiles, 5);
});

test("staged orchestration fails explicitly when readiness diagnostics do not change", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  await assert.rejects(() => runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: false, worldMarkdownFiles: 0 } };
      return { responseText: "no progress", model: "m", outputRoot: output, outputSummary: { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: false, worldMarkdownFiles: 0 } };
    },
    runReviewerEvaluation: async () => { throw new Error("review should not run"); },
  }), /merge stalled/);
  assert.deepEqual(calls, ["extract", "merge", "repair"]);
});

test("staged orchestration reassesses durable state after a recovery worker error", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  let assessments = 0;
  const emptySummary = { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: false, worldMarkdownFiles: 0 };
  const readySummary = { ...emptySummary, mergeStageExists: true, worldMarkdownFiles: 4 };
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: emptySummary };
      if (options.stage === "merge") return { responseText: "merge incomplete", model: "m", outputRoot: output, outputSummary: emptySummary };
      throw new Error("recovery transport failed after persistence");
    },
    assessMergeReadiness: async (_outputRoot, iteration) => {
      assessments++;
      const ready = assessments === 2;
      return {
        ready,
        fingerprint: ready ? "ready" : "missing",
        outputSummary: ready ? readySummary : emptySummary,
        checkpoint: { version: 1, kind: "post-merge-review", checkpointId: "merge-readiness", iteration, createdAt: new Date().toISOString(), outputRoot: output, status: ready ? "no-action" : "repair-requested", repairRecommended: !ready, findings: [], requestedActions: ready ? [] : [{ id: "resume", type: "other", severity: "repair", summary: "Resume merge." }] },
      };
    },
    runReviewerEvaluation: async () => { throw new Error("review should not run"); },
  });
  assert.deepEqual(calls, ["extract", "merge", "repair"]);
  assert.equal(result.outputSummary.worldMarkdownFiles, 4);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "repair", "merge-readiness", "post-merge-review"]);
});

test("staged orchestration assesses durable state after a merge worker error", async () => {
  const output = await tempDir();
  const calls: string[] = [];
  const readySummary = { manifestExists: true, normalizedUnits: 1, extractionStages: 1, mergeStageExists: true, worldMarkdownFiles: 4 };
  const result = await runWorldImportSkillWithRunners({ input: "/in", outputRoot: output, sessionStrategy: "staged" }, {
    runModelPrompt: async (options) => {
      calls.push(options.stage ?? "full");
      if (options.stage === "extract") return { responseText: "extract ok", model: "m", outputRoot: output, outputSummary: { ...readySummary, mergeStageExists: false, worldMarkdownFiles: 0 } };
      throw new Error("worker transport failed after persistence");
    },
    assessMergeReadiness: async (_outputRoot, iteration) => ({
      ready: true,
      fingerprint: "ready",
      outputSummary: readySummary,
      checkpoint: { version: 1, kind: "post-merge-review", checkpointId: "merge-readiness", iteration, createdAt: new Date().toISOString(), outputRoot: output, status: "no-action", repairRecommended: false, findings: [], requestedActions: [] },
    }),
    runReviewerEvaluation: async () => { throw new Error("review should not run"); },
  });
  assert.deepEqual(calls, ["extract", "merge"]);
  assert.equal(result.outputSummary.worldMarkdownFiles, 4);
  assert.deepEqual(result.stages.map((stage) => stage.stage), ["extract", "merge", "merge-readiness", "post-merge-review"]);
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

test("merge readiness persists deterministic blockers and passes after a complete merge", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  assert.equal(helper(["normalize", "--input", input, "--output", output]).status, 0);
  const [unit] = JSON.parse(helper(["list-units", "--output", output]).stdout) as Array<{ unitId: string; sourceId: string }>;
  const provenance = [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." }];
  const extraction = { version: 1, kind: "extraction", unitId: unit.unitId, candidates: [{ id: "ada-local", group: "people", title: "Ada", provenance, payload: { description: "Ada guards the glass tower." } }], diagnostics: [] };
  assert.equal(helper(["write-extraction", "--output", output, "--unit", unit.unitId], JSON.stringify(extraction)).status, 0);

  const missing = await assessMergeReadiness(output, 1);
  assert.equal(missing.ready, false);
  assert.match(missing.checkpoint.findings[0].summary, /merge-missing/);
  assert.equal(missing.checkpoint.status, "repair-requested");

  const artifact = { id: "ada", group: "people", title: "Ada", sections: [{ heading: "Summary", body: "Ada guards the glass tower." }], provenance, metadata: { representedCandidateIds: [`${unit.unitId}:ada-local`] } };
  assert.equal(helper(["write-artifact", "--output", output, "--mode", "upsert"], JSON.stringify(artifact)).status, 0);
  const ready = await assessMergeReadiness(output, 2);
  assert.equal(ready.ready, true, JSON.stringify(ready.checkpoint.findings));
  assert.equal(ready.checkpoint.status, "no-action");
  assert.ok(ready.outputSummary.worldMarkdownFiles > 0);
});

test("structurally verifies strengthened artifacts and provenance without claiming semantic review", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p><p>She records its silver key.</p></body></html>", "utf-8");
  assert.equal(helper(["normalize", "--input", input, "--output", output]).status, 0);
  const [unit] = JSON.parse(helper(["list-units", "--output", output]).stdout) as Array<{ unitId: string; sourceId: string }>;
  const firstRef = { sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." };
  const secondRef = { sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0002", endAnchor: "b0002", quote: "She records its silver key." };
  const extraction = { version: 1, kind: "extraction", unitId: unit.unitId, candidates: [{ id: "ada-local", group: "people", title: "Ada", provenance: [firstRef], payload: { description: "Ada guards the glass tower." } }], diagnostics: [] };
  assert.equal(helper(["write-extraction", "--output", output, "--unit", unit.unitId], JSON.stringify(extraction)).status, 0);
  const initialArtifact = { id: "ada", group: "people" as const, title: "Ada", sections: [{ heading: "Summary", body: "Ada guards the glass tower." }], provenance: [firstRef], metadata: { representedCandidateIds: [`${unit.unitId}:ada-local`] } };
  assert.equal((await writeArtifact({ outputRoot: output, mode: "upsert", artifact: initialArtifact })).wrote, true);
  assert.equal((await assessMergeReadiness(output, 1)).ready, true);
  const baseline = artifactPacketHash(initialArtifact);
  const checkpoint = await attachPreRepairArtifactHashes(output, {
    version: 1 as const,
    kind: "post-merge-review" as const,
    checkpointId: "post-merge",
    iteration: 1,
    createdAt: new Date().toISOString(),
    outputRoot: output,
    status: "repair-requested" as const,
    repairRecommended: true,
    findings: [],
    requestedActions: [
      { id: "strengthen-content", type: "strengthen-artifact" as const, severity: "repair" as const, summary: "Add the key detail.", targetArtifactId: "ada", sourceRefs: [secondRef] },
      { id: "strengthen-evidence", type: "strengthen-provenance" as const, severity: "repair" as const, summary: "Cite the key detail.", targetArtifactId: "ada", sourceRefs: [secondRef] },
    ],
  });
  assert.equal(checkpoint.requestedActions[0].preRepairArtifactHash, baseline);
  const strengthened = { ...initialArtifact, sections: [{ heading: "Summary", body: "Ada guards the glass tower and records its silver key." }], provenance: [firstRef, secondRef] };
  assert.equal((await writeArtifact({ outputRoot: output, mode: "upsert", artifact: strengthened })).wrote, true);
  assert.equal((await assessMergeReadiness(output, 2)).ready, true);
  const verification = await verifyPostMergeRepair(output, checkpoint);
  assert.equal(verification.status, "verified-repaired");
  assert.deepEqual(verification.actionResults.map((result) => result.status), ["verified-structural", "verified-structural"]);
  assert.ok(verification.actionResults.every((result) => result.checks.every((check) => check.passed)));
});

test("write-artifacts refuses to replace a malformed durable merge", async () => {
  const root = await tempDir();
  const output = join(root, "output");
  const mergeDir = join(output, "stages", "merge");
  const mergePath = join(mergeDir, "merged-candidates.json");
  await mkdir(mergeDir, { recursive: true });
  await writeFile(mergePath, "{ truncated", "utf-8");
  const artifact = [{ id: "replacement", group: "facts", title: "Replacement", sections: [{ heading: "Summary", body: "Must not overwrite corrupt state." }], provenance: [{ sourceId: "source", unitId: "unit", startAnchor: "b0001", endAnchor: "b0001", quote: "Exact quote." }] }];
  const result = helper(["write-artifacts", "--output", output, "--mode", "upsert", "--no-validate"], JSON.stringify(artifact));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON|Unexpected|position/i);
  assert.equal(await readFile(mergePath, "utf-8"), "{ truncated");
});

test("writeJson atomically replaces complete JSON under concurrent writes", async () => {
  const root = await tempDir();
  const path = join(root, "state", "checkpoint.json");
  await Promise.all(Array.from({ length: 8 }, (_, index) => writeJson(path, { index, payload: "x".repeat(1000) })));
  const parsed = JSON.parse(await readFile(path, "utf-8")) as { index: number; payload: string };
  assert.ok(parsed.index >= 0 && parsed.index < 8);
  assert.equal(parsed.payload.length, 1000);
  assert.deepEqual((await readdir(join(root, "state"))).filter((name) => name.endsWith(".tmp")), []);
});

test("write-artifacts atomically persists a bounded cross-linked batch", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");
  assert.equal(helper(["normalize", "--input", input, "--output", output]).status, 0);
  const [unit] = JSON.parse(helper(["list-units", "--output", output]).stdout) as Array<{ unitId: string; sourceId: string }>;
  const provenance = [{ sourceId: unit.sourceId, unitId: unit.unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." }];
  const batch = [
    { id: "ada", group: "people", title: "Ada", sections: [{ heading: "Summary", body: "Ada guards [[glass-tower|the glass tower]]." }], provenance, related: ["glass-tower"] },
    { id: "glass-tower", group: "places", title: "Glass Tower", sections: [{ heading: "Summary", body: "The glass tower is guarded by [[ada|Ada]]." }], provenance, related: ["ada"] },
  ];
  const wrote = helper(["write-artifacts", "--output", output, "--mode", "upsert"], JSON.stringify(batch));
  assert.equal(wrote.status, 0, wrote.stderr);
  const result = JSON.parse(wrote.stdout) as { wrote: boolean; artifactCount: number };
  assert.equal(result.wrote, true);
  assert.equal(result.artifactCount, 2);
  let merge = JSON.parse(await readFile(join(output, "stages", "merge", "merged-candidates.json"), "utf-8")) as { artifacts: Array<{ id: string }> };
  assert.equal(merge.artifacts.length, 2);

  const invalidBatch = [
    { id: "new-valid", group: "facts", title: "New valid", sections: [{ heading: "Summary", body: "Valid draft." }], provenance },
    { id: "new-invalid", group: "facts", title: "New invalid", sections: [], provenance },
  ];
  const rejected = helper(["write-artifacts", "--output", output, "--mode", "upsert"], JSON.stringify(invalidBatch));
  assert.equal(rejected.status, 1);
  merge = JSON.parse(await readFile(join(output, "stages", "merge", "merged-candidates.json"), "utf-8")) as { artifacts: Array<{ id: string }> };
  assert.deepEqual(merge.artifacts.map((artifact) => artifact.id).sort(), ["ada", "glass-tower"]);
});
