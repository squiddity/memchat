# Merger

## Purpose

Integrate immutable shard proposals into canonical state through small, resumable transactions.

## Profile

Launch one subagent with the merger bootstrap and exactly `assignment.tools`. For a planned run, the assignment is issued only after independent `mem_import_cluster_plan_status` readiness and derives the exact proposal and identity packet hashes from one `planHash`; do not add hashes outside that scope.

## Steps

1. Confirm the coordinator independently observed `readyForMerge`; assignment and commit enforce it again. Treat immutable proposals and identity packets as the primary evidence; read their inventory and every packet page used by the batch. Do not reopen extraction packets or source for byte-for-byte accepts.
2. Choose the bounded proposal subset for the next transaction, then call `mem_merge_requirements` with exactly that subset before constructing the transaction. Copy its pending proposal and identity hashes; never apply assignment-wide identity requirements to a smaller batch. For every listed identity `create`, include a same-batch `upsert` for that canonical ID; for every `match`, preserve the returned canonical hash in the read set; create every listed blocking conflict operation. Never discover these deterministic prerequisites by trial commits.
3. Read only the bounded canonical neighborhood needed for a collision, replacement, synthesis, deletion, or stale read set. Canonical reads return `artifactContentHash` for commit read sets. Reopen only the exact cited source span when a material dispute cannot be settled from proposal/identity evidence; never reread a whole unit by default.
4. Group several compatible proposals into each transaction instead of committing proposal-by-proposal. Prefer `proposalAccepts` to group unchanged artifact IDs under one exact proposal hash; reserve explicit `upsert`/`delete` changes for synthesis or removal. Every artifact ID in each declared proposal must be covered by an accept or synthesized operation before that proposal can be consumed. An `upsert` never carries `proposalHash`.
5. Prepare a weighted batch:
   - up to 50 lightweight accepts copy proposal artifacts unchanged;
   - up to 12 combined `upsert`/`delete` changes intentionally synthesize or alter canonical state;
   - declare up to 50 supporting proposal hashes and no more than 62 expanded changes.
6. Call `mem_merge_validate` with the fully shaped commit. It does not mutate state. Fix every returned scope, read-set, identity, or application issue before calling `mem_merge_commit` with the same semantic payload. A validation result is advisory; commit still rechecks current state atomically.
7. Use the compact receipt's revision/hash/counts as acknowledgement. Read inventory or explicit artifacts only when the next semantic decision requires them.
8. Maintain an exact set of proposal hashes returned by `mem_proposal_inventory` and subtract only hashes acknowledged in compact commit receipts. Repeat with another bounded batch until that set is empty. Before returning, compare the complete assigned set with the union of receipt `consumedProposalHashes`; counts or a rationale saying “all” are not sufficient.

The commit tool carries proposal candidate dispositions, checks every proposal/identity hash against the merger assignment, re-derives plan readiness from the ledger, and owns lease, fencing, current-revision CAS, transaction persistence, transaction-bound effect projection, and release. If interruption occurs after the immutable transaction but before its effect projection, typed coordinator status/inventory reconstructs the full canonical chain and idempotently recovers only the assignment-valid projection; exact dispatch evidence remains mandatory.

## Done

Done when every assigned proposal hash has a durable canonical transaction or an explicit unresolved blocking conflict, every assigned candidate is carried into canonical accounting, and the final returned revision/hash re-reads successfully. If even one proposal or candidate remains, continue with another commit instead of returning success.

On stale evidence, re-read the affected artifacts and form a new batch. Earlier transactions remain valid.
