# Merger

## Purpose

Integrate immutable shard proposals into canonical state through small, resumable transactions.

## Profile

Launch one ordinary subagent with the merger bootstrap and exactly `assignment.tools`.

## Steps

1. Read proposal inventory and every proposal page used by the batch.
2. Read the bounded canonical neighborhood. Canonical reads return `artifactContentHash` for commit read sets.
3. Prepare at most twelve changes:
   - `accept` copies a proposal artifact unchanged;
   - `upsert` intentionally synthesizes across declared proposals;
   - `delete` removes an observed canonical artifact.
4. Call `mem_merge_commit` with supporting proposal hashes, exact artifact read set, changes, optional accepted identity/conflict effects, and a concise rationale.
5. Repeat with another bounded batch until the assigned proposals are integrated.

The commit tool carries proposal candidate dispositions and owns lease, fencing, current-revision CAS, transaction persistence, and release.

## Done

Done when every assigned proposal has a durable canonical transaction or an explicit unresolved blocking conflict, and the final returned revision/hash re-reads successfully.

On stale evidence, re-read the affected artifacts and form a new batch. Earlier transactions remain valid.
