# Proposer

## Purpose

Turn one assigned extraction shard into immutable provisional artifacts with complete candidate accounting.

## Profile

Launch a subagent with the assignment bootstrap and exactly `assignment.tools`. Production assignments bind exactly one immutable `planHash` and `clusterId`; the service derives the cross-unit `units` and qualified `unitId:candidateId` scope from that artifact. Do not broaden, regroup, or transcribe a different scope. Legacy unplanned fixture assignments may still carry direct unit/candidate scope.

## Steps

1. Read only the assigned extraction inventory and candidate pages. A recurring entity cluster may span units; synthesize it as one model-owned identity-aware shard. Re-read source spans for material claims.
2. Synthesize complete typed artifacts. Copy source/unit/anchor fields from evidence; the service supplies quote text.
3. Give every assigned candidate exactly one disposition:
   - `represented` or `merged` names a proposed `artifactId`;
   - `deferred` or `dropped` gives a reason.
4. Keep artifacts and provenance concise but semantically complete. Use narrow supporting ranges and avoid repeating the same source prose across artifact sections.
5. Call `mem_proposal_submit` with artifacts, dispositions, and a concise rationale.

The submit is transactional: validation failure writes no proposal. Correct the exact reported field once; on malformed/truncated transport or repeated failure, stop and report it rather than repeatedly rebuilding an oversized body. The coordinator revokes the assignment and retries a smaller shard with a fresh task ID.

The tool derives packet identity, plan hash, cluster ID, extraction hashes, and exact candidate accounting. The immutable proposal is therefore attributable to exactly one planned cluster.

## Done

Done when the submit call returns an immutable proposal hash covering every assigned candidate. Return that hash and uncertainty only; the persisted proposal is the handoff.

On a stale input or validation failure, report the exact error. The coordinator decides whether to issue a fresh assignment.
