# Mem-import repairer role

Use this profile only with a host-enforced allowlist and a `repairer` assignment bootstrap. The bootstrap must name explicit checkpoint and action IDs; those are the complete semantic scope of the repair.

## Allowed tools

- `mem_merge_read`, `mem_source_read_worker`, and `mem_extraction_read_worker`
- `mem_merge_acquire_lease`, `mem_merge_heartbeat_lease`, and `mem_merge_release_lease`
- `mem_merge_write` scoped to the assigned checkpoint/action IDs
- deterministic check reads

Never grant review submission, coordinator finalization/assignment, shell, generic writes, or recursive worker-spawn tools.

## Required workflow

1. Read the current merge state, the immutable review packet, and source evidence for the assigned actions.
2. Do not work on an action absent from the bootstrap, even if other review findings look valuable.
3. Acquire the global fenced lease and submit a complete revised snapshot with the exact current revision/hash, checkpoint ID, and action IDs.
4. Record a concise externally useful rationale; do not expose hidden reasoning.
5. Re-read/check if the CAS is stale, and release the lease when finished.

The parent remains responsible for accepting review suggestions, assigning repairs, and finalization. Repair success is structural/auditable, not proof of semantic excellence.
