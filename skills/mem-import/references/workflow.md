# Coordinator decisions

The coordinator schedules bounded semantic work; tools persist and validate the ledger.

## Phase gates

### Extraction → proposal

Proceed for a shard when:

- every assigned source page was read through `truncated: false` or a deliberate bounded span;
- its extraction packet exists and its anchors support the candidates;
- the persisted packet has been re-read and is complete at both ends, with no clipped title or payload text;
- the child's completed dispatch receipt exactly matches `assignment.tools`.

Revoke and retry weak, clipped, or interrupted assignments with fresh task IDs before proposal work. Use `mem_import_extraction_candidates` to size coherent proposal shards by candidate volume and artifact complexity, not unit count; begin conservatively and widen only after clean results. Increase concurrency only while packets and parent completion traffic remain clean.

### Proposal → merge

Proceed when every assigned candidate has exactly one proposal disposition. The proposer submit tool derives extraction hashes and rejects incomplete accounting.

Use reconciliation only for a real identity question: repeated entities across proposals, matching into existing canon, aliases, editions, retcons, or material ambiguity. Reconcilers read immutable proposals directly; extraction packets are supporting evidence, not substitutes for proposals.

### Merge → review

A merger reads proposal packets and bounded canonical artifacts. Prefer `accept` changes that copy proposal artifacts exactly, and group several compatible proposals into one weighted transaction instead of committing proposal-by-proposal. A call may carry up to 50 lightweight accepts while combined synthesized `upsert`/`delete` changes remain capped at 12. Use an explicit `upsert` only for intentional cross-proposal synthesis. Copy `artifactContentHash` from canonical reads into the commit read set; use `null` only after observing that the target is absent.

The coordinator never writes a complete canonical snapshot or invents dispositions for candidates whose semantic worker failed. Missing proposals remain accounting gaps and must be retried or terminate the run without replacing previously accepted artifacts.

`mem_merge_commit` performs one bounded transaction and owns lease, fence, current-revision CAS, candidate-accounting carry-forward, and release. A normal merger receives only this commit surface—not manual acquire, heartbeat, or release tools. Never broaden `assignment.tools`, guess fences, or revoke a lease-owning worker before its commit cleanup completes. If a process dies while holding a lease, wait for the recorded expiry and let one fresh exact-allowlist `mem_merge_commit` recover it; do not poll or brute-force release attempts. On stale artifact evidence, re-read only the affected canonical neighborhood and form a new decision.

### Review → finalization

Review one explicit lens at a time. The coordinator selects repair actions; a repairer receives only those checkpoint/action IDs. Run deterministic checks after the final accepted transaction.

## Dispatch ledger

For every semantic worker:

1. Issue a role assignment.
2. Pass its bootstrap and semantic `tools` array verbatim to the selected facility; launch no helper child.
3. End the turn and wait at rest for push-delivered terminal completion. Do not poll, schedule an ordinary wake-up, or launch a wait/no-op/monitor child.
4. Require the exact semantic tool profile plus documented lifecycle controls. Verify active/denied tools and profile-preserving resume when the host exposes that evidence; record unavailable fields as unavailable.
5. Record requested tools and only actually observed model, thinking, child ID, tools, lifecycle profile, and outcome with `mem_import_record_dispatch`. Never derive observations from the assignment or worker prose.
6. Inspect the effect with `mem_import_effect_inventory` before dependent work. A durable effect cannot replace required dispatch evidence.

A failed, cancelled, missing, mismatched, broadened, or inaccurately recorded receipt invalidates the dispatch; retry fresh or stop. Acceptance never overrides a bad live dispatch. Treat a terminal host result as final even if its prose claims otherwise, and inspect its durable effect immediately.

For a non-extractor retry, revoke the old assignment and issue a fresh task ID without `retriesTaskId` or `supersedesTaskIds`; those lineage fields belong only to extractor assignment calls.

## Scale and recovery

- Keep source reads, proposal reads, canonical inventories, and commits paginated/bounded.
- Shard by coherent neighboring units where possible; preserve disjoint assignment scope.
- Keep one canonical merger active. Immutable proposals permit restart without re-extraction.
- Earlier accepted transactions survive later interruption.
- Use durable status/inventory tools to reconstruct work instead of relying on conversation memory.
- Stop fanout on repeated schema failures, provider failures, weak source coverage, or parent backlog.

## Facility-specific setup

Read only the selected facility's adapter reference for launch syntax, extension setup, workspace layout, and model choices. [pi-herdr-subagents](adapters/pi-herdr-subagents.md) is one example recipe, not a required facility.
