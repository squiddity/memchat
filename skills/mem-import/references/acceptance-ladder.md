# Installation acceptance ladder

Use this ladder for a new installation or whenever the effective adapter/profile fingerprint lacks a current accepted receipt. It tests the worker transport and each semantic handoff on tiny fixtures before spending a book-sized run.

The launcher supplies fixture paths and an acceptance-state location. The constrained coordinator uses only typed mem-import tools and ordinary subagents; it does not create fixtures, install adapters, or write cache files directly.

## Fast path: accepted profile

A cached receipt may skip this reference only when deterministic status inspection reports `accepted` for the exact effective fingerprint. The fingerprint includes:

- mem-import protocol/tool-schema version;
- mem-import skill hash and exact role-allowlist hashes;
- adapter and host runtime identity/version;
- worker model ID and thinking setting;
- acceptance fixture version/content hash;
- package or source revision.

A model or launcher assertion is not a receipt. Missing, failed, expired, unreadable, or mismatched evidence means `stale`: run the affected rungs. Per-run grants, allowlists, dispatch receipts, and checks remain mandatory after acceptance.

If no deterministic acceptance-status capability is installed, treat the cache as unavailable and run this ladder.

## Execution rules

- Use fresh output roots and fresh assignments.
- Launch every semantic role through the candidate ordinary-subagent facility with the assignment's exact returned `tools`, explicit model/thinking, and bounded bootstrap.
- Record terminal host identity and requested/observed tools.
- Inspect persisted effects after every rung.
- Stop at the first failure. Preserve its diagnostic output and record the failed rung; do not continue to discover downstream noise.
- A retry receives a fresh assignment after revocation.

## Required ladder

### 1. Allowlist conformance

Launch a harmless fresh child with two allowed typed tools.

Verify:

- one allowed tool is visible and callable, reaching its normal authorization/state rejection with dummy authority;
- a known forbidden mem-import tool is absent;
- no shell, generic write, or recursive coordinator tool is visible;
- the host returns an unambiguous terminal child/session ID.

**Complete when:** observed non-lifecycle tools equal the requested allowlist exactly and the terminal child ID is correlatable.

### 2. Extractor

Normalize one tiny source unit containing at least two blocks. Assign one extractor and submit candidates spanning at least two groups.

Verify the worker reads through `truncated: false`, uses local anchors, omits quote text, submits once, and re-reads the durable packet.

**Complete when:** extraction status reports the unit submitted, stored quotes equal normalized anchor ranges, and the completed exact-profile dispatch is recorded.

### 3. Proposer

Assign the extracted unit to one proposer. Prefer unit scope; also exercise a local candidate subset that deterministically auto-qualifies to `unitId:candidateId`.

Verify bounded candidate reads return the extractor's packet, the proposer submits typed artifacts, and every assigned candidate has exactly one disposition. Submit a deliberately incomplete accounting body only in a disposable negative probe and require local rejection.

**Complete when:** one immutable proposal hash persists, all candidate accounting is complete, and downstream proposal inventory/read returns the same artifacts and dispositions.

### 4. Merger

Assign one merger to the accepted proposal. Read proposal pages and the bounded canonical neighborhood.

First accept one proposal artifact by reference. When the fixture supports it, use a second bounded transaction to exercise intentional synthesis or rename. Use canonical `artifactContentHash` values in read sets and verify a deliberately stale token fails without mutation.

**Complete when:** atomic commit returns a new revision/hash, candidate dispositions carry forward automatically, the transaction reconstructs, its proposal is reported consumed, and the exact-profile dispatch is recorded. Manual lease and complete-snapshot worker tools must be absent.

### 5. Reviewer

Assign one reviewer to the canonical revision. Review a narrow lens and submit an immutable revision-bound packet with observed artifact hashes.

**Complete when:** the review re-reads at the exact revision/hash, has a bounded read set, and cannot mutate canonical state.

### 6. Finalization

Inspect durable work status, run deterministic checks, acquire the coordinator finalization lease, and finalize.

**Complete when:** candidate accounting has no gaps, no blocking conflict remains, checks have zero errors, Markdown exists, and schema-v2 `stages/import-run.json` records finalized success and exact-profile semantic dispatches.

## Conditional role ladder

Run these before relying on the corresponding role in maintained books or series.

### 7. Reconciler

Use a purpose-built fixture with two proposal artifacts that may represent the same entity and at least one bounded canonical alternative. Require direct proposal reads rather than reconstruction from extraction packets.

Exercise one unambiguous `match` or `create` and one `ambiguous` decision with an explicit blocking conflict.

**Complete when:** immutable identity packets are readable by the merger, exact subjects and alternatives are preserved, unrelated evidence is untouched, and blocking ambiguity prevents finalization until an explicit resolution transaction.

### 8. Repairer

Use a review fixture requesting one concrete action and containing another unassigned action. Grant only the selected checkpoint/action IDs.

Require one source-supported bounded repair and one negative attempt outside scope.

**Complete when:** the selected action creates a reconstructable repair transaction, the unrelated mutation is rejected, and post-repair checks report the selected action's result or an explicit residual.

## Scale and recovery ladder

These deterministic fixtures need not invoke a model on every installation, but their software revision must match the accepted fingerprint:

- paginated 500-unit / 5,000-candidate / 1,000-artifact inventory;
- sequential multi-work compendium projection;
- at least twenty proposal-backed transactions with interruption after an accepted prefix;
- unchanged-dependency rebase and changed-dependency rejection;
- historical revision reconstruction;
- cancelled worker followed by a fresh completed retry.

**Complete when:** every response remains bounded, accepted history survives interruption, stale evidence fails locally, and reconstruction hashes match.

## Acceptance receipt

A deterministic acceptance service should write sanitized receipts under an XDG state root such as:

```text
$XDG_STATE_HOME/memchat/mem-import/acceptance/<profile-fingerprint>.json
```

Use `~/.local/state` when `XDG_STATE_HOME` is unset. CI or isolated launchers may override the root.

A receipt records:

- profile fingerprint and its components;
- `accepted`, `failed`, or `stale` status;
- each rung's fixture hash, durable run/effect hashes, completion time, and diagnostic summary;
- required and conditional role coverage;
- optional expiration/recheck time.

It never records grants, credentials, prompts, source payloads, or hidden reasoning. Provider behavior can change behind a stable model ID, so an old receipt may become `stale` by policy even when its fingerprint still matches.
