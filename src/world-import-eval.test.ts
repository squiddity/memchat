import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPostMergeReviewPrompt, buildReviewBundle, buildReviewerPrompt, deterministicWorldImportChecks, generateQaQuestions, lintWorldImport, parseStructuredPostMergeReviewOutput, parseStructuredReviewerOutput, runReviewerModelEvaluation, writeEvaluationResult } from "./world-import/eval.js";
import { writeExtractionStage, writeManifest, writeMergeStage, writeNormalizedUnit } from "./world-import/staging.js";

async function createReviewableWorldOutput(options: { includeSourcePage?: boolean } = {}): Promise<string> {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-eval-"));
  await writeManifest({
    version: 1,
    createdAt: "2026-06-24T00:00:00.000Z",
    inputRoot: "/tmp/source",
    outputRoot: output,
    units: [{ sourceId: "s", unitId: "u", kind: "html", inputPath: "chapter.html", order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: "sources/normalized/u.json", sourceHash: "0123456789abcdef", contentHash: "fedcba9876543210", normalizerVersion: 2 }],
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

1. [\`s/u#b0001-b0001\`](../sources/units/u.md#b0001)
   > A tower.
`, "utf-8");
  await writeFile(join(output, "world", "places", "index.md"), "# Places\n\n- [Glass Tower](glass-tower.md) - A tower.\n", "utf-8");
  if (options.includeSourcePage !== false) {
    await writeFile(join(output, "world", "sources", "units", "u.md"), `---
type: "Source Unit"
title: "u"
description: "Normalized source text for u."
source_id: "s"
unit_id: "u"
input_path: "chapter.html"
source_hash: "0123456789abcdef"
content_hash: "fedcba9876543210"
normalizer_version: 2
---

# u

## b0001

A tower.
`, "utf-8");
  }
  await writeFile(join(output, "world", "sources", "index.md"), "# Sources\n\n- [u](units/u.md) - Normalized source text for u.\n", "utf-8");
  await writeFile(join(output, "world", "coverage.md"), "# Source Coverage\n\n## [u](sources/units/u.md)\n\n- [Glass Tower](places/glass-tower.md) - A tower.\n", "utf-8");
  await writeFile(join(output, "world", "index.md"), "# World Index\n\n## Groups\n- [Places](places/index.md) - 1 concept page(s).\n\n## Sources\n- [Sources](sources/index.md) - 1 retained source-unit page(s).\n\n## Coverage\n- [Source Coverage](coverage.md) - Maps retained source units to emitted concept pages.\n", "utf-8");
  await writeFile(join(output, "world", "log.md"), "# World Update Log\n\n## 2026-06-24\n* **Emit**: Generated 1 concept page(s).\n", "utf-8");
  return output;
}

test("deterministic evaluation reports degraded output before reviewer-model work", async () => {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-eval-"));
  const checks = await deterministicWorldImportChecks(output);
  assert.equal(checks.passed, false);
  assert.ok(checks.checks.some((check) => check.name === "manifest exists" && !check.passed));
});

test("deterministic evaluation reports referenced source page coverage", async () => {
  const output = await createReviewableWorldOutput();
  const checks = await deterministicWorldImportChecks(output);
  assert.equal(checks.passed, true);
  assert.ok(checks.checks.some((check) => check.name === "retained source pages emitted" && check.message === "1/1 referenced source page(s) emitted"));
});

test("deterministic evaluation surfaces non-failing narrative risk signals and provenance audit warnings", async () => {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-eval-"));
  await writeManifest({
    version: 1,
    createdAt: "2026-06-24T00:00:00.000Z",
    inputRoot: "/tmp/source",
    outputRoot: output,
    units: [
      { sourceId: "s1", unitId: "u1", kind: "html", role: "body", inputPath: "act1.html", order: 0, blockCount: 1, anchors: ["b0001"], normalizedPath: "sources/normalized/u1.json", sourceHash: "a", contentHash: "b", normalizerVersion: 2 },
      { sourceId: "s2", unitId: "u2", kind: "html", role: "body", inputPath: "act2.html", order: 1, blockCount: 1, anchors: ["b0001"], normalizedPath: "sources/normalized/u2.json", sourceHash: "c", contentHash: "d", normalizerVersion: 2 },
    ],
    diagnostics: [],
  });
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [{
      id: "romeo",
      group: "people",
      title: "Romeo",
      sections: [
        { heading: "Summary", body: "Romeo is impulsive." },
        { heading: "Role", body: "He drives the romance." },
        { heading: "Conflict", body: "He is caught in family conflict." },
        { heading: "Outcome", body: "His choices end tragically." },
      ],
      provenance: [{ sourceId: "s1", unitId: "u1", startAnchor: "b0001", endAnchor: "b0001", quote: "ACT I" }],
    }, {
      id: "plot-synopsis",
      group: "facts",
      title: "Plot Synopsis",
      sections: [{ heading: "Synopsis", body: "A".repeat(2500) }],
      provenance: [{ sourceId: "s1", unitId: "u1", startAnchor: "b0001", endAnchor: "b0001", quote: "ACT I" }],
    }],
  });
  const checks = await deterministicWorldImportChecks(output);
  assert.ok(!checks.riskSignals?.some((item) => item.code === "missing-plot-synopsis"));
  assert.ok(checks.riskSignals?.some((item) => item.code === "missing-timeline"));
  assert.ok(checks.riskSignals?.some((item) => item.code === "missing-scene-guide"));
  assert.ok(checks.riskSignals?.some((item) => item.code === "empty-things-group"));
  assert.ok(checks.provenanceAudit?.diagnostics.some((item) => item.code === "heading-only-provenance"));
  assert.ok(checks.provenanceAudit?.diagnostics.some((item) => item.code === "sparse-synthesis-provenance" && item.artifactId === "plot-synopsis"));
});

