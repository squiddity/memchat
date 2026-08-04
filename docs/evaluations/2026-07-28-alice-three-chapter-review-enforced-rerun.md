# Alice Chapters I–III reviewer-enforcement rerun — 2026-07-28

> **2026-08-03 update:** The full 13-unit Alice import subsequently reached reviewed terminal finalization and proved same-run recovery from a partial failed merge. See [the full-corpus milestone report](2026-08-03-alice-full-mem-import-milestone.md). This report remains the bounded reviewer-enforcement baseline.

## Scope

This evaluation reran `.memchat-agent-testing/fixtures/alice-chapters-1-3.epub` after implementing:

- deterministic blocking for current `repair`/`critical` review findings and actions;
- mandatory clean scoped post-repair review before finalization;
- stronger synopsis, ordered-timeline/chapter-guide, and salient-object planning/review guidance;
- exact merger proposal-hash reconciliation and partial-merge recovery guidance;
- projection-aware `mem_check_run`, which emits the deterministic Markdown projection before checking it.

The successful ignored output is `.memchat-agent-testing/output/alice-three-chapter-review-enforced-20260728-retry3`.

## Durable result

| Metric | Result |
|---|---:|
| Run | `mir-d292df080c1829dba050ccb9` |
| Terminal status | `finalized` |
| Wall duration | 1h 6m 4s (`07:18:58.208Z`–`08:25:02.235Z`) |
| Normalized units | 3 |
| Extraction candidates | 56 |
| Cluster proposals | 7/7 consumed |
| Identity packets | 1 |
| Canonical candidates accounted | 56/56 |
| Canonical artifacts | 39 |
| Merge revisions | 2 (initial merge plus scoped repair) |
| Final content hash | `bfd4e505cc7ac803268d09040f75a9d3bed63024985f55f107a7439ee03d17c4` |
| Blocking conflicts | 0 |
| Final checks | 0 errors, 17 warnings |
| Reviews | 1 stale repair review, 1 clean current post-repair review |
| Markdown files | 51 |

Artifact distribution is 11 people, 6 places, 9 things, 7 facts, and 6 style artifacts. Provenance resolves 88/88 references and retains all 3 source pages.

## Reviewer-action enforcement

Revision 1 did not silently finalize. Its scoped review persisted one blocking repair finding/action: the source-order reconstruction started in Chapter II and omitted major Chapter I and Chapter II–III bridge beats. The same review also warned that the Chapter III bank artifact had the wrong chapter tag.

The scoped repair created `fact.alice-ch1-3-source-order-guide` and corrected `place.bank-after-the-pool`. A fresh review bound to revision 2 inspected the synopsis, ordered timeline/chapter guide, White Rabbit watch, salient objects, source ordering, and both bank artifacts. It persisted no findings or requested actions. Review validity marks revision 1 stale and revision 2 current.

This validates the chosen enforcement policy: repair requests block finalization until canonical state changes and a clean scoped post-repair review covers the final revision.

## Narrative and salient-object coverage

The emitted root index promotes:

- `synopsis.alice.opening-ch1-3` as the dedicated plot synopsis;
- `fact.alice-ch1-3-source-order-guide` as a combined ordered timeline and chapter/scene guide.

The guide reconstructs Chapter I’s bank/rabbit/fall/hall/key sequence, Chapter II’s growth/pool/swim sequence, and Chapter III’s bank consultation, caucus-race, prize-giving, Mouse tale, and dispersal.

`white-rabbits-watch-and-waistcoat-pocket` is a standalone `things` artifact describing the watch as the anomaly that triggers Alice’s pursuit. Eight other salient objects also have standalone coverage, including the golden key, bottle, cake, fan, gloves, comfits, and thimble.

The previously identified Chapter III location is now the evidence-bounded “Bank after the pool,” not a riverbank. A separate opening “Bank by Alice’s sister” page still uses “riverside” in its description even though its bounded Chapter I excerpt says only “bank”; this did not trigger the scoped reviewer and should be tightened before using the setup as a no-residual-qualification full-corpus baseline.

## Telemetry verification

The final schema-v2 audit and `world/log.md` agree on run ID, revision/hash, finalized status, 0 errors, 17 warnings, and usage totals.

| Telemetry check | Result |
|---|---:|
| Session records | 18 |
| Available sidecars | 18/18 |
| Unavailable records | 0 |
| Unique host child IDs | 18/18 |
| Responses | 169 |
| Total tokens | 4,399,006 |
| Provider-reported cost | 6.676135 |

Summing all 18 persisted per-session usage records exactly reproduces the audit’s 169 responses and 4,399,006 total tokens. No host child ID is duplicated. The interrupted extraction coordinator’s profile-preserving resume remains one cumulative child record; its fresh recovery coordinator is a distinct record, so resume usage is not double-counted.

Phase totals are 557,080 extraction tokens, 1,530,836 proposal/reconciliation tokens, 423,821 merge tokens, and 1,887,269 review/finalization tokens.

The parent runtime did not expose `mem_import_record_session` in its active tool catalog even though the extension defines it. Coordinator records therefore had to be persisted through the same `MemImportU2Service.recordCoordinatorSession` path directly; the final refresh used `PiHerdrUsageResolver` and produced complete authoritative sidecar-backed telemetry. This catalog exposure gap should be fixed before treating the workflow as fully tool-surface-clean.

## Failed precursor attempts and protocol fixes

Two fresh precursor runs supplied actionable failures:

1. `mir-aaac8753589da37cad56e08e` failed at revision 1 because the merger consumed 17/18 proposals and accounted 45/48 candidates while claiming full completion. The omitted `objects-minor-props` proposal contained exactly three candidates. Merger guidance now requires exact set reconciliation against receipt `consumedProposalHashes`, and coordinators recover a partial durable merge through the same verified merger session when possible.
2. `mir-fc875542b5cc7ba6ae4eaf19` reached repaired revision 2 with complete 66/66 accounting but failed before finalization because `mem_check_run` reported projection files that only `mem_import_finalize` previously emitted. `mem_check_run` now emits the deterministic projection before checking it; build and all 63 mem-import regressions passed before the successful retry.

The successful run also recovered from one transient coordinator provider error. Durable extraction had completed; a fresh current-phase coordinator verified the three packets and exact dispatch/effect evidence without replaying extraction.

## Evidence-read behavior

The audit records 112 successful evidence-read calls/pages, 529 returned items, and 95,265 returned source characters. Proposers and the merger did not reopen source text. Reviewer source reopening accounts for 63,510 characters; extractor reads account for 31,755.

## Remaining warnings and next step

Final deterministic checks have no errors. The 17 warnings are non-blocking provenance/style risks, primarily under-cited style artifacts and repeated spans shared by summary/entity artifacts.

The reviewer-enforcement, narrative-surface, salient-watch, complete-accounting, and telemetry goals are validated. Before the controlled full-Alice A/B, tighten the opening-bank wording and expose `mem_import_record_session` to the parent tool catalog so the full run needs no direct administrative service fallback.
