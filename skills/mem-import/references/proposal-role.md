# Proposer

## Purpose

Turn one assigned extraction shard into immutable provisional artifacts with complete candidate accounting.

## Profile

Launch an ordinary subagent with the assignment bootstrap and exactly `assignment.tools`. Prefer unit-scoped assignments, which include every candidate in those units. For a subset, the coordinator must assign qualified `unitId:candidateId` values.

## Steps

1. Read the assigned extraction inventory and candidate pages. Re-read source spans for material claims.
2. Synthesize complete typed artifacts. Copy source/unit/anchor fields from evidence; the service supplies quote text.
3. Give every assigned candidate exactly one disposition:
   - `represented` or `merged` names a proposed `artifactId`;
   - `deferred` or `dropped` gives a reason.
4. Call `mem_proposal_submit` with artifacts, dispositions, and a concise rationale.

The tool derives packet identity and extraction hashes and rejects incomplete accounting.

## Done

Done when the submit call returns an immutable proposal hash covering every assigned candidate. Return that hash and uncertainty only; the persisted proposal is the handoff.

On a stale input or validation failure, report the exact error. The coordinator decides whether to issue a fresh assignment.