test("deterministic evaluation fails clearly when cited source pages are missing", async () => {
  const output = await createReviewableWorldOutput({ includeSourcePage: false });
  const checks = await deterministicWorldImportChecks(output);
  assert.equal(checks.passed, false);
  assert.ok(checks.checks.some((check) => check.name === "retained source pages emitted" && check.message === "0/1 referenced source page(s) emitted" && !check.passed));
});

test("review bundle includes wiki navigation files and cited source-unit pages", async () => {
  const output = await createReviewableWorldOutput();
  const bundle = await buildReviewBundle(output);
  assert.match(bundle.markdown["index.md"], /# World Index/);
  assert.match(bundle.markdown["coverage.md"], /# Source Coverage/);
  assert.match(bundle.markdown["sources\/index.md"], /# Sources/);
  assert.match(bundle.markdown["sources\/units\/u.md"], /## b0001/);
});

test("review bundle balances body-unit excerpts and exposes candidate accounting", async () => {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-balanced-bundle-"));
  const units = ["u1", "u2", "u3"];
  await writeManifest({
    version: 1, createdAt: "2026-07-10T00:00:00.000Z", inputRoot: "/tmp/source", outputRoot: output, diagnostics: [],
    units: units.map((unitId, order) => ({ sourceId: `s${order + 1}`, unitId, title: `Chapter ${order + 1}`, kind: "html" as const, role: "body" as const, inputPath: `${unitId}.html`, order, blockCount: 3, anchors: ["b0001", "b0002", "b0003"], normalizedPath: `sources/normalized/${unitId}.json`, sourceHash: `${order}`, contentHash: `${order}`, normalizerVersion: 2 })),
  });
  for (const [order, unitId] of units.entries()) {
    await writeNormalizedUnit(output, { sourceId: `s${order + 1}`, unitId, title: `Chapter ${order + 1}`, kind: "html", role: "body", inputPath: `${unitId}.html`, order, sourceHash: `${order}`, contentHash: `${order}`, normalizerVersion: 2, content: `START-${unitId} ${"a".repeat(500)} MIDDLE-${unitId} ${"b".repeat(500)} END-${unitId}`, blocks: [{ anchor: "b0001", index: 0, text: `START-${unitId}` }, { anchor: "b0002", index: 1, text: `MIDDLE-${unitId}` }, { anchor: "b0003", index: 2, text: `END-${unitId}` }] });
    await writeExtractionStage(output, { version: 1, kind: "extraction", unitId, sourceId: `s${order + 1}`, candidates: [{ id: `candidate-${unitId}`, group: "things", title: `Thing ${unitId}`, provenance: [{ sourceId: `s${order + 1}`, unitId, startAnchor: "b0001", endAnchor: "b0001", quote: `START-${unitId}` }] }] });
  }
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [], candidateDispositions: [{ unitId: "u1", candidateId: "candidate-u1", disposition: "dropped", reason: "Covered by a broader event." }, { unitId: "u2", candidateId: "candidate-u2", disposition: "merged", artifactId: "event" }] });
  const bundle = await buildReviewBundle(output);
  assert.equal(bundle.sourceCoverage.coverageTruncated, false);
  assert.deepEqual(bundle.sources.map((source) => source.unitId), units);
  assert.ok(bundle.sources.every((source) => source.sourcePagePath === `sources/units/${source.unitId}.md`));
  assert.ok(bundle.sources.every((source) => source.content.includes("[[start]]") && source.content.includes("[[middle]]") && source.content.includes("[[end]]")));
  assert.deepEqual(bundle.candidateAccounting.counts, { represented: 0, merged: 1, deferred: 0, dropped: 1, unaccounted: 1 });
  const prompt = buildReviewerPrompt(bundle);
  assert.match(prompt, /Candidate Accounting/);
  assert.match(prompt, /candidate-u1: dropped — Covered by a broader event/);
});

test("review bundle reports coverage truncation without omitting body units", async () => {
  const output = await mkdtemp(join(tmpdir(), "memchat-world-truncated-bundle-"));
  const units = Array.from({ length: 251 }, (_, index) => `u${index}`);
  await writeManifest({
    version: 1, createdAt: "2026-07-10T00:00:00.000Z", inputRoot: "/tmp/source", outputRoot: output, diagnostics: [],
    units: units.map((unitId, order) => ({ sourceId: `s${order}`, unitId, kind: "html" as const, role: "body" as const, inputPath: `${unitId}.html`, order, blockCount: 1, anchors: ["b0001"], normalizedPath: `sources/normalized/${unitId}.json`, sourceHash: `${order}`, contentHash: `${order}`, normalizerVersion: 2 })),
  });
  await writeMergeStage(output, { version: 1, kind: "merge", artifacts: [] });
  const bundle = await buildReviewBundle(output);
  assert.equal(bundle.sourceCoverage.coverageTruncated, true);
  assert.equal(bundle.sources.length, 251);
  assert.ok(bundle.sources.every((source) => source.content.includes("coverage is truncated")));
  assert.match(buildReviewerPrompt(bundle), /WARNING: source-text coverage was truncated/);
});

test("reviewer prompt JSON example includes all scored dimensions", async () => {
  const output = await createReviewableWorldOutput();
  const prompt = buildReviewerPrompt(await buildReviewBundle(output));
  assert.match(prompt, /enriched instead of duplicated/);
  for (const dimension of [
    "entityRecall",
    "detailRichness",
    "sourceCoverage",
    "provenance",
    "mergeQuality",
    "answerability",
    "navigability",
    "progressiveDisclosure",
    "plotSynopsisQuality",
    "timelineCompleteness",
    "sourceStructureCoverage",
    "objectPropCoverage",
    "omissionVisibility",
    "citationReconstructability",
    "droppedCandidateRisk",
    "styleToneCoverage",
  ]) {
    assert.match(prompt, new RegExp(`"dimension": "${dimension}"`));
  }
});

test("post-merge review prompt focuses repairable semantic gaps", async () => {
  const output = await createReviewableWorldOutput();
  const prompt = buildPostMergeReviewPrompt(await buildReviewBundle(output), { checkpointId: "post-merge", iteration: 1 });
  assert.match(prompt, /focused world-import intermediate reviewer/);
  assert.match(prompt, /plot-critical objects/);
  assert.match(prompt, /omission/);
  assert.match(prompt, /"repairRecommended"/);
  assert.match(prompt, /"requestedActions"/);
  assert.match(prompt, /Deterministic pre-review inventory/);
  assert.match(prompt, /Narrative surfaces: synopsis: missing; timeline: missing; scene-guide: missing/);
  assert.match(prompt, /Treat this inventory as authoritative/);
});

test("post-merge review parser accepts Romeo-like object repair requests", () => {
  const parsed = parseStructuredPostMergeReviewOutput(`Notes\n\n\`\`\`json
{"repairRecommended":true,"findings":[{"id":"finding-1","severity":"repair","category":"object-coverage","summary":"The Friar Lawrence letter is plot-critical but has no durable thing artifact.","evidence":"The failed delivery changes the ending.","requestedActionIds":["action-1"]}],"requestedActions":[{"id":"action-1","type":"add-artifact","severity":"repair","summary":"Add a things artifact for Friar Lawrence's letter.","rationale":"The letter materially affects the plot and should be findable.","targetArtifactId":"friar-lawrence-letter","confidence":"high","rereadSource":true}]}
\`\`\``);
  assert.equal(parsed.parseStatus, "valid");
  assert.equal(parsed.repairRecommended, true);
  assert.equal(parsed.requestedActions[0].type, "add-artifact");
  assert.equal(parsed.requestedActions[0].targetArtifactId, "friar-lawrence-letter");
});

test("post-merge review parser does not trigger repairs for malformed output", () => {
  const parsed = parseStructuredPostMergeReviewOutput("The bundle might need work, but no JSON follows.");
  assert.equal(parsed.parseStatus, "missing");
  assert.equal(parsed.repairRecommended, false);
  assert.deepEqual(parsed.requestedActions, []);
});

test("lint reports unresolved related ids and wikilinks", async () => {
  const output = await createReviewableWorldOutput();
  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    artifacts: [{
      id: "alice",
      group: "people",
      title: "Alice",
      sections: [{ heading: "Summary", body: "Alice remembers [[lobster-quadrille]]." }],
      related: ["caucus-race"],
      provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "A tower." }],
    }],
  });
  await mkdir(join(output, "world", "people"), { recursive: true });
  await writeFile(join(output, "world", "people", "alice.md"), `---
id: "alice"
group: people
type: "Character"
title: "Alice"
description: "Alice."
related: ["caucus-race"]
---

# Alice

## Summary

Alice remembers [[lobster-quadrille]].

## Provenance

1. [\`s/u#b0001-b0001\`](../sources/units/u.md#b0001)
   > A tower.
`, "utf-8");

  const lint = await lintWorldImport(output);
  assert.equal(lint.passed, false);
  assert.ok(lint.diagnostics.some((item) => item.code === "unresolved-related" && item.message.includes("caucus-race")));
  assert.ok(lint.diagnostics.some((item) => item.code === "unresolved-wikilink" && item.message.includes("lobster-quadrille")));
});

