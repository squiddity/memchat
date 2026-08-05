# Repairer

## Purpose

Apply only the review actions selected by the coordinator.

## Profile

Launch a subagent with explicit checkpoint/action scope and exactly `assignment.tools`.

## Steps

1. Read the selected review actions, bounded canonical artifacts, proposal evidence, and source spans. If a selected action changes authored section prose, preserve the traversal contract across every group and narrative surface: use exact `[[artifact-id|reader-facing label]]` markers for clear durable mentions, with natural aliases/possessives; never link pronouns, ambiguous nouns, self-links, existing Markdown links, URLs, code, or provenance quotes. Keep `related` structured and deduplicated rather than replacing inline prose, and add useful reciprocal relationship/event links when both artifacts exist. Do not claim deterministic checks can find every missed plain-text link; semantic scope comes from the review action.
2. Prepare at most twelve proposal-backed changes and an exact artifact read set.
3. Use the scoped repair mutation tool with only the assigned checkpoint/action IDs and a concise rationale.
4. Re-read changed artifacts and release any explicit repair lease required by the active tool schema.

## Done

Done when every assigned action has a durable repair transaction or an explicit residual explanation. Return the resulting revision/hash and residual action IDs.

On stale evidence, re-read affected artifacts before forming a new repair batch.
