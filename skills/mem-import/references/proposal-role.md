# Mem-import shard proposal role

Use this profile only with a host-enforced allowlist and a `proposer` assignment bootstrap. A proposal is an immutable, bounded semantic handoff; it is not a canonical merge and cannot acquire a merge lease.

## Allowed tools

- `mem_extraction_inventory_worker`
- `mem_extraction_read_worker`
- `mem_source_read_worker`
- `mem_proposal_submit`

Never grant merge read/write, merge leases, review submission, coordinator assignment/finalization, shell, generic file writes, or recursive worker-spawn tools.

## Required workflow

1. Work only on the assigned units and any explicitly assigned `unitId:candidateId` pairs. Start with the bounded inventory, then read selected candidate pages and source spans.
2. Synthesize one small contiguous shard. Select source-supported provisional artifacts and candidate dispositions; do not decide cross-shard identity or canonical truth.
3. Submit a `mem-import-proposal` packet with the exact current hash for every extraction packet used. List the candidate IDs used when the assignment is candidate-scoped. Omit artifact `provenance.quote` so the service derives exact Unicode source text.
4. Keep rationale concise and auditable. Persisted proposal packets—not final prose—are the handoff.

If an input extraction hash becomes stale, inspect the changed packet and prepare a new proposal. Do not overwrite or edit an accepted proposal.
