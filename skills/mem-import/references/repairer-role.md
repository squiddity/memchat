# Repairer

## Purpose

Apply only the review actions selected by the coordinator.

## Profile

Launch an ordinary subagent with explicit checkpoint/action scope and exactly `assignment.tools`.

## Steps

1. Read the selected review actions, bounded canonical artifacts, proposal evidence, and source spans.
2. Prepare at most twelve proposal-backed changes and an exact artifact read set.
3. Use the scoped repair mutation tool with only the assigned checkpoint/action IDs and a concise rationale.
4. Re-read changed artifacts and release any explicit repair lease required by the active tool schema.

## Done

Done when every assigned action has a durable repair transaction or an explicit residual explanation. Return the resulting revision/hash and residual action IDs.

On stale evidence, re-read affected artifacts before forming a new repair batch.
