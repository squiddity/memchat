# Mem-import legacy cleanup feature handoff

> **Historical migration record (non-product):** This handoff records behavior preserved while retiring legacy surfaces. It is not runtime authority and does not restore the retired runner, paths, or invocation APIs.

## Decision

**Cleanup completed 2026-08-04.** The legacy runtime, invocation surfaces, and nested projection layout were removed after the preserved behaviors and regression tests landed. The controlled legacy `world-import` versus `mem-import` token/cost A/B is waived. The legacy runner does not need to remain executable as a benchmark, and cleanup is not gated on collecting a new instrumented legacy run.

The useful product behavior identified below was preserved in mem-import-owned contracts and regression tests before deletion. This is a feature analysis, not a byte-parity or compatibility requirement: mem-import remains the production architecture, and legacy orchestration, CLI hosting, paths, names, and migration shims do not survive.

## Summary

Mem-import is materially stronger in authorization, bounded context, identity planning, canonical transactions, recovery, compendium maintenance, candidate accounting, lifecycle audit, and review/finalization enforcement. Legacy world-import has richer wiki-authoring guidance and several convenient evidence-repair surfaces. The most visible quality gap is hyperlinking: the shared emitter can resolve model-authored inline artifact markers, but active mem-import proposer/reviewer guidance does not currently require them as consistently as the legacy skill did.

## Feature comparison

| Area | Legacy world-import | Current mem-import | Cleanup/future decision |
|---|---|---|---|
| Inline prose links | Explicitly requires `[[artifact-id|reader label]]` across people, places, things, facts, style, synopsis, timeline, and guide prose. `related` is complementary, not a substitute. | The inherited emitter still resolves the syntax and lint catches unresolved markers, but active proposer/reviewer guidance does not establish a comparable link-density or traversal contract. | **Completed in cleanup.** Renderer/lint behavior and focused tests now live under mem-import names, with active proposer/reviewer traversal guidance. |
| Link correctness | Resolves exact IDs after final path planning, including cross-group links and filename collisions; preserves unknown markers for lint. | Receives this behavior only through imports from `src/world-import/`. | **Completed in cleanup.** This is a mem-import-owned deterministic contract; links are not inferred from plain titles or aliases. |
| Link completeness | Skill repeatedly asks the model to mark unambiguous durable references throughout authored prose. | No deterministic completeness check, and current role guidance emphasizes concise artifacts and narrative surfaces rather than traversal. | **Future quality work.** Add a reviewer lens for retrieval/traversal and structural graph statistics such as isolated artifacts and pages with no authored outbound traversal. Do not make TypeScript infer semantic mentions. |
| Narrative navigation | Detailed contracts for synopsis, timeline, chapter/scene/episode guide, reading order, and root-index promotion. | Workflow, proposer, and reviewer require synopsis, ordered timeline, guide, salient objects, and cross-unit identity continuity. Root-index behavior is inherited from the legacy emitter. | **Preserve tests; improve classification.** Retain narrative-index promotion under mem-import names and fix false `missing-plot-synopsis` warnings observed in the full Alice run. |
| Artifact presentation | Strong progressive-disclosure guidance: description/capsule, standalone summary, richer sections, metadata, related links, and provenance. | Schema supports description, sections, type, tags, resource, timestamp, related, and metadata, but active role prose is less explicit about standalone retrieval quality and section shape. | **Preserve the schema and rendering.** Add concise retrieval-quality guidance rather than copying the old long templates wholesale. |
| Provenance validation | Exact local anchors, retained source pages, lint, density warnings, provenance audit, and helper commands for quote/ref repair. | Exact local anchors and service-derived quotes are stronger; checks reuse the same provenance lint/audit implementation. Worker reads are assignment-bound and auditable. | **Completed in cleanup.** Normalization, source-page emission, validation, lint, and provenance checks are mem-import-owned. |
| Evidence-repair ergonomics | CLI helpers include `find-text`, `suggest-ref-candidates`, `quote-ref`, `resolve-ref`, repair summaries, and an emit/lint loop. | Workers can reopen bounded source spans but have no equivalent bounded text-search or citation-candidate tool. This keeps authority narrow but makes difficult provenance repair more manual. | **Future work.** Consider assignment-scoped, cursor-bounded source search and citation-candidate tools. Do not retain the unrestricted helper CLI. |
| Coverage/accounting | Source-unit coverage and candidate disposition checks, but monolithic merge construction and runner-owned recovery. | Exact proposal disposition coverage, canonical candidate accounting, immutable effects, conflicts, and finalization gates. | Keep mem-import behavior. Port only reusable deterministic coverage presentation. |
| Identity and continuity | Model guidance asks for merged identities, bidirectional links, maintained-world updates, preserved evidence, and visible retcons. | Identity-aware cluster plans, reconciliation packets, canonical dependencies, conflict records, and compendium runs are substantially stronger. | Keep mem-import architecture. Add wiki-authoring guidance for bidirectional traversal and updating synopsis/entity pages when new works affect them. |
| Review | Broad evaluator rubric and staged post-merge review, with useful quality scores and reconstruction summary, but weaker durable mutation/audit boundaries. | Revision-bound reviewer packets, scoped repair assignments, required clean post-repair review, and deterministic finalization blockers. | Keep mem-import enforcement. An optional non-gating quality evaluation/report may later restore broad scoring for longitudinal quality measurement. |
| Recovery and concurrency | Persist-first artifacts and bounded repair attempts, but embedded runner and complete-stage mutation limits. | Fenced/CAS canonical commits, immutable transactions, reconstructable effects, remaining-only recovery, and terminal authorization epochs. | Keep mem-import behavior; delete legacy runner. |
| Multi-work maintenance | Existing emitted world can be inspected and updated, with prose guidance for retcons. | First-class compendium/run separation, duplicate-source decisions, canonical preservation, and shared projection. | Keep mem-import behavior and make the compendium root the only production layout. |
| Invocation surface | Shell CLI, helper CLI, embedded Pi runner, dry-run, staged/single modes. | Host-agent-led skill plus typed tools and constrained subagents. | Delete legacy invocation surfaces. Revisit a mem-import CLI only through the separate explicit CLI decision; do not inherit legacy hosting. |

