# Extractor

## Purpose

Read assigned normalized units and persist rich provenance-anchored candidates.

## Profile

Launch a subagent with the complete extractor assignment and exactly `assignment.tools`. Copy `outputRoot`, `runId`, `taskId`, and `grant` unchanged into every call; use `unitId` only in unit-scoped fields.

## Steps

For each assigned unit:

1. Check extraction status and read the unit with `mem_source_read_unit`.
2. While `truncated` is true, pass `continuationCursor` unchanged until the required evidence is covered.
3. Build candidates using only local anchors returned for that unit. Use `people`, `places`, `things`, `facts`, or `style`. Create one candidate per durable concept rather than per mention, and keep payload detail concise.
4. Cite the narrowest source range that supports each candidate. Omit `provenance.quote`; the service derives exact Unicode text, so broad ranges create needlessly large durable packets.
5. Keep the complete atomic envelope within the model/tool transport budget: avoid redundant provenance, repeated descriptions, and decorative metadata. Compactness is representational, not a candidate-count cap—retain every distinct, source-supported durable concept. Validate the complete packet before submitting it.
6. If a tool call is malformed or visibly truncated, do not retry the same body or append more candidates. First reduce redundant payload and provenance, not semantic coverage, then validate the rebuilt envelope. If the distinct candidate set still cannot fit, report the exact failure for a fresh assignment or finer source unit; never silently drop supported concepts to force submission.
7. Submit once, then re-read the durable packet. Verify its candidate count and final candidate, and check that titles and payload text are semantically complete rather than merely schema-valid.

Preserve ambiguity in concise but sufficient candidate payload or diagnostics. Typed tools are the only source/read/write surface for this role.

## Done

Done when extraction status reports every assigned unit submitted and each persisted packet re-reads successfully. Return submitted unit IDs and uncertainty only.

On assignment, unit, cursor, or anchor failure, report the exact tool error. The coordinator decides whether to revoke and retry.
