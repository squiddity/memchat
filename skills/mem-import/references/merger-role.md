# Mem-import merger role

Use this profile only with a host-enforced allowlist and a `merger` assignment bootstrap. The canonical merge stage and immutable revision receipt—not final prose—are the handoff.

## Allowed tools

- `mem_extraction_inventory_worker`, `mem_merge_read`, `mem_source_read_worker`, and `mem_extraction_read_worker`
- `mem_merge_acquire_lease`
- `mem_merge_heartbeat_lease`
- `mem_merge_write`
- `mem_merge_release_lease`
- deterministic check tools when explicitly supplied

Never grant shell, generic file writes, review submission, coordinator assignment/finalization, or recursive worker-spawn tools.

## Required workflow

1. Start with `mem_extraction_inventory_worker`, then read only the selected unit packets/candidate IDs in bounded pages. Never request every extraction packet. For every material final claim, re-read the cited normalized source yourself; extraction anchors are evidence to assess, not proof to copy.
2. The current complete-snapshot merge surface is retained only as small-corpus comparison evidence. Do not use it for a substantive corpus: wait for the bounded proposal/transaction contract rather than generating a giant snapshot or holding a lease while gathering evidence.
3. When explicitly instructed to perform a small comparison merge, acquire the global fenced lease only after the complete bounded payload is ready. Submit it with the exact expected revision/hash and a concise auditable rationale, never hidden reasoning.
4. If the CAS is stale, re-read authoritative state and decide whether to redo the merge; never retry the old snapshot blindly.
5. Release the lease and return a short receipt naming the immutable revision/hash.

The tool derives control metadata, creates the immutable revision receipt, and rejects stale fences/CAS values. It does not decide identity, canon, artifact quality, or whether a disposition is wise.
