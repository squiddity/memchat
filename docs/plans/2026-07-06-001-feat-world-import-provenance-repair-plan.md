---
title: "feat: Add world-import provenance audit and repair tooling"
type: feat
date: 2026-07-06
origin: Sherlock Holmes DeepSeek import provenance evaluation
---

# feat: Add world-import provenance audit and repair tooling

## Summary

Improve `world-import` provenance quality beyond structural validity by adding deterministic audit and source-search helpers that help the model repair weak citations in-place.

The Sherlock Holmes DeepSeek import produced a structurally clean bundle: 55 artifacts, 78 markdown files, 58/58 provenance links resolved, 14/14 source pages retained, and zero unaccounted candidates. However, reviewer scoring still gave provenance only 3/5 because many citations were too coarse: story-heading blocks, single broad refs for complex artifacts, and citations that identify the story rather than supporting specific descriptive claims.

This plan adds provenance-specific diagnostics and repair helpers:

- `provenance-audit` — identify weak but structurally valid provenance;
- `find-text` — lexical search over normalized source blocks;
- `suggest-ref-candidates` — retrieve candidate source spans for a claim using deterministic lexical overlap;
- optional `find-claims` — extract likely citation-worthy claims/terms from an artifact for repair planning;
- skill workflow updates for provenance repair after clean lint.

The goal is not to make TypeScript judge whether a claim is true. The helpers should surface candidate evidence and weak citation patterns so the model can choose appropriate source spans and patch artifact provenance with `quote-ref --as-ref` / `patch-merge` / `write-artifact`.

---

## Problem Frame

Current deterministic lint answers: "Do provenance links resolve?" It does not answer: "Do these refs actually support the claims?" The Sherlock run showed that a bundle can be clean while still weakly cited.

Examples of weak-but-valid provenance:

- A character page cites only the story heading, e.g. `VII. THE ADVENTURE OF THE BLUE CARBUNCLE`.
- A fact/event artifact cites only the first block of a story, even though the event details appear much later.
- A long artifact has many sections but only one provenance ref.
- A style artifact makes several voice/tone claims but cites only one broad passage.
- An object page cites the story title rather than the passage where the object is described or used.

These issues are repairable with existing source units, but repair is slow because the model must manually read large units to locate supporting passages. We do not need vector search first. Deterministic lexical search and audit tools can substantially improve repair efficiency while preserving semantic ownership.

---

## Goals

- G1. Detect weak provenance patterns that lint currently treats as valid.
- G2. Make in-place provenance repair practical for already-emitted bundles.
- G3. Provide bounded source search helpers so models can find candidate evidence without reading entire source units.
- G4. Keep all truth/claim-support judgments model-owned; helpers only surface candidates and structural/heuristic signals.
- G5. Encourage exact source excerpts via `quote-ref --as-ref`.
- G6. Integrate provenance repair into the skill workflow after clean deterministic lint and before reviewer/eval success claims.

## Non-goals

- NG1. Do not implement semantic/vector retrieval in this phase.
- NG2. Do not auto-rewrite artifact prose or auto-decide which source span proves a claim.
- NG3. Do not require every sentence to have a citation.
- NG4. Do not make heading citations universally invalid; headings can identify story/source context, but they are insufficient for detailed claims.
- NG5. Do not encode corpus-specific Sherlock/Alice/Frankenstein ontology in helper code.

---

## Proposed Helper Commands

All commands use the existing entrypoint:

```bash
npm run world-import-helper -- <command> ...
```

## 1. `provenance-audit`

Audit merge-stage artifact provenance for weak citation patterns.

### Usage

```bash
npm run world-import-helper -- provenance-audit --output world-output/sherlock-holmes-deepseek
```

Options:

```bash
--artifact <artifact-id>       # limit to one artifact
--format json|markdown         # default json
--strict                       # promote selected warnings to errors for CI/regression use
--write                        # write stages/provenance-audit.{json|md}
```

### Checks

The command should report warnings for:

1. **Heading-only refs**
   - Cited block kind is `heading`, or quote matches a unit/story title.
   - Especially suspicious when the artifact is not merely identifying the story.

2. **Very short / low-information quotes**
   - Quote length below threshold, e.g. `< 30 chars`.
   - Quote is mostly title-case/story heading.

