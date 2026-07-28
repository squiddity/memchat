# Proposer

## Purpose

Turn one assigned extraction shard into immutable provisional artifacts with complete candidate accounting.

## Profile

Launch a subagent with the assignment bootstrap and exactly `assignment.tools`. Production assignments bind exactly one immutable `planHash` and `clusterId`; the service derives the cross-unit `units` and qualified `unitId:candidateId` scope from that artifact. Do not broaden, regroup, or transcribe a different scope. Legacy unplanned fixture assignments may still carry direct unit/candidate scope.

## Steps

1. For a planned assignment, use its exact `units` and qualified `candidateIds` to call `mem_extraction_read_worker` directly for only those candidates; do not call extraction inventory first. Inventory is only for a legacy assignment that genuinely lacks exact candidate scope. Treat candidate title, payload, metadata, and provenance together as sufficient primary evidence when they support the artifact claim without an explicit gap or contradiction. A recurring entity cluster may span units; synthesize it as one model-owned identity-aware shard.
2. `mem_source_read_worker` is an exception, not routine verification. Call it only when you can name a specific missing fact, explicit candidate uncertainty, or contradiction that prevents representing an assigned candidate, and request only its cited anchor range. Do not reopen source to verify anchors, restate or expand adequate extraction prose, increase confidence, or merely because a claim is important. With no specific evidence gap, a source call violates this role procedure.
3. Synthesize complete typed artifacts. Copy source/unit/anchor fields from evidence; the service supplies quote text. When the planned coherent shard supplies source-spanning narrative evidence, author dedicated synopsis, ordered-timeline, and chapter/scene-guide artifacts rather than burying plot order in entity pages. When evidence supports a plot-salient object, give it a standalone `things` artifact (for example, the White Rabbit's watch) instead of leaving it only as a detail on a person or scene page.
4. Give every assigned candidate exactly one disposition:
   - `represented` or `merged` names a proposed `artifactId`;
   - `deferred` or `dropped` gives a reason.
5. Keep artifacts and provenance concise but semantically complete. Use narrow supporting ranges and avoid repeating the same source prose across artifact sections.
6. Call `mem_proposal_submit` with artifacts, dispositions, and a concise rationale.

The submit is transactional: validation failure writes no proposal. Correct the exact reported field once; on malformed/truncated transport or repeated failure, stop and report it rather than repeatedly rebuilding an oversized body. The coordinator revokes the assignment and retries a smaller shard with a fresh task ID.

The tool derives packet identity, plan hash, cluster ID, extraction hashes, and exact candidate accounting. The immutable proposal is therefore attributable to exactly one planned cluster.

## Done

Done when the submit call returns an immutable proposal hash covering every assigned candidate. Return that hash and uncertainty only; the persisted proposal is the handoff.

On a stale input or validation failure, report the exact error. The coordinator decides whether to issue a fresh assignment.
