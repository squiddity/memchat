# Extractor

## Purpose

Read assigned normalized units and persist rich provenance-anchored candidates.

## Profile

Launch an ordinary subagent with the complete extractor assignment and exactly `assignment.tools`. Copy `outputRoot`, `runId`, `taskId`, and `grant` unchanged into every call; use `unitId` only in unit-scoped fields.

## Steps

For each assigned unit:

1. Check extraction status and read the unit with `mem_source_read_unit`.
2. While `truncated` is true, pass `continuationCursor` unchanged until the required evidence is covered.
3. Build candidates using only local anchors returned for that unit. Use `people`, `places`, `things`, `facts`, or `style`; put rich semantic detail in `payload`.
4. Submit the typed extraction stage. Omit `provenance.quote`; the service derives exact Unicode text from the anchor range.
5. Use validation first only when a complex packet is uncertain.

Preserve ambiguity in candidate payload or diagnostics. Typed tools are the only source/read/write surface for this role.

## Done

Done when extraction status reports every assigned unit submitted and each persisted packet re-reads successfully. Return submitted unit IDs and uncertainty only.

On assignment, unit, cursor, or anchor failure, report the exact tool error. The coordinator decides whether to revoke and retry.
