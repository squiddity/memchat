# Artifact format

The merge model emits artifact packets. The deterministic emitter renders them without interpreting domain semantics.

## Directories

- `world/people/`
- `world/places/`
- `world/things/`
- `world/facts/`

The `group` field chooses the directory. The emitter does not decide whether the group is semantically correct.

## Markdown shape

Each artifact becomes one markdown file:

```markdown
---
id: "artifact-id"
group: people
title: "Artifact title"
related: ["other-id"]
---

# Artifact title

## Summary

Model-authored content.

## Uncertainty

Optional model-authored ambiguity or dispute notes.

## Related

- [[other-id]]

## Provenance

1. `source-id/unit-id#b0001-b0002`
   > Supporting quote.
```

## Guidance for sections

Recommended sections are `Summary`, `Details`, `Relationships`, `Open Questions`, and `Uncertainty`, but the model may choose different headings. Keep sections readable if the stage JSON is ignored.

## Provenance

Every artifact needs at least one provenance ref. Prefer short quotes that establish the claim. When an artifact combines multiple sources, include multiple refs.