3. **One ref for many sections**
   - Artifact has many non-empty sections but only one provenance ref.
   - Suggested threshold: `sections >= 4 && refs < 2`.

4. **Sparse provenance density**
   - Heuristic ratio: refs per section, refs per body length.
   - Example warning: `8 sections, 2400 body chars, 1 ref`.

5. **Repeated identical ref across many artifacts**
   - Same `unitId/start/end` used by many artifacts.
   - Not necessarily wrong, but indicates possible story-heading reuse.

6. **Refs concentrated on first block only**
   - Many refs use `b0001`, especially if `b0001` is a heading.

7. **Style artifacts with too few examples**
   - Style pages should usually cite multiple source examples.
   - Warning if `group=style` and refs `< 3` for substantive style pages.

8. **Fact/event artifacts lacking event-body evidence**
   - If only heading refs are present, warn that event details likely need later blocks.

### Output

```json
{
  "passed": true,
  "summary": {
    "artifacts": 55,
    "warnings": 24,
    "errors": 0
  },
  "diagnostics": [
    {
      "code": "heading-only-provenance",
      "level": "warning",
      "artifactId": "blue-carbuncle",
      "unitId": "...-h-7-...-u001",
      "path": "artifacts.blue-carbuncle.provenance[0]",
      "message": "Citation points to a heading block; detailed object claims need narrative evidence.",
      "suggestion": "Use find-text or suggest-ref-candidates, then quote-ref --as-ref to replace/add provenance."
    }
  ]
}
```

`passed` should mean no errors. Warnings are quality findings and should not block basic lint by default.

### Deterministic scope

Allowed:

- Detect block kinds, quote length, ref density, repeated refs, heading refs.
- Suggest helper commands.

Not allowed:

- Decide that a specific claim is true or false.
- Remove citations automatically.
- Change artifact prose.

---

## 2. `find-text`

Lexically search normalized source blocks for exact words/phrases.

### Usage

```bash
npm run world-import-helper -- find-text \
  --output world-output/sherlock-holmes-deepseek \
  --query "cocaine" \
  --context 2
```

Options:

```bash
--unit <unit-id>             # restrict search
--order <number>             # restrict by manifest order
--group-body-only            # skip frontmatter/backmatter/toc
--case-sensitive             # default false
--regex                      # query is regular expression
--context <n>                # include N neighboring blocks before/after
--max-results <n>            # default 20
--format json|markdown       # default json
```

### Output

```json
{
  "query": "cocaine",
  "matches": [
    {
      "unitId": "...",
      "sourceId": "...",
      "order": 1,
      "title": "A Scandal in Bohemia",
      "anchor": "b0012",
      "kind": "paragraph",
      "text": "...",
      "context": [
        { "anchor": "b0011", "text": "..." },
        { "anchor": "b0012", "text": "..." },
        { "anchor": "b0013", "text": "..." }
      ],
      "quoteRefCommand": "npm run world-import-helper -- quote-ref --output ... --unit ... --start b0012 --end b0012 --as-ref"
    }
  ]
}
```

### Motivation

This is the simplest useful repair aid. It lets models find exact spans for named people, objects, locations, distinctive phrases, and style examples.

---

## 3. `suggest-ref-candidates`

Given a claim string, return candidate source spans ranked by lexical overlap and source proximity.

### Usage

```bash
npm run world-import-helper -- suggest-ref-candidates \
  --output world-output/sherlock-holmes-deepseek \
  --claim "Holmes alternates between languor and fierce energy when a case begins" \
  --artifact sherlock-holmes
```

Options:

```bash
--claim <text>              # required unless --claim-file
--claim-file <path>
--artifact <artifact-id>    # use existing artifact provenance/related units as search hints
--unit <unit-id>            # restrict search
--max-results <n>           # default 10
--window <n>                # combine neighboring blocks into candidate spans, default 1
--format json|markdown
```

### Ranking heuristic

Use deterministic lexical scoring:

- tokenize claim and source blocks;
- normalize case and punctuation;
- remove common stopwords;
- score by token overlap / weighted rare terms;
- boost exact phrase matches;
- boost blocks in units already cited by the artifact;
- boost nearby blocks when `--artifact` provenance points into the same unit;
- do not make truth claims.

### Output

