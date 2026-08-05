import assert from "node:assert/strict";
import test from "node:test";
import { deterministicMemImportChecks } from "./mem-import/checks.js";
import { classifyNarrativeSurface } from "./mem-import/narrative-surfaces.js";
import { buildCoveragePlan, renderCoverageMarkdown } from "./mem-import/coverage.js";
import { emitMemImportProjection } from "./mem-import/projection.js";
import { fixtureForQualityChecks } from "./mem-import-test-fixture.js";

test("canonical checks expose narrative surface risk signals without failing structural output", async () => {
  const output = await fixtureForQualityChecks({ units: 2, narrativeArtifacts: false });
  await emitMemImportProjection(output);
  const checks = await deterministicMemImportChecks(output);
  assert.equal(checks.passed, true, JSON.stringify(checks));
  assert.ok(checks.riskSignals?.some((item) => item.code === "missing-plot-synopsis"));
  assert.ok(checks.riskSignals?.some((item) => item.code === "missing-timeline"));
  assert.ok(checks.riskSignals?.some((item) => item.code === "missing-scene-guide"));
  assert.ok(checks.riskSignals?.some((item) => item.code === "empty-things-group"));
});

test("explicit synopsis aliases used by narrative artifacts avoid false missing-synopsis warnings", () => {
  const artifact = {
    id: "synopsis-alice",
    group: "facts" as const,
    type: "synopsis",
    title: "Alice’s Adventures in Wonderland — Synopsis",
    sections: [{ heading: "Summary", body: "A synopsis." }],
    provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "Synopsis evidence." }],
  };
  assert.deepEqual(classifyNarrativeSurface(artifact), ["synopsis"]);
});

test("entity synopsis pages do not satisfy the corpus synopsis signal", () => {
  const entitySynopsis = {
    id: "alice-synopsis",
    group: "people" as const,
    type: "Synopsis",
    title: "Alice Character Synopsis",
    sections: [{ heading: "Summary", body: "Alice." }],
    provenance: [{ sourceId: "s", unitId: "u", startAnchor: "b0001", endAnchor: "b0001", quote: "Alice." }],
  };
  assert.deepEqual(classifyNarrativeSurface(entitySynopsis), []);
  const corpusSynopsis = { ...entitySynopsis, id: "corpus-synopsis", group: "facts" as const, title: "Corpus Synopsis" };
  assert.deepEqual(classifyNarrativeSurface(corpusSynopsis), ["synopsis"]);
});

test("coverage plan renders root projection unit and candidate accounting data", async () => {
  const output = await fixtureForQualityChecks({ units: 2, narrativeArtifacts: true });
  await emitMemImportProjection(output);
  const plan = await buildCoveragePlan(output);
  assert.equal(plan.sourceUnits, 2);
  assert.equal(plan.candidateAccounting.totalCandidates, 2);
  assert.equal(plan.candidateAccounting.represented, 2);
  assert.deepEqual(plan.candidateAccounting.unaccounted, []);
  assert.match(renderCoverageMarkdown(plan), /Candidate accounting/);
  assert.ok(plan.unitCoverage.every((unit) => unit.sourcePageEmitted));
});
