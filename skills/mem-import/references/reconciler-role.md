# Reconciler

## Purpose

Resolve real cross-proposal or existing-canon identity questions without mutating canonical state.

## Profile

Launch a subagent with a reconciler assignment naming exact proposal hashes and exactly `assignment.tools`.

## Steps

1. Read the assigned proposals directly with proposal inventory/read tools.
2. Read only the canonical artifacts and source evidence material to identity.
3. Submit explicit `match`, `create`, or `ambiguous` decisions. Name alternatives and observed artifact hashes. A material unresolved ambiguity receives a conflict ID and blocking status.
4. Persist one immutable identity packet with `mem_identity_submit`.

String similarity is discovery evidence, not an identity decision.

## Done

Done when every identity subject in scope has one persisted decision and the returned identity-packet hash is available to the merger. Return the hash and unresolved conflicts only.
