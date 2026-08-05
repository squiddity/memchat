import assert from "node:assert/strict";
import test from "node:test";
import { provenanceAudit, renderProvenanceAuditMarkdown, validateArtifact, validateSourceSpan } from "./mem-import/provenance-audit.js";
import { readNormalizedUnit, writeMergeStage } from "./mem-import/stage-store.js";
import { fixtureForQualityChecks } from "./mem-import-test-fixture.js";
import type { LintDiagnostic, StageEnvelope } from "./mem-import/contracts.js";

test("provenance audit reports heading-only, sparse, repeated, and style warnings", async () => {
  const output = await fixtureForQualityChecks();
  const source = (await readNormalizedUnit(output, "u1")).blocks;
  const ref = { sourceId: "s1", unitId: "u1", startAnchor: "b0001", endAnchor: "b0001", quote: source[0]!.text };
  const stage: StageEnvelope = {
    version: 1, kind: "merge", artifacts: [
      { id: "event", group: "facts", type: "event", title: "Event", sections: [{ heading: "A", body: "one" }, { heading: "B", body: "two" }, { heading: "C", body: "three" }, { heading: "D", body: "four" }], provenance: [ref] },
      { id: "style", group: "style", title: "Style", sections: [{ heading: "Summary", body: "A substantive style description with representative narrative detail and tone across the corpus, including diction and pacing." }], provenance: [ref] },
      { id: "other-a", group: "people", title: "Other A", sections: [{ heading: "Summary", body: "A" }], provenance: [ref] },
      { id: "other-b", group: "places", title: "Other B", sections: [{ heading: "Summary", body: "B" }], provenance: [ref] },
    ],
  };
  await writeMergeStage(output, stage);
  const result = await provenanceAudit({ outputRoot: output });
  assert.equal(result.passed, true);
  assert.ok(result.diagnostics.some((item) => item.code === "heading-only-provenance"));
  assert.ok(result.diagnostics.some((item) => item.code === "single-ref-many-sections"));
  assert.ok(result.diagnostics.some((item) => item.code === "style-under-cited"));
  assert.ok(result.diagnostics.some((item) => item.code === "repeated-identical-provenance"));
  assert.match(renderProvenanceAuditMarkdown(result), /provenance audit/);
});

test("source-span validation reports missing source, mismatched source, and anchors", async () => {
  const output = await fixtureForQualityChecks();
  const diagnostics: LintDiagnostic[] = [];
  await validateSourceSpan({ outputRoot: output }, { sourceId: "wrong", unitId: "u1", startAnchor: "b9999", endAnchor: "b9999", quote: "quote" }, "ref", diagnostics);
  await validateSourceSpan({ outputRoot: output }, { sourceId: "s1", unitId: "missing", startAnchor: "b0001", endAnchor: "b0001", quote: "quote" }, "missing", diagnostics);
  assert.ok(diagnostics.some((item) => item.code === "provenance-source-mismatch"));
  assert.ok(diagnostics.some((item) => item.code === "unresolved-provenance-anchor"));
  assert.ok(diagnostics.some((item) => item.code === "unresolved-provenance-unit"));
});

test("artifact validation reuses source-span validation and allows explicit empty quote mode", async () => {
  const output = await fixtureForQualityChecks();
  const artifact = { id: "validated", group: "people" as const, title: "Validated", sections: [{ heading: "Summary", body: "A" }], provenance: [{ sourceId: "s1", unitId: "u1", startAnchor: "b0002", endAnchor: "b0002", quote: "" }] };
  const rejected = await validateArtifact({ outputRoot: output, artifact });
  assert.equal(rejected.passed, true, JSON.stringify(rejected));
  assert.ok(rejected.diagnostics.some((item) => item.code === "missing-provenance-quote"));
  const accepted = await validateArtifact({ outputRoot: output, artifact, allowEmptyQuotes: true });
  assert.equal(accepted.passed, true);
  assert.equal(accepted.diagnostics.some((item) => item.code === "missing-provenance-quote"), false);
});
