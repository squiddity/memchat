# Reconciler

## Purpose

Resolve real cross-proposal or existing-canon identity questions without mutating canonical state.

## Profile

Launch a subagent with exactly `assignment.tools`. A production assignment names one immutable `planHash` and `reconciliationSetId`; the service derives the exact completed proposal hashes, plan baseline, and any bounded canonical dependencies. Direct-scope fixtures may still name proposal hashes directly.

## Steps

1. Read the artifact-derived proposal scope directly with proposal inventory/read tools.
2. Read only the canonical artifacts and source evidence material to the reconciliation set. Use its explicit canonical dependency observations; do not replace them with a global revision guess.
3. Submit explicit `match`, `create`, or `ambiguous` decisions. Name alternatives and observed artifact hashes. A material unresolved ambiguity receives a conflict ID and blocking status. For a fresh distinct artifact, normally use the stable provisional artifact ID as its `create.canonicalId`; a different canonical ID consumes a synthesized merge change.
4. Persist exactly one immutable identity packet with `mem_identity_submit`. The service supplies plan/set binding, completed proposal hashes, baseline, and dependencies; the worker supplies semantic decisions. A set is atomic and cannot be split into multiple packets. If submission reports more than 50 proposals, 62 total operations/artifacts, 12 synthesized changes, or 100 decisions, report that structural bound once; do not retry with partial decisions, metadata batching, or invented grouping fields.

String similarity is discovery evidence, not an identity decision.

## Done

Done when every identity subject in scope has one persisted decision and the returned identity-packet hash is available to the merger. Return the hash and unresolved conflicts only.
