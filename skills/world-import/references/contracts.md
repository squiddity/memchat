# World import contracts

This contract is skill-owned guidance for the model. TypeScript helpers validate only the operational envelope: JSON shape, source-span refs, output group routing, and markdown packet fields. Helpers must not decide entity identity, aliases, fact semantics, conflicts, or merge correctness.

## Source span reference

Every semantic claim should cite at least one source span:

```json
{
  "sourceId": "chapter-1-abc12345",
  "unitId": "chapter-1-abc12345-u001",
  "startAnchor": "b0003",
  "endAnchor": "b0004",
  "quote": "Short exact or lightly trimmed supporting excerpt."
}
```

## Extraction stage envelope

Persist one envelope per normalized unit:

```json
{
  "version": 1,
  "kind": "extraction",
  "sourceId": "...",
  "unitId": "...",
  "candidates": [
    {
      "id": "model-chosen-local-id",
      "group": "people|places|things|facts",
      "title": "Name or concise claim title",
      "provenance": [{ "sourceId": "...", "unitId": "...", "startAnchor": "b0001", "endAnchor": "b0001", "quote": "..." }],
      "payload": {
        "description": "Rich, detailed description drawn from the source text. Include sensory details, narrative context, and direct quotations where they illuminate.",
        "traits": ["curious", "reckless", "imaginative"],
        "relationships": [{ "target": "character-name", "type": "pursues", "detail": "Alice follows the White Rabbit down the hole" }],
        "events": ["Falls down rabbit hole observing her surroundings"],
        "significance": "Why this entity matters in the narrative arc",
        "uncertainty": "Note any ambiguity or conflicting evidence from the source"
      }
    }
  ],
  "diagnostics": []
}
```

**Candidate `payload` is intentionally opaque to helper code.** The model may use rich fields inside it — `description`, `traits`, `relationships`, `events`, `significance`, `personality`, `atmosphere`, `symbolism`, or any other useful structure. The helper will not interpret these fields; they exist for the merge pass and for future model reuse.

**Guidance for rich payloads:**

- Characters: include `description`, `personality`, `traits`, `role`, `actionsInUnit`, `relationships`, `dialogue`
- Places: include `description`, `atmosphere`, `events`, `visitors`, `significance`
- Things: include `description`, `significance`, `possessor`, `narrativeContext`
- Facts: include `event`, `participants`, `cause`, `consequence`, `setting`, `detail`

## Merge stage envelope

Persist a single merge stage:

```json
{
  "version": 1,
  "kind": "merge",
  "artifacts": [
    {
      "id": "stable-human-readable-id",
      "group": "people|places|things|facts",
      "title": "Artifact title",
      "sections": [
        { "heading": "Summary", "body": "Model-authored markdown body." },
        { "heading": "Description", "body": "Full physical and personality description." },
        { "heading": "Role in Narrative", "body": "What this entity does and how it drives the story." },
        { "heading": "Relationships", "body": "Connections to other entities with detail." },
        { "heading": "Key Events", "body": "Important narrative events involving this entity." },
        { "heading": "Uncertainty", "body": "Preserve ambiguity or disputes here when relevant." }
      ],
      "provenance": [{ "sourceId": "...", "unitId": "...", "startAnchor": "b0001", "endAnchor": "b0002", "quote": "..." }],
      "related": ["other-artifact-id"],
      "metadata": {
        "opaque": "Optional model-owned detail for future passes."
      }
    }
  ],
  "diagnostics": []
}
```

The artifact packet is the only structure the emitter needs. Put human-readable semantic content in `sections`; put machine-oriented semantic hints in `metadata` only if useful for future model passes.

### Section guidance

Recommended sections for richer artifacts:

| Entity Type | Recommended Sections |
|---|---|
| people | Summary, Description, Personality, Role in Narrative, Relationships, Key Events, Dialogue, Uncertainty |
| places | Summary, Description, Atmosphere, Notable Events, Visitors & Inhabitants, Significance, Uncertainty |
| things | Summary, Description, Significance, Possessor & Use, Narrative Context, Uncertainty |
| facts | Summary, What Happened, Participants, Cause & Effect, Setting, Significance, Uncertainty |

The model may choose different headings as appropriate. The goal is **rich, standalone detail** balanced with **cross-references for deduplication**:

- Each artifact's `Summary` or `Key Events` section should give enough context to be useful when retrieved alone via vector search.
- For full scene-by-scene event detail, create a dedicated `facts` artifact and link to it via `related`. Character and place artifacts should summarize events and link, rather than retelling the entire scene.
- Example: Alice's entry has a "Key Events" section listing the croquet game participation and linking `related: ["queens-croquet-game"]`. The full croquet game blow-by-blow lives once in `facts/queens-croquet-game.md`.
- Cross-reference in both directions: the fact artifact for the croquet game should include `related: ["alice", "queen-of-hearts", "croquet-ground"]`.

## Merge rules for the model

- Start from extraction candidates, not raw full text.
- Merge only when evidence supports same identity or same durable fact.
- **Combine all evidence** — when merging, preserve every useful detail from each candidate. Avoid losing specificity during merge.
- Preserve multiple provenance refs after merge.
- Keep weak aliases or contradictions visible in sections/metadata instead of flattening them.
- Use `read-slice` for targeted rereads only when candidate evidence is insufficient.
- Do not invent facts to fill a taxonomy.
