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
    units: [{ sourceId: "s", unitId: "u", kind: "html", inputPath: "chapter.html", order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: "sources/normalized/u.json", sourceHash: "0123456789abcdef", contentHash: "fedcba9876543210", normalizerVersion: 1 }],
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
  await mkdir(join(output, "world", "sources", "units"), { recursive: true });
  await writeFile(join(output, "world", "places", "glass-tower.md"), `---
id: "glass-tower"
group: places
type: "Location"
title: "Glass Tower"
description: "A tower."
---

# Glass Tower

## Summary

A tower.

## Provenance

1. [\`s/u#b0001-b0001\`](/sources/units/u.md#b0001)
   > A tower.
`, "utf-8");
  await writeFile(join(output, "world", "places", "index.md"), "# Places\n\n- [Glass Tower](/places/glass-tower.md) - A tower.\n", "utf-8");
  await writeFile(join(output, "world", "sources", "units", "u.md"), `---
type: "Source Unit"
title: "u"
description: "Normalized source text for u."
source_id: "s"
unit_id: "u"
input_path: "chapter.html"
source_hash: "0123456789abcdef"
content_hash: "fedcba9876543210"
normalizer_version: 1
---

# u

## b0001

A tower.
`, "utf-8");
  await writeFile(join(output, "world", "sources", "index.md"), "# Sources\n\n- [u](/sources/units/u.md) - Normalized source text for u.\n", "utf-8");
  await writeFile(join(output, "world", "coverage.md"), "# Source Coverage\n\n## [u](/sources/units/u.md)\n\n- [Glass Tower](/places/glass-tower.md) - A tower.\n", "utf-8");
  await writeFile(join(output, "world", "index.md"), "# World Index\n\n## Groups\n- [Places](/places/index.md) - 1 concept page(s).\n\n## Sources\n- [Sources](/sources/index.md) - 1 retained source-unit page(s).\n\n## Coverage\n- [Source Coverage](/coverage.md) - Maps retained source units to emitted concept pages.\n", "utf-8");
  await writeFile(join(output, "world", "log.md"), "# World Update Log\n\n## 2026-06-24\n* **Emit**: Generated 1 concept page(s).\n", "utf-8");

  const result = await writeEvaluationResult(output, { skipped: true, reason: "no reviewer model configured" });
  assert.equal(result.deterministic.passed, true);
  assert.equal(result.reviewer?.skipped, true);

  const skipped = await runReviewerModelEvaluation({ outputRoot: output });
  assert.equal(skipped.reviewer?.reason, "no reviewer model configured");
});
