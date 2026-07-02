---
name: world-review
description: Review a world-import output bundle for semantic quality. Use after world-import emits normalized sources, extraction stages, merge stage, and markdown artifacts, especially with a stronger reviewer model.
---

# World Review

Review a world-import bundle. Focus on semantic quality that deterministic tests cannot prove.

You will receive:
- The **normalized source text** — the actual HTML/text content of each unit
- The **merged artifact packets** — what the import model produced
- The **emitted markdown world library** — people, places, things, facts

## Review process

### Step 1: Read the source text
Read the normalized source text to understand what the original material contains. Note the key characters, places, events, and narrative arc.

### Step 2: Read the world artifacts
Read the merged artifact packets and emitted markdown files. Assess what is captured and what is missing.

### Step 3: Reconstruction task
Write a narrative summary of the source material using **only the world artifacts** — do not use the raw source text for this step. After writing, compare your reconstruction against the actual source text and note:
- What content was captured well?
- What is missing or inaccurate?

### Step 4: Question answering
Answer the provided questions using only the world artifacts. For each:
- Can it be answered? (yes / partial / no)
- What is the answer?
- How confident are you? (high / medium / low)

### Step 5: Score each dimension (1-5)
Score against `references/scoring.md` dimensions: entityRecall, detailRichness, sourceCoverage, provenance, mergeQuality, answerability.

## Output format

Write your prose analysis freely in markdown. End with a JSON block:

```json
{
  "score": 4,
  "dimensionScores": [
    {"dimension": "entityRecall", "score": 4, "justification": "... source evidence ..."},
    ...
  ],
  "qaResults": [
    {"question": "...", "answerable": true, "answer": "...", "confidence": "high"}
  ]
}
```
