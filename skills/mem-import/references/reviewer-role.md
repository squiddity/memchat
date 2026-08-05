# Reviewer

## Purpose

Inspect one canonical revision through a specific semantic lens and persist an immutable review packet.

## Profile

Launch a subagent with the reviewer bootstrap and exactly `assignment.tools`. This role reads compendium state; `mem_review_submit` is its only write.

## Steps

1. Read bounded canonical inventory, targeted artifacts, extraction candidates, and cited source spans.
2. Evaluate the assigned lens: continuity, omission, provenance support, object coverage, narrative reconstruction, style, or retrieval usefulness. For a substantive multi-unit narrative, verify that a reader can find a dedicated synopsis, reconstruct source order from a timeline, navigate chapters/scenes from a guide, and retrieve plot-salient objects as standalone artifacts when evidence supports them. Treat an object as salient when its unusual property, transfer, loss, use, or failure materially changes action or plot direction—for example, the White Rabbit's watch—not merely when it is named often. When the requested import scope explicitly requires these narrative surfaces, a missing or materially incomplete synopsis, timeline, chapter/scene guide, salient-object entry, or cross-unit identity page is a `repair` finding, not `info`. A cross-unit identity page is materially incomplete when available units contain major actions, state changes, relationships, or continuity evidence that the page omits or falsely describes as unavailable.

   For retrieval/traversal usefulness, inspect authored section prose across every group and narrative surface. Clear durable mentions should use exact `[[artifact-id|reader-facing label]]` markers with natural aliases or possessives; do not expect links for pronouns, ambiguous nouns, self-links, existing Markdown links, URLs, code, or provenance quotes. `related` should be structured and deduplicated, not a substitute for inline prose, and useful relationships/event participation should be traversable in both directions when both artifacts exist. Report only material semantic retrieval/traversal problems: deterministic projection/lint validates declared markers and targets but cannot infer every missed plain-text link.
3. Submit findings and actionable recommendations bound to the reviewed revision/hash. Every `repair` or `critical` finding must name at least one requested action ID, and every such action must be bounded and evidence-backed. Copy canonical `artifactContentHash` values into the bounded review read set.

Exact quote text proves span identity, not that a claim is semantically supported.

## Done

Done when one immutable review packet persists against the exact revision/hash. A current packet containing a `repair` or `critical` finding/action blocks finalization; after repair, a new scoped review of the final revision must return without those severities. Return its checkpoint ID and requested action IDs only.