```json
{
  "claim": "Holmes alternates between languor and fierce energy when a case begins",
  "candidates": [
    {
      "score": 0.72,
      "unitId": "...",
      "sourceId": "...",
      "startAnchor": "b0010",
      "endAnchor": "b0011",
      "quote": "...",
      "matchedTerms": ["languor", "energy", "case"],
      "quoteRefCommand": "npm run world-import-helper -- quote-ref --output ... --unit ... --start b0010 --end b0011 --as-ref"
    }
  ]
}
```

### Motivation

This avoids requiring sophisticated retrieval for first-pass provenance repair. It is deterministic, inspectable, and enough for many literary imports where exact names/phrases appear in the source.

---

## 4. `find-claims` (optional / phase 2)

Extract likely citation-worthy claim snippets from an artifact using simple heuristics.

### Usage

```bash
npm run world-import-helper -- find-claims \
  --output world-output/sherlock-holmes-deepseek \
  --artifact sherlock-holmes
```

### Heuristic extraction

Detect sentences or bullets likely to need support:

- sentences with named entities;
- physical descriptions;
- relationship claims;
- superlatives or interpretive style claims;
- event claims with verbs like `murders`, `steals`, `discovers`, `reveals`, `outwits`;
- object significance claims;
- style/tone claims.

### Output

```json
{
  "artifactId": "sherlock-holmes",
  "claims": [
    {
      "path": "sections[2].body sentence 3",
      "text": "He alternates between cocaine-induced languor and fierce energy when a case begins.",
      "suggestRefCandidatesCommand": "npm run world-import-helper -- suggest-ref-candidates --output ... --artifact sherlock-holmes --claim '...'"
    }
  ]
}
```

### Scope

This helper does not decide whether a sentence is true. It only helps plan evidence repair.

---

## Repair Workflow

### A. After import passes lint

Run:

```bash
npm run world-import-helper -- provenance-audit --output <output> --format markdown --write
```

Then inspect:

```bash
less <output>/stages/provenance-audit.md
```

### B. Select repair targets

Prioritize:

1. heading-only refs on important people/facts/things;
2. style artifacts with too few examples;
3. long artifacts with one provenance ref;
4. fact/event pages citing only story headings;
5. reviewer-identified weak examples.

### C. Locate better source spans

Use exact search first:

```bash
npm run world-import-helper -- find-text --output <output> --query "blue carbuncle" --context 2
```

Use claim-based candidate search when the claim is paraphrased:

```bash
npm run world-import-helper -- suggest-ref-candidates \
  --output <output> \
  --artifact blue-carbuncle \
  --claim "The blue carbuncle is found inside a Christmas goose's crop"
```

### D. Produce quote-populated refs

```bash
npm run world-import-helper -- quote-ref \
  --output <output> \
  --unit <unit-id> \
  --start b0014 \
  --end b0015 \
  --as-ref
```

### E. Patch or rewrite artifact provenance

For a small provenance replacement:

```bash
npm run world-import-helper -- patch-merge --output <output> --file patch.json
```

For larger section/provenance edits, rewrite the artifact JSON and use:

```bash
npm run world-import-helper -- write-artifact --output <output> --mode replace --file artifact.json
```

### F. Re-emit and re-check

```bash
npm run world-import-helper -- emit-lint-repair-loop --output <output>
npm run world-import-helper -- provenance-audit --output <output>
npm run world-import-helper -- eval --output <output> --reviewer-model <model>
```

---

## Skill Guidance Updates

Update `skills/world-import/SKILL.md` and `references/helper-tools.md`:

- Clean lint is necessary but not sufficient for high-quality provenance.
- Heading/title refs are acceptable for identifying a story/unit but not as sole evidence for detailed claims.
- For final artifacts, use `quote-ref --as-ref` for claim-supporting refs.
- Run `provenance-audit` before eval or before declaring a high-quality import.
- Use `find-text` and `suggest-ref-candidates` for repair before reading whole units.
- Repair should add or replace provenance refs, not blindly rewrite semantic prose.

Add artifact-type guidance:

- **People:** cite appearance/personality/role claims separately when possible.
- **Places:** cite physical description and narrative significance.
- **Things:** cite first description, possessor/use, and consequence.
- **Facts/events:** cite setup, key action/reveal, and consequence.
- **Style:** cite multiple representative examples across the corpus.
- **World overview:** may use broader refs, but should not be the only detailed provenance in the bundle.

