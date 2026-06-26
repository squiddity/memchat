import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deterministicWorldImportChecks, runReviewerModelEvaluation, writeEvaluationResult } from "./world-import/eval.js";
import { writeManifest, writeMergeStage } from "./world-import/staging.js";

test("deterministic evaluation reports degraded output before reviewer-model work", async () => {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-eval-"));
  const checks = await deterministicWorldImportChecks(output);
  assert.equal(checks.passed, false);
  assert.ok(checks.checks.some((check) => check.name === "manifest exists" && !check.passed));
});

test("evaluation bundle records deterministic pass and skipped reviewer state", async () => {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-eval-"));
  await writeManifest({
    version: 1,
    createdAt: "2026-06-24T00:00:00.000Z",
    inputRoot: "/tmp/source",
    outputRoot: output,
    units: [{ sourceId: "s", unitId: "u", kind: "html", inputPath: "chapter.html", order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: join(output, "sources", "normalized", "u.json") }],
    diagnostics: [],
  });
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [{
      id: "glass-tower",
      group: "places",
      title: "Glass Tower",
      sections: [{ heading: "Summary", body: "A tower." }],
      provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "A tower." }],
    }],
  });
  await mkdir(join(output, "world", "places"), { recursive: true });
  await writeFile(join(output, "world", "places", "glass-tower.md"), "# Glass Tower\n", "utf-8");

  const result = await writeEvaluationResult(output, { skipped: true, reason: "no reviewer model configured" });
  assert.equal(result.deterministic.passed, true);
  assert.equal(result.reviewer?.skipped, true);

  const skipped = await runReviewerModelEvaluation({ outputRoot: output });
  assert.equal(skipped.reviewer?.reason, "no reviewer model configured");
});
