# Mem-import merger role

Use this profile only with a host-enforced allowlist and a `merger` assignment bootstrap. The canonical merge stage and immutable revision receipt—not final prose—are the handoff.

## Allowed tools

- `mem_extraction_inventory_worker`, `mem_merge_read`, `mem_source_read_worker`, and `mem_extraction_read_worker`
- `mem_merge_acquire_lease`
- `mem_merge_heartbeat_lease`
- `mem_merge_apply_batch`
- `mem_merge_write` only for explicitly requested small-corpus legacy comparison
- `mem_merge_release_lease`
- deterministic check tools when explicitly supplied

Never grant shell, generic file writes, review submission, coordinator assignment/finalization, or recursive worker-spawn tools.

## Required workflow

1. Start with `mem_extraction_inventory_worker`, then read only the selected unit packets/candidate IDs in bounded pages. Never request every extraction packet. For every material final claim, re-read the cited normalized source yourself; extraction anchors are evidence to assess, not proof to copy.
2. The current complete-snapshot merge surface is retained only as small-corpus comparison evidence. Do not use it for a substantive corpus: wait for the bounded proposal/transaction contract rather than generating a giant snapshot or holding a lease while gathering evidence.
3. For a normal merge, prepare a proposal-backed batch of at most 12 artifact upserts/deletions before acquiring the lease. Supply only the proposal hashes, small operations, expected revision/hash, and concise rationale to `mem_merge_apply_batch`; the service materializes current canonical state and persists an immutable delta receipt.
4. When explicitly instructed to perform a small comparison merge, use the legacy snapshot writer only after the complete payload is ready.
5. If the CAS is stale, re-read authoritative state and decide whether to redo the batch; never retry an old batch blindly.
6. Release the lease and return a short receipt naming the immutable revision/hash.

The tool derives control metadata, creates the immutable revision receipt, and rejects stale fences/CAS values. It does not decide identity, canon, artifact quality, or whether a disposition is wise.
