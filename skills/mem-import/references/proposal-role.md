# Proposer

## Purpose

Turn one assigned extraction shard into immutable provisional artifacts with complete candidate accounting.

## Profile

Launch a subagent with the assignment bootstrap and exactly `assignment.tools`. A unit-scoped assignment includes every candidate in those units; a subset uses qualified `unitId:candidateId` values and partitions its scope exactly once without omissions.

## Steps

1. Read the assigned extraction inventory and candidate pages. Re-read source spans for material claims.
2. Synthesize complete typed artifacts. Copy source/unit/anchor fields from evidence; the service supplies quote text.
3. Give every assigned candidate exactly one disposition:
   - `represented` or `merged` names a proposed `artifactId`;
   - `deferred` or `dropped` gives a reason.
4. Keep artifacts and provenance concise but semantically complete. Use narrow supporting ranges and avoid repeating the same source prose across artifact sections.
5. Call `mem_proposal_submit` with artifacts, dispositions, and a concise rationale.

The submit is transactional: validation failure writes no proposal. Correct the exact reported field once; on malformed/truncated transport or repeated failure, stop and report it rather than repeatedly rebuilding an oversized body. The coordinator revokes the assignment and retries a smaller shard with a fresh task ID.

The tool derives packet identity and extraction hashes and rejects incomplete accounting.

## Done

Done when the submit call returns an immutable proposal hash covering every assigned candidate. Return that hash and uncertainty only; the persisted proposal is the handoff.

On a stale input or validation failure, report the exact error. The coordinator decides whether to issue a fresh assignment.