test("lint accounts extraction candidates through represented and dropped dispositions", async () => {
  const output = await createReviewableWorldOutput();
  await writeExtractionStage(output, {
    version: 1,
    kind: "extraction",
    unitId: "u",
    sourceId: "s",
    candidates: [
      { id: "alice", group: "people", title: "Alice", provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "A tower." }] },
      { id: "minor-door", group: "things", title: "Minor Door", provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "A tower." }] },
    ],
  });
  let lint = await lintWorldImport(output);
  assert.equal(lint.passed, false);
  assert.ok(lint.diagnostics.some((item) => item.code === "unaccounted-candidate" && item.candidateId === "alice"));

  await writeMergeStage(output, {
    version: 1,
    kind: "merge",
    candidateDispositions: [{ unitId: "u", candidateId: "minor-door", disposition: "dropped", reason: "Mention is incidental and not useful as a durable artifact." }],
    artifacts: [{
      id: "glass-tower",
      group: "places",
      title: "Glass Tower",
      sections: [{ heading: "Summary", body: "A tower." }],
      provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "A tower." }],
      metadata: { representedCandidateIds: ["u:alice"] },
    }],
  });
  lint = await lintWorldImport(output);
  assert.equal(lint.passed, true, JSON.stringify(lint.diagnostics));
});

