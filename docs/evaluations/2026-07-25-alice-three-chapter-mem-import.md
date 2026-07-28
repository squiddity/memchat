# Three-chapter Alice mem-import evaluation — 2026-07-25

## Scope

This bounded evaluation imported Chapters I–III from `.memchat-agent-testing/fixtures/alice-chapters-1-3.epub` through the four fresh mem-import coordinator phases. It evaluates the compact U4–U7 protocol; it is not an installation-acceptance receipt or the full U8 A/B.

The ignored run output is `.memchat-agent-testing/output/alice-three-chapter-u7-20260725`.

## Durable result

| Metric | Result |
|---|---:|
| Run | `mir-e4f15d4490d4d911ac52bbfb` |
| Terminal status | `finalized` |
| Wall duration | 27m 7s (`16:17:42.056Z`–`16:44:49.144Z`) |
| Normalized units | 3 |
| Extraction candidates | 37 |
| Cluster proposals | 18/18 consumed |
| Identity packets | 1 |
| Canonical candidates accounted | 37/37 |
| Canonical artifacts | 28 |
| Merge transactions | 1 |
| Merge revision | 1 |
| Canonical content hash | `50debc4ff90512188ddff46594c1dc158a46eece8213834ea6073cd90bb3d637` |
| Blocking conflicts | 0 |
| Final checks | 0 errors, 3 warnings |
| Reviews | 1 current review |

Artifact distribution: 6 people, 5 places, 7 things, 9 facts, and 1 style artifact. Canonical IDs are unique. Recurring central identities were consolidated into single Alice, White Rabbit, Mouse, Dodo, Lory, and Dinah artifacts rather than chapter-local duplicates.

## Coordinator and transaction behavior

- The run used four fresh phase contexts and resumed only the interrupted current finalization context.
- Extraction required two revoked/incomplete attempts before three submitted retry assignments completed the three units.
- Proposal/reconciliation persisted one exact candidate partition, 18 proposal effects, and one completed reconciliation set.
- Merge consumed all proposals and the identity packet in one transaction.
- The first finalization context exited while its reviewer was still running. A profile-preserving resume reconstructed the durable reviewer effect and found the run already finalized; it did not repeat semantic work.

## Evidence-read efficiency

The final audit recorded 108 successful evidence-read pages, 142 returned items, and 96,749 returned source characters.

| Role | Calls/pages | Returned items | Returned chars | Interpretation |
|---|---:|---:|---:|---|
| Extractor | 9 | 0 | 95,265 | Complete source reads for extraction, including retry cost. |
| Proposer | 28 | 37 | 0 | Exact extraction-candidate reads; no source reopening. |
| Reconciler | 11 | 8 | 0 | Proposal/canonical control reads; no source reopening. |
| Merger | 24 | 36 | 0 | Proposal/identity reads; no source or extraction reopening. |
| Reviewer | 36 | 61 | 1,484 | Broad canonical inspection plus two bounded source pages. |

U6's main target held: proposers and the unchanged merger did not reopen source text. The reviewer was substantially more read-intensive than other semantic roles, inspecting 28 individual artifacts.

## Usage telemetry result

The final schema-v2 audit reports partial coverage—5 available records and 25 `host-result-missing` records—but a post-run inspection proved this is an **ingestion defect, not missing provider telemetry**. The improved subagent extension wrote valid schema-v1 usage into all 30 host activity sidecars.

Two bridge failures produced the misleading durable audit:

1. The top-level completion path built `subagent_result.details` from cached `running.activity` without a final sidecar refresh after the child exited. All four coordinator sidecars contained complete usage, but their delivered results omitted `usage` and `usageByModel`.
2. Nested worker completion details contained valid usage in their raw session records, but the model-visible completion prose did not expose those structured fields. Mem-import then depended on the coordinator model to copy invisible `details` into `mem_import_record_dispatch`. Most workers were recorded as missing; five extractor receipts instead retained incorrect zero-token Anthropic-shaped data.

The underlying host sidecars recover these actual totals:

| Phase | Sessions | Total tokens | Provider-reported cost |
|---|---:|---:|---:|
| Extraction | 6 | 689,921 | $0.8863 |
| Proposal/reconciliation | 20 | 1,693,133 | $1.7347 |
| Merge | 2 | 331,062 | $0.4165 |
| Review/finalization | 2 | 515,073 | $0.4840 |
| **Total** | **30** | **3,229,189** | **$3.5216** |

