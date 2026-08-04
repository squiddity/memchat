# Full Alice mem-import milestone — 2026-08-03

## Result

Mem-import completed and finalized a full 13-unit import of *Alice's Adventures in Wonderland* using `openai-codex/gpt-5.6-luna` with high thinking for production coordinators and semantic workers.

This is the first full-corpus run to demonstrate the current artifact-led four-phase workflow through terminal success, including recovery from a deliberately durable failed checkpoint without repeating successful semantic stages.

| Metric | Final result |
|---|---:|
| Run ID | `mir-9799774c5c67d6b78e186988` |
| Normalized units | 13 |
| Extraction candidates | 183 |
| Planned proposals | 28 |
| Consumed proposals | 28/28 |
| Canonically accounted candidates | 183/183 |
| Canonical artifacts | 155 |
| Final canonical revision | 10 |
| Blocking/open conflicts | 0/0 |
| Finalization errors | 0 |
| Finalization warnings | 55 |
| Final content hash | `e60bd46fab8ba9905750a1ccc82beaba852c173a8c51cc07d03049c4a2ccc70c` |

The finalized output emitted 177 Markdown files, including retained source pages and indexes. The final run record is `finalized`, and fresh typed work status reports zero unconsumed proposals, unproposed candidates, duplicate proposal dispositions, and unaccounted candidates.

## Checkpoint recovery proof

The initial merge coordinator made four valid commits but stopped after consuming 26 of 28 proposals and accounting for 174 of 183 candidates. The two omitted identity clusters represented Alice and the Gryphon. The then-current coordinator incorrectly marked the otherwise healthy run failed for incomplete canonical accounting.

The recovery implementation and live continuation proved the intended semantics:

1. `mem_import_recover` reactivated the same run ID rather than cloning semantic artifacts into a new identity domain.
2. Coordinator authority rotated and the run authorization epoch advanced, invalidating every previously issued worker grant without rewriting historical assignment, dispatch, or effect evidence.
3. Normalization, all 13 extraction packets, the immutable cluster plan, all 28 proposals, and the first four canonical transactions remained authoritative.
4. A fresh planned merger assignment was derived from the transaction ledger and received only the two unconsumed proposals and their nine remaining candidates.
5. The recovery merge advanced canonical state from revision 4 to revision 5 with 28/28 proposal consumption and 183/183 candidate accounting.
6. Review and bounded repairs then advanced revisions 6–10 before a current clean review, deterministic checks, and terminal finalization.

This establishes the runtime rule: an active run resumes directly from its next incomplete ledger stage; a failed run is mutation-closed but recoverable in place. Finalized runs remain permanently terminal.

## Review and residual warnings

Finalization passed with zero errors and no blocking conflicts after several bounded reviewer/repairer rounds. The 55 non-blocking deterministic warnings remain useful quality signals rather than hidden failures:

- 28 `style-under-cited` warnings;
- 10 `heading-only-provenance` warnings;
- 8 `repeated-identical-provenance` warnings;
- 4 `first-block-provenance` warnings;
- 2 `low-information-provenance` warnings;
- 2 `event-heading-only-provenance` warnings;
- 1 `missing-plot-synopsis` classifier warning.

The milestone therefore proves complete, recoverable, provenance-backed execution and finalization—not that every generated page or deterministic quality heuristic is optimal. Narrative-surface classification, style citation density, and provenance specificity remain quality-improvement targets.

## Telemetry caveat

The final audit contains 56 lifecycle/usage records, but only 15 retained authoritative sidecar usage snapshots; 41 older records are explicitly unavailable. Aggregate token and cost totals therefore remain `null` rather than being estimated. Evidence-read telemetry is complete at 422 calls/pages, 3,414 returned items, and 316,590 returned source characters.

This run completes the full mem-import execution milestone but does not, by itself, complete the controlled legacy-vs-mem-import A/B cost comparison. That comparison still requires a run with complete usage retention and a suitably instrumented legacy baseline.

## Validation

After the recovery and live schema correction:

- `npm run build` passed;
- `npm run test:mem-import` passed 76/76 tests;
- exact recovered merge and review/finalization coordinator lifecycle evidence was recorded from Pi/Herdr sidecars;
- fresh typed work status independently confirmed terminal `finalized`, revision 10, complete proposal/candidate accounting, and no conflicts.