test("reviewer parser only treats valid final JSON as authoritative", () => {
  const valid = parseStructuredReviewerOutput(`notes\n\n\
\`\`\`json
{
  "score": 2,
  "dimensionScores": [
    {"dimension": "entityRecall", "score": 2, "justification": "x"},
    {"dimension": "detailRichness", "score": 2, "justification": "x"},
    {"dimension": "sourceCoverage", "score": 2, "justification": "x"},
    {"dimension": "provenance", "score": 2, "justification": "x"},
    {"dimension": "mergeQuality", "score": 2, "justification": "x"},
    {"dimension": "answerability", "score": 2, "justification": "x"},
    {"dimension": "navigability", "score": 2, "justification": "x"},
    {"dimension": "progressiveDisclosure", "score": 2, "justification": "x"},
    {"dimension": "plotSynopsisQuality", "score": 1, "justification": "x"},
    {"dimension": "timelineCompleteness", "score": 1, "justification": "x"},
    {"dimension": "sourceStructureCoverage", "score": 1, "justification": "x"},
    {"dimension": "objectPropCoverage", "score": 1, "justification": "x"},
    {"dimension": "omissionVisibility", "score": 1, "justification": "x"},
    {"dimension": "citationReconstructability", "score": 2, "justification": "x"},
    {"dimension": "droppedCandidateRisk", "score": 2, "justification": "x"},
    {"dimension": "styleToneCoverage", "score": 2, "justification": "x"}
  ],
  "qaResults": [{"question":"Q","answerable":true,"answer":"A","confidence":"high"}]
}
\`\`\``);
  assert.equal(valid.parseStatus, "valid");
  assert.equal(valid.authoritativeScore, true);
  assert.equal(valid.score, 2);

  const proseOnly = parseStructuredReviewerOutput("entityRecall — Score: 4\nNo final JSON block.");
  assert.equal(proseOnly.parseStatus, "missing");
  assert.equal(proseOnly.authoritativeScore, false);
  assert.equal(proseOnly.score, undefined);

  const malformed = parseStructuredReviewerOutput("```json\n{\"score\": 7, \"dimensionScores\": [], \"qaResults\": []}\n```");
  assert.equal(malformed.authoritativeScore, false);
  assert.ok(["partial", "invalid"].includes(malformed.parseStatus));
  assert.ok((malformed.parseErrors ?? []).length > 0);
});