---

## Implementation Phases

### Phase 1 — Audit and lexical search

Implement:

- `provenance-audit`
- `find-text`
- markdown/json output
- docs/skill updates

Acceptance criteria:

- Sherlock output reports heading-only/thin citation warnings.
- `find-text --query "carbuncle"` returns source blocks and quote-ref commands.
- Existing lint remains structural and does not fail on provenance quality warnings by default.

### Phase 2 — Claim candidate search

Implement:

- `suggest-ref-candidates`
- tokenization/stopword scoring
- artifact-aware boosting
- quote-ref command suggestions

Acceptance criteria:

- Given a claim from an artifact, returns plausible candidate refs from the correct story/unit.
- Does not claim proof or modify artifacts.

### Phase 3 — Optional claim extraction

Implement:

- `find-claims`
- simple sentence/bullet heuristics
- integration with `suggest-ref-candidates` commands

Acceptance criteria:

- For a long person artifact, returns a bounded list of likely citation-worthy claims.
- Output is useful for model repair planning without overwhelming context.

### Phase 4 — Repair validation loop

Enhance:

- `repair-summary` to include provenance-audit findings;
- `emit-lint-repair-loop` optionally runs `provenance-audit` when `--audit-provenance` is passed;
- eval review bundle can embed provenance audit summary.

Acceptance criteria:

- A clean-lint bundle can still report provenance quality warnings.
- Reviewer/eval output can see deterministic provenance audit findings.

---

## Testing Plan

### Unit tests

Add tests for:

- heading-only provenance detection;
- low-information quote detection;
- sparse provenance density;
- repeated ref detection;
- `find-text` exact, case-insensitive, regex, context, max-result behavior;
- `suggest-ref-candidates` token overlap ranking;
- artifact-limited search boosting;
- markdown and JSON output shapes.

### Fixture tests

Create a minimal world output with:

- one artifact citing only a heading block;
- one artifact with a good narrative ref;
- one long artifact with one ref;
- one style artifact with one ref;
- normalized source blocks containing searchable text.

Expected:

- `lint` passes if links resolve;
- `provenance-audit` warns;
- `find-text` finds target blocks;
- `suggest-ref-candidates` ranks the correct source block highly.

### Manual regression

Run on Sherlock output:

```bash
npm run world-import-helper -- provenance-audit --output world-output/sherlock-holmes-deepseek --format markdown --write
npm run world-import-helper -- find-text --output world-output/sherlock-holmes-deepseek --query "carbuncle" --context 2
npm run world-import-helper -- suggest-ref-candidates --output world-output/sherlock-holmes-deepseek --artifact blue-carbuncle --claim "The blue carbuncle is found in a Christmas goose's crop"
```

Success signal: audit identifies the same provenance weaknesses the reviewer noted, and search helpers return usable source spans for repair.

---

## Risks and Mitigations

### Risk: Audit warnings become pseudo-semantic judgments

Mitigation: Keep messages phrased as weak provenance patterns, not truth verdicts. Use `warning` by default.

### Risk: Lexical search misses paraphrased evidence

Mitigation: Accept this limitation. `suggest-ref-candidates` is a deterministic aid, not a full retriever. Models can still use `read-unit`.

### Risk: Too many warnings overwhelm repair

Mitigation: Add prioritization fields and `--artifact` filtering. Default markdown output should group by severity and artifact importance signals.

### Risk: Models overfit to quote density

Mitigation: Skill guidance should say better provenance means claim-supporting evidence, not mechanically maximizing citation count.

---

## Acceptance Criteria

The work is complete when:

- `provenance-audit` detects heading-only, low-information, sparse, repeated, and style-under-cited refs.
- `find-text` searches normalized source blocks and returns source anchors plus `quote-ref` commands.
- `suggest-ref-candidates` returns ranked candidate spans for a claim using deterministic lexical scoring.
- Skill docs instruct agents to run provenance audit after clean lint and repair with `quote-ref --as-ref`.
- Existing build/tests pass.
- A Sherlock Holmes audit flags the reviewer-observed weak provenance patterns.
- A targeted Sherlock repair can replace at least one heading-only ref with exact narrative evidence, then pass lint and show fewer audit warnings.
