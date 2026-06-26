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
        "modelOwnedFields": "Use whatever semantic fields are useful for merge: aliases, traits, relationships, uncertainty, candidate type, etc."
      }
    }
  ],
  "diagnostics": []
}
```

Candidate `payload` is intentionally opaque to helper code. The model may use rich fields inside it, but the helper will not interpret them.

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

## Merge rules for the model

- Start from extraction candidates, not raw full text.
- Merge only when evidence supports same identity or same durable fact.
- Preserve multiple provenance refs after merge.
- Keep weak aliases or contradictions visible in sections/metadata instead of flattening them.
- Use `read-slice` for targeted rereads only when candidate evidence is insufficient.
- Do not invent facts to fill a taxonomy.