test("QA generation excludes stopwords and stage directions and adds plot traversal/object questions", () => {
  const questions = generateQaQuestions([
    { unitId: "u1", sourceId: "s1", order: 0, title: "Act I", content: "And Romeo meets Juliet. Enter Mercutio. Romeo speaks again. Juliet replies. The Nurse interrupts." },
    { unitId: "u2", sourceId: "s2", order: 1, title: "Act II", content: "Romeo returns. Juliet waits. Exit Nurse. A letter and potion shape the plot." },
  ]);
  assert.ok(questions.some((question) => question.includes("Romeo")));
  assert.ok(questions.every((question) => !question.includes("Describe And")));
  assert.ok(questions.every((question) => !question.includes("Enter")));
  assert.ok(questions.every((question) => !question.includes("Exit")));
  assert.ok(questions.some((question) => /major plot events in source order/i.test(question)));
  assert.ok(questions.some((question) => /objects, props, letters, weapons, documents/i.test(question)));
});

test("evaluation bundle records deterministic pass and skipped reviewer state", async () => {
  const output = await createReviewableWorldOutput();

  const result = await writeEvaluationResult(output, { skipped: true, reason: "no reviewer model configured" });
  assert.equal(result.deterministic.passed, true);
  assert.equal(result.reviewer?.skipped, true);

  const skipped = await runReviewerModelEvaluation({ outputRoot: output });
  assert.equal(skipped.reviewer?.reason, "no reviewer model configured");
});
