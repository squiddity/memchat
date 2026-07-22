# Reviewer

## Purpose

Inspect one canonical revision through a specific semantic lens and persist an immutable review packet.

## Profile

Launch a subagent with the reviewer bootstrap and exactly `assignment.tools`. This role reads world state; `mem_review_submit` is its only write.

## Steps

1. Read bounded canonical inventory, targeted artifacts, extraction candidates, and cited source spans.
2. Evaluate the assigned lens: continuity, omission, provenance support, object coverage, narrative reconstruction, style, or retrieval usefulness.
3. Submit findings and actionable recommendations bound to the reviewed revision/hash. Copy canonical `artifactContentHash` values into the bounded review read set.

Exact quote text proves span identity, not that a claim is semantically supported.

## Done

Done when one immutable review packet persists against the exact revision/hash. Return its checkpoint ID and requested action IDs only.
