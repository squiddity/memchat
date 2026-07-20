# Coordinator decisions

The coordinator schedules bounded semantic work; tools persist and validate the ledger.

## Phase gates

### Extraction → proposal

Proceed for a shard when:

- every assigned source page was read through `truncated: false` or a deliberate bounded span;
- its extraction packet exists and its anchors support the candidates;
- the child's completed dispatch receipt exactly matches `assignment.tools`.

Revoke and retry weak or interrupted assignments with fresh task IDs. Increase concurrency only while early packets and parent completion traffic remain clean.

### Proposal → merge

Proceed when every assigned candidate has exactly one proposal disposition. The proposer submit tool derives extraction hashes and rejects incomplete accounting.

Use reconciliation only for a real identity question: repeated entities across proposals, matching into existing canon, aliases, editions, retcons, or material ambiguity. Reconcilers read immutable proposals directly; extraction packets are supporting evidence, not substitutes for proposals.

### Merge → review

A merger reads proposal packets and bounded canonical artifacts. Prefer `accept` changes that copy proposal artifacts exactly. Use an explicit `upsert` only for intentional cross-proposal synthesis. Copy `artifactContentHash` from canonical reads into the commit read set; use `null` only after observing that the target is absent.

`mem_merge_commit` performs one bounded transaction and owns lease, fence, current-revision CAS, candidate-accounting carry-forward, and release. On stale artifact evidence, re-read only the affected canonical neighborhood and form a new decision.

### Review → finalization

Review one explicit lens at a time. The coordinator selects repair actions; a repairer receives only those checkpoint/action IDs. Run deterministic checks after the final accepted transaction.

## Dispatch ledger

For every semantic worker:

1. Issue a role assignment.
2. Pass the returned bootstrap and `tools` array verbatim to the ordinary subagent facility.
3. Wait for its native terminal result.
4. Record requested and observed model, thinking, exact tools, host child ID, and outcome with `mem_import_record_dispatch`.
5. Inspect the persisted effect before dependent dispatches.

A failed, cancelled, inline, managed-agent, missing, or mismatched receipt is evidence to retry or stop; it is not acceptance evidence.

## Scale and recovery

- Keep source reads, proposal reads, canonical inventories, and commits paginated/bounded.
- Shard by coherent neighboring units where possible; preserve disjoint assignment scope.
- Keep one canonical merger active. Immutable proposals permit restart without re-extraction.
- Earlier accepted transactions survive later interruption.
- Use durable status/inventory tools to reconstruct work instead of relying on conversation memory.
- Stop fanout on repeated schema failures, provider failures, weak source coverage, or parent backlog.

## Host-specific setup

Host launch syntax, workspace layout, model choices, and pane lifecycle belong in the detected adapter reference. For the current Herdr test installation, read [pi-herdr-subagents](adapters/pi-herdr-subagents.md).
