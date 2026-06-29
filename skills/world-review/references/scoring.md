# World review scoring

Score 1-5 for each dimension. The reviewer receives both the normalized source text and the emitted artifacts so it can directly compare.

## Dimensions

### 1. entityRecall (1-5)
Are important characters, places, things, and events represented in the artifacts?
- 1 = Major characters, locations, and events are entirely missing
- 3 = Most important entities are present but some notable ones are absent
- 5 = Every significant person, place, thing, and event from the source is captured

### 2. detailRichness (1-5)
Do artifacts have meaningful detail, or are they too brief and summary-like?
- 1 = Artifacts are one-liners with no description, traits, or narrative context
- 3 = Artifacts have basic description but lack depth (character personality, place atmosphere, event significance)
- 5 = Artifacts are richly detailed: characters have descriptions, personality, role, and narrative arc; places have atmosphere, significance, and notable events; facts capture full event context

### 3. sourceCoverage (1-5)
Do artifacts span the key narrative content? Can someone reconstruct the story from them?
- 1 = Artifacts cover only a tiny fraction of the source narrative
- 3 = Artifacts cover major plot points but significant sections of the source are absent
- 5 = The world library faithfully captures the full narrative; a reader could reconstruct the source content from artifacts alone

### 4. provenance (1-5)
Are source span references and quotes accurate and useful?
- 1 = Provenance refs are missing, point to wrong locations, or quotes don't match the source
- 3 = Most refs are present but some quotes are truncated or imprecise
- 5 = Every claim has an accurate, precise source span with a usable direct quote

### 5. mergeQuality (1-5)
Are aliases handled? Is detail preserved rather than over-summarized across sources?
- 1 = Merge lost all detail and flattened everything into generic summaries; duplicates abound
- 3 = Merge preserved most detail but occasional over-summary or unnecessary deduplication
- 5 = Merge combines evidence from all sources while preserving every useful detail; weak aliases are noted as uncertain rather than silently merged

### 6. answerability (1-5)
Can someone answer substantive questions about the source using only the artifacts?
- 1 = Cannot answer basic questions about characters, plot, or setting
- 3 = Can answer simple factual questions but not detailed/narrative ones
- 5 = Can answer detailed questions about character traits, relationships, event sequences, and thematic content

## Review process

1. **Reconstruction**: Write a narrative summary using ONLY the world artifacts. Compare against the actual source text. Note gaps and inaccuracies.
2. **QA**: Answer the provided questions about the source using only the artifacts. Assess whether artifacts contain enough information.
3. **Score**: Assign 1-5 per dimension with specific evidence from both source text and artifacts.

Return a JSON block at the end of your response with `score`, `dimensionScores[]`, and `qaResults[]`.

If reviewer-model access is unavailable, state that semantic scoring was skipped rather than pretending deterministic checks covered it.
