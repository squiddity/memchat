# Merger

## Purpose

Integrate immutable shard proposals into canonical state through small, resumable transactions.

## Profile

Launch one subagent with the merger bootstrap and exactly `assignment.tools`. For a planned run, the assignment is issued only after independent `mem_import_cluster_plan_status` readiness and derives the exact proposal and identity packet hashes from one `planHash`; do not add hashes outside that scope.

## Steps

1. Confirm the coordinator independently observed `readyForMerge`; assignment and commit enforce it again. Treat immutable proposals and identity packets as the primary evidence; read their inventory and every packet page used by the batch. Do not reopen extraction packets or source for byte-for-byte accepts.
2. Read only the bounded canonical neighborhood needed for a collision, replacement, synthesis, deletion, or stale read set. Canonical reads return `artifactContentHash` for commit read sets. Reopen only the exact cited source span when a material dispute cannot be settled from proposal/identity evidence; never reread a whole unit by default.
3. Group several compatible proposals into each transaction instead of committing proposal-by-proposal.
4. Prepare a weighted batch:
   - up to 50 lightweight `accept` changes copy proposal artifacts unchanged;
   - up to 12 combined `upsert`/`delete` changes intentionally synthesize or alter canonical state;
   - declare up to 50 supporting proposal hashes and no more than 62 total changes.
5. Call `mem_merge_commit` with supporting proposal hashes, exact artifact read set, changes, optional accepted identity/conflict effects, and a concise rationale.
6. Use the compact receipt's revision/hash/counts as acknowledgement. Read inventory or explicit artifacts only when the next semantic decision requires them.
7. Maintain an exact set of proposal hashes returned by `mem_proposal_inventory` and subtract only hashes acknowledged in compact commit receipts. Repeat with another bounded batch until that set is empty. Before returning, compare the complete assigned set with the union of receipt `consumedProposalHashes`; counts or a rationale saying “all” are not sufficient.

The commit tool carries proposal candidate dispositions, checks every proposal/identity hash against the merger assignment, re-derives plan readiness from the ledger, and owns lease, fencing, current-revision CAS, transaction persistence, and release.

## Done

Done when every assigned proposal hash has a durable canonical transaction or an explicit unresolved blocking conflict, every assigned candidate is carried into canonical accounting, and the final returned revision/hash re-reads successfully. If even one proposal or candidate remains, continue with another commit instead of returning success.

On stale evidence, re-read the affected artifacts and form a new batch. Earlier transactions remain valid.