The recovered total comprises 539,273 fresh-input tokens, 2,588,160 cache-read tokens, 101,756 output tokens, 7,572 reasoning tokens, and zero cache-write tokens across 186 responses. Coordinators account for 2,109,096 tokens (65.3%); proposal/reconciliation accounts for 52.4% of all processed tokens.

These recovered numbers are diagnostic host evidence, not yet the authoritative `stages/import-run.json` aggregate. The durable audit correctly refused to estimate missing records, but its availability classification reflects the broken bridge rather than the data actually captured by the extension.

### Chosen telemetry bridge fix

> Implemented on 2026-07-27 for the Pi/Herdr adapter, including portable per-session snapshots, latest-sequence resume deduplication, explicit missing/invalid/stale/unmatched classifications, and the secondary live-completion refresh. A fresh evaluation rerun remains required because five historical extractor receipts did not retain a resolvable exact child identity.

Use post-facto retrieval from the extension's existing content-free activity sidecars. Do not add a generic event bus, opaque correlation protocol, or model-mediated telemetry transport for the current local Pi/Herdr workflow.

1. Persist both the exact sanitized running-child ID and sanitized session filename stem in every worker dispatch and phase-coordinator session record.
2. Add an adapter-specific resolver used by finalization or a post-run audit command. It resolves those recorded identifiers to Pi/Herdr activity sidecars and reads only validated schema-v1 `usage` and `usageByModel`; it must not load full transcripts, prompts, responses, grants, or credentials.
3. Deduplicate profile-preserving resumes by child identity and activity sequence. Resume snapshots are cumulative, so retain the latest valid snapshot rather than summing intermediate snapshots.
4. Snapshot the normalized per-session records and role/phase/model aggregates into `stages/import-run.json` before host session cleanup. The emitted audit remains portable even though retrieval is adapter-specific.
5. Record explicit unavailability only when the expected activity sidecar is genuinely absent, invalid, stale, or cannot be correlated to the recorded running-child and session identities.
6. Independently fix the small completion race: perform one final synchronous activity-sidecar refresh before constructing `subagent_result.details`. This improves live completion telemetry but is not the authoritative persistence path.
7. Add end-to-end tests for identifier resolution, nested workers, cumulative resumes, duplicate prevention, missing/invalid sidecars, cleanup timing, completion races, and exact final-audit aggregation.

This deliberately favors the smallest reliable local solution. A generic receipt/event architecture is deferred until remote or heterogeneous adapters require one.

## Semantic review

The current review found two concrete quality gaps:

1. **Repair:** `place-bank-ch3-gathering` over-specifies the Chapter III bank as a riverbank.
2. **Warning:** the White Rabbit's watch lacks standalone canonical object coverage despite being the inciting anomaly.

No repair transaction followed; deterministic finalization still passed because these findings were not represented as blocking conflicts or deterministic errors. Final checks also warned that the library has no dedicated:

- corpus/plot synopsis,
- timeline or reading order,
- scene/chapter/episode guide.

The output has a useful style artifact but no promoted synopsis or timeline surface. Consequently, candidate accounting and identity consolidation are strong, while narrative navigation and reviewer-action enforcement remain below the desired quality bar.

## Conclusion and next actions

The compact protocol achieved complete provenance-backed accounting, global identity consolidation, one-transaction merge, and demand-driven proposal/merge evidence use. The completion-to-mem-import bridge is now implemented in memchat commit `0de2a02` with the live adapter refresh in `bca9903`; the five historical UUID-only extractor receipts cannot be recovered without unsafe heuristic matching. Do not begin the full U8 A/B yet. First:

1. decide and implement whether `repair` reviewer findings block finalization or require an explicit durable defer/accept decision;
2. strengthen planning/review guidance for synopsis, timeline/chapter guide, and salient-object coverage;
3. rerun the same three-chapter fixture with exact terminal `runningChildId` and sanitized `sessionId` persistence, then verify complete authoritative telemetry, no resume double-counting, and resolved or explicitly deferred semantic findings;
4. use that validated setup for the controlled full Alice A/B.