## Completed preservation work

The following preservation work is complete in the active `mem-import` modules and focused tests; this list is retained as the historical acceptance record:

1. Move normalization, span handling, stage types, deterministic rendering, indexes, retained source pages, lint, coverage, provenance audit, and run-log projection into semantically named `src/mem-import/` modules.
2. Preserve focused tests for:
   - exact inline marker resolution to portable cross-group Markdown links;
   - labels/aliases, self-link suppression, and protection of existing links, URLs, inline code, and fenced code;
   - unresolved marker and broken internal-link diagnostics;
   - `related` navigation and unresolved-related diagnostics;
   - narrative-surface promotion in the root index;
   - retained source-page provenance links and anchors;
   - category indexes, coverage, and log projection.
3. Add the active mem-import authoring contract:
   - use exact-ID inline markers for clear mentions of durable artifacts in section prose;
   - use natural reader-facing labels, including aliases and possessives;
   - do not link pronouns, ambiguous common nouns, the current artifact, code, URLs, or existing Markdown links;
   - use `related` for structured/deduplicated navigation, not as a replacement for traversable prose;
   - link important relationships and event participation in both useful directions when both artifacts exist.
4. Add reviewer coverage for traversal/retrieval usefulness. Missing links should be semantic findings only when the inspected pages are materially hard to navigate; deterministic checks should continue to validate declared links without pretending to identify every linkable plain-text mention.
5. Build from a clean `dist/` and assert that active source, tests, built output, skills, package metadata, and user-facing docs contain no legacy or roadmap identifiers. Historical plans/evaluations may retain them as explicitly archival records.

## Prioritized future work after cleanup

### Near term

- Add compact graph diagnostics: isolated artifacts, no-outbound-navigation pages, unresolved declared links, and optionally asymmetric `related` edges. Treat these as warnings or reviewer inputs, not proof of semantic incompleteness.
- Improve narrative-surface classification so valid synopsis-like artifacts do not trigger false missing-synopsis warnings.
- Reduce the full Alice provenance warnings, especially under-cited style artifacts, heading-only citations, repeated identical citations, and low-information spans.
- Strengthen maintained-compendium authoring guidance so new work updates affected overview, timeline, identity, relationship, and event pages while preserving prior provenance and explicit conflicts.

### Later

- Add assignment-scoped bounded source text search and citation-candidate discovery if real repairs show repeated need.
- Add an optional broad quality evaluation report for hyperlink traversal, reconstruction, omission visibility, prose usefulness, and provenance quality. Keep it outside installation acceptance and terminal correctness.
- Evaluate retrieval over emitted Markdown to determine whether descriptions, section summaries, tags, and links actually improve artifact discovery; tune authoring guidance from those results.

## Cleanup completion evidence

The cleanup gate is satisfied: the cost comparison waiver is recorded, preserved behaviors have mem-import-owned tests, active guidance includes the hyperlinking/traversal contract, and the baseline passed `rm -rf dist && npm run build`, focused path/stage/projection/lint tests, `npm run test:cleanup`, `npm run test:mem-import`, `npm test`, `npm pack --dry-run`, and `git diff --check`. No new model-backed legacy import is required.

Post-cleanup quality follow-ups are limited to graph/traversal diagnostics, narrative-surface classification, provenance specificity, maintained-compendium guidance, bounded evidence search, optional longitudinal quality evaluation, and retrieval tuning described above.
