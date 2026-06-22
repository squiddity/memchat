---
title: "feat: Add async session-aware memory"
type: feat
date: 2026-06-22
---

# feat: Add async session-aware memory

## Summary

Plan async-capable memory persistence for the existing chat CLI so slow markdown synthesis no longer blocks the next turn, while retrieval compares current-session details with persisted memory before injecting context.

---

## Problem Frame

Memchat currently persists qmd-compatible markdown memory by awaiting raw transcript writes, model-assisted markdown synthesis, markdown writes, and dispose-time compaction in the same path. That keeps memory durable and simple, but a slow summarizer delays the next prompt after the assistant has already answered.

Retrieval is also store-centric rather than session-aware. Hardwired qmd recall searches synthesized markdown first and falls back to transcripts only when markdown is weak, absent, conflict-related, or provenance-sensitive. This can let older persisted memory suppress newer active-session details when background synthesis has not completed or when the current session intentionally retcons prior state.

---

## Requirements

**Persistence and lifecycle**

- R1. Raw JSONL transcript persistence remains the minimum awaited durability boundary for hardwired and hybrid persistence modes.
- R2. Slow model-assisted synthesis and markdown writes can run asynchronously after a turn without blocking the CLI from accepting the next user message.
- R3. Background memory work exposes pending, completed, failed, and flush state through debug/status surfaces.
- R4. `/new`, `/exit`, `/memory recall`, and `/memory index` have explicit flush behavior so lifecycle transitions and manual retrieval do not silently ignore pending current-session memory.
- R5. `/memory status` remains report-only: it surfaces pending and failed work without flushing or mutating the queue.

**Session-aware retrieval**

- R6. Retrieval considers current-session details before older persisted markdown or transcript hits.
- R7. Retrieved memory carries session/provenance metadata sufficient to distinguish current-session, persisted synthesized, and raw transcript sources.
- R8. When current-session details conflict with persisted memory, injected context renders the comparison instead of silently choosing the older memory.
- R9. Hardwired and hybrid retrieval use the same session-aware ordering; qmd skill retrieval receives guidance that current-session context is authoritative when present.

**Validation and documentation**

- R10. Tests cover non-blocking async synthesis, flush behavior, current-session precedence, and conflict rendering.
- R11. Source, docs, debug output, and plan terminology use `markdown synthesis` for memchat-owned synthesis; `qmd` is reserved for qmd-compatible retrieval modes, qmd skill integration, and package/indexer references.
- R12. README and smoke-test docs describe the new persistence guarantees, eventual-consistency boundaries, and validation commands.

---

## Key Technical Decisions

- KTD1. **Keep transcript append awaited:** JSONL remains the audit/source-of-truth layer, so `afterTurn()` should not report completion until the raw turn is safely appended.
- KTD2. **Queue markdown synthesis behind a backend-owned worker:** The qmd-compatible markdown backend owns background synthesis serialization because it knows the memory root, summary paths, touched files, and compaction rules.
- KTD3. **Represent current-session memory as a first-class layer:** Retrieval should not rely only on active pi conversation context or future markdown synthesis; it needs structured current-session hits that can be ranked and rendered with persisted hits.
- KTD4. **Flush before explicit memory inspection and session boundaries:** Normal next-turn UX should not wait for markdown synthesis, but commands whose purpose is memory inspection or lifecycle transition should settle pending work or report what remains pending. Lifecycle transitions must drain queued synthesis before compaction.
- KTD5. **Render conflicts as grouped context:** Prompt context should separate current-session details, persisted remembered context, and possible conflicts/retcons so the model can prefer recent session facts without losing traceability.
- KTD6. **De-duplicate merged layers by source identity:** A flushed turn can appear in current-session, markdown, and transcript layers; merged retrieval should group duplicates by session/timestamp/source and prefer the current-session tier for active-session duplicates.
- KTD7. **Name the operation by output, not retrieval compatibility:** Use `markdown synthesis` for the summarizer/write pipeline because qmd does not drive synthesis; use `qmd-compatible` only when describing the markdown layout or qmd retrieval/skill integration.

---

## High-Level Technical Design

```mermaid
flowchart TB
  Turn[Assistant turn completes] --> Transcript[Await JSONL transcript append]
  Transcript --> SessionBuffer[Update current-session memory buffer]
  SessionBuffer --> Queue[Queue markdown synthesis task]
  Queue --> PromptReady[CLI can accept next prompt]
  Queue --> Worker[Serialized background markdown worker]
  Worker --> Markdown[Write summaries facts state conflicts]
  Worker --> Debug[Emit debug and status updates]

  Query[User prompt or memory recall] --> Current[Search current-session layer]
  Query --> Persisted[Search persisted markdown]
  Persisted --> Comparison[Search recent current session with persisted-hit cues]
  Persisted --> Fallback[Search transcript fallback when needed]
  Current --> Merge[Merge compare and de-duplicate hits]
  Comparison --> Merge
  Persisted --> Merge
  Fallback --> Merge
  Merge --> Context[Render grouped memory context]

  Lifecycle[/new or /exit] --> Flush[Flush queued synthesis with timeout]
  Flush --> Compact[Compact after completed writes]
  Flush --> Warning[Report failed or pending work]
```

The persistence path has two completion boundaries: raw transcript append plus current-session buffer update are awaited; markdown synthesis is queued. Retrieval always includes the current-session layer, then merges persisted markdown and transcript fallback with explicit provenance.

---

## Scope Boundaries

### In Scope

- Async hardwired markdown synthesis internals for qmd-compatible memory modes.
- Session-aware metadata, ranking, and prompt-context rendering for hardwired and hybrid retrieval.
- CLI command behavior for `/memory status`, `/memory recall`, `/memory index`, `/new`, and `/exit` when background memory work is pending.
- Unit/integration tests and smoke-test documentation for the new behavior.

### Deferred to Follow-Up Work

- Replacing hardwired lexical qmd search with the real `@tobilu/qmd` SDK/CLI indexer.
- Hardening qmd skill modes so package skills can use qmd without enabling broad built-in Bash/tools.
- Rich semantic entity extraction, vector search, or story/world graph memory.
- Generating durable conflict events for a later conflict-resolution strategy; this plan renders possible conflicts/retcons for now.
- Cross-process locking for multiple memchat processes sharing one memory root.

---

## Implementation Units

### U1. Add async memory work contracts

- **Goal:** Extend the memory abstraction with queue/flush/status concepts while preserving the existing backend selection model.
- **Requirements:** R2, R3, R4, R5, R7.
- **Dependencies:** None.
- **Files:** `src/memory.ts`, `src/memory.test.ts`, `package.json`.
- **Approach:** Add small types for pending background work, flush results, and source/session metadata. Keep `MemoryBackend.afterTurn()` as the awaited fast path for compatibility, and add optional `flush({ reason, timeoutMs })`/status fields rather than forcing all backends to implement queues. The flush result should report completed, failed, pending, and timed-out counts. Add a Node test-runner script using `tsx` if the project does not already have one.
- **Patterns to follow:** Existing small `MemoryBackend`, `MemoryStatus`, `MemoryHit`, and `MemoryDebugEvent` types in `src/memory.ts`.
- **Test scenarios:**
  - Happy path: a backend with no queued work reports zero pending work and `flush()` returns a completed result without changing existing `none` and `transcript` behavior.
  - Edge case: a backend with failed background work exposes failure count/details in status without throwing from `status()`.
  - Error path: a flush timeout returns a timed-out result with pending work and does not hang the caller indefinitely.
  - Integration: `MemoryHit` rendering still works for existing transcript/qmd hits when new metadata fields are absent.
- **Verification:** Existing memory modes still compile and status output can display queue state without breaking current fields.

### U2. Split markdown synthesis into fast path and background work

- **Goal:** Make per-turn persistence await transcript append and current-session capture, then queue model-assisted markdown synthesis and markdown writes.
- **Requirements:** R1, R2, R3, R10.
- **Dependencies:** U1.
- **Files:** `src/memory.ts`, `src/memory.test.ts`.
- **Approach:** Refactor `QmdMemoryBackend.afterTurn()` into an awaited fast path and a serialized background worker. The fast path appends JSONL and records current-session details; the queued task snapshots memory, calls the synthesis provider, applies fallback synthesis on failure, and writes markdown. Debug events should show enqueue, start, success, failure, and pending counts.
- **Execution note:** Start with a slow/failing synthesis-provider test so non-blocking behavior and failure reporting are characterized before changing qmd internals.
- **Patterns to follow:** Current `QmdMemoryBackend.afterTurn()`, `fallbackSynthesis()`, `writeSynthesis()`, and debug event style in `src/memory.ts`.
- **Test scenarios:**
  - Happy path: `afterTurn()` resolves after transcript append and before a deliberately delayed synthesis promise completes.
  - Happy path: once the delayed task completes, summary/fact/state/conflict markdown is written with the same source citation shape as today.
  - Error path: a synthesis provider rejection records a failed/handled background result and writes fallback synthesis rather than crashing the next turn.
  - Edge case: multiple rapid turns are serialized so markdown writes preserve turn order for one memory root/session.
- **Verification:** Markdown synthesis no longer blocks on summarizer latency, but JSONL transcript files remain immediately present after each turn.

### U3. Add current-session memory layer and metadata

- **Goal:** Track current-session details independently from persisted markdown so retrieval can compare fresh session state against older memory.
- **Requirements:** R6, R7, R8, R10.
- **Dependencies:** U1, U2.
- **Files:** `src/memory.ts`, `src/memory.test.ts`.
- **Approach:** Add session/provenance metadata to memory hits and maintain a current-session buffer populated from raw turns plus available synthesis/fallback summaries. Keep the first version simple and traceable: current-session hits can be lexical excerpts or fallback summaries with `sessionId`, source tier, pending status, and timestamp. Avoid inventing a full entity graph in this unit.
- **Patterns to follow:** Existing `TranscriptRecord`, `MemoryKind`, lexical `tokenize()`/`scoreText()`/`excerpt()` helpers, and source-citation strings.
- **Test scenarios:**
  - Happy path: after a turn mentions `brass telescope`, recall for `telescope` returns a current-session hit even before markdown synthesis finishes.
  - Edge case: a query with no matching current-session tokens still returns persisted hits normally.
  - Conflict path: if older persisted memory mentions `brass telescope` and the current session says `silver astrolabe`, both hits retain distinguishable session/source metadata.
  - Restart boundary: current-session buffer does not pretend to survive process restart; restarted recall comes from JSONL/markdown sources.
- **Verification:** Retrieval results can identify source tier and session for each hit, and current-session hits are visible before background markdown completion.

### U4. Merge, compare, and render session-aware retrieval context

- **Goal:** Change hardwired qmd retrieval from markdown-first-only to current-session-plus-persisted comparison with grouped prompt context.
- **Requirements:** R6, R7, R8, R9, R10.
- **Dependencies:** U3.
- **Files:** `src/memory.ts`, `src/memory.test.ts`, `src/index.ts`.
- **Approach:** Query the current-session layer first, then persisted markdown, then transcript fallback when persisted hits are weak, conflict/provenance-sensitive, or current-session comparison suggests a possible contradiction. When persisted hits exist, run a bounded comparison over recent current-session turns using salient tokens from the persisted hits and retcon/conflict markers, so retcons can surface even when the user's new query does not repeat the old object name. Update ranking so current-session hits precede older persisted hits when scores are comparable, de-duplicate by session/timestamp/source identity, and render grouped current-session details, persisted remembered context, and possible conflicts/retcons. Keep durable conflict-event generation out of this unit, but leave the comparison result structured enough that a later strategy can emit conflict events for resolver workflows.
- **Patterns to follow:** Existing `QmdMemoryBackend.recall()`, `shouldFallbackToTranscript()`, `stageRank()`, `renderContext()`, and `qmdSkillRetrievalStrategyPrompt`.
- **Test scenarios:**
  - Happy path: a current-session fact and an older persisted fact both matching the query render with current-session first.
  - Conflict path: current-session `silver astrolabe` and persisted `brass telescope` render as a possible comparison/retcon candidate instead of only returning the persisted markdown hit.
  - Edge case: a query like `closet contents` still surfaces a current-session retcon that does not repeat the old object name when a persisted closet hit triggered comparison.
  - Error path: if markdown search fails or has no files, current-session and transcript fallback still provide useful hits.
  - Integration: `qmd-hybrid` receives injected grouped context while qmd skill guidance tells the model to prefer current-session context when present.
  - Integration: after a flush, duplicate current-session/markdown/transcript hits from the same turn are grouped rather than rendered as separate facts.
- **Verification:** Before-prompt injection and `/memory recall` expose the same source ordering and conflict grouping for hardwired retrieval surfaces.

### U5. Define flush behavior for CLI commands and lifecycle transitions

- **Goal:** Make pending async memory work observable and deterministic at command boundaries that inspect or close memory.
- **Requirements:** R3, R4, R5, R9, R12.
- **Dependencies:** U1, U2, U4.
- **Files:** `src/index.ts`, `src/memory.ts`, `src/memory.test.ts`, `src/cli-lifecycle.test.ts`, `docs/smoke-tests.md`.
- **Approach:** Add flush calls before `/memory recall` and `/memory index` so explicit memory inspection uses settled background writes when possible. For `/new` and `/exit`, stop accepting new input, flush queued synthesis with a timeout, compact only after completed writes, then report failed or pending work. `dispose()` should own this flush-before-compact sequence. Keep `/memory status` report-only so users can inspect queue state without changing it. Normal user prompts should not flush markdown synthesis before retrieval; they rely on the current-session layer for freshness. Make CLI/lifecycle behavior testable by extracting command/lifecycle helpers or adding a child-process harness.
- **Patterns to follow:** Existing `printMemoryStatus()`, `handleInput()` command branches, `startNewSession()`, final cleanup, and `MemoryDebugEvent` output.
- **Test scenarios:**
  - Happy path: `/memory recall telescope` waits for pending markdown synthesis or reports current-session pending state before printing hits.
  - Lifecycle path: `/new` flushes queued synthesis, compacts after completed writes, and creates a new memory backend with a different session id.
  - Shutdown path: `/exit` attempts to flush pending work and records debug output for completed, failed, pending, and timed-out tasks.
  - Status path: `/memory status` shows pending/failed counts without flushing or compacting.
  - Failure path: a stuck/failed background task does not leave the CLI hanging indefinitely without a visible warning.
- **Verification:** Command surfaces have documented and tested behavior for pending background memory work.

### U6. Update prompts, docs, and smoke coverage

- **Goal:** Document the new async/session-aware memory semantics and add validation paths for future implementers.
- **Requirements:** R9, R10, R11, R12.
- **Dependencies:** U4, U5.
- **Files:** `src/index.ts`, `README.md`, `docs/memory-backends.md`, `docs/smoke-tests.md`, `src/memory.test.ts`.
- **Approach:** Update the chat system prompt and qmd skill retrieval guidance to prefer current-session details over older persisted memory when explicitly grouped. Rename user-facing and developer-facing references from `qmd synthesis`/`qmd persistence synthesis` to `markdown synthesis`, while keeping `qmd-compatible` for the storage/retrieval mode and `qmd` for the package skill/indexer. Document which writes are awaited, which are eventual, and which commands flush pending work. Add smoke/eval scenarios for slow summarizer non-blocking behavior and current-session retcon precedence.
- **Patterns to follow:** Existing `baseChatSystemPrompt`, `qmdSkillRetrievalStrategyPrompt`, README memory backend section, and smoke-test command style.
- **Test scenarios:**
  - Prompt behavior: rendered context names current-session and persisted groups clearly enough for the assistant instruction to distinguish them.
  - Documentation consistency: README, backend plan, smoke tests, status notes, and debug strings use `markdown synthesis` for synthesis and reserve `qmd` for qmd compatibility/retrieval.
  - Smoke scenario: a slow summarizer still lets the next prompt use a current-session detail.
  - Smoke scenario: persisted `brass telescope` followed by current-session retcon to `silver astrolabe` results in current-session precedence.
- **Verification:** Docs and smoke tests tell a consistent story about durability, eventual synthesis, retrieval precedence, and lifecycle flushing.

---

## System-Wide Impact

This feature changes the memory lifecycle from strictly awaited persistence to mixed immediate and eventual persistence. That affects user-perceived latency, durability guarantees, debug output, and how skill-based retrieval modes are instructed. The current-session layer also becomes part of the agent's context contract: it must stay traceable enough that fiction/chat continuity improves without hiding conflicts or stale persistent facts.

---

## Risks & Dependencies

- **Lost background synthesis on process exit:** Mitigate by keeping JSONL append awaited and flushing queued work on `/exit` and `/new` with documented timeout semantics.
- **Ambiguous flush timeout defaults:** Mitigate by defining per-command defaults in the implementation unit before wiring command behavior; timed-out work must remain visible in status/debug output.
- **Race conditions in markdown writes:** Mitigate with a serialized qmd worker per backend instance and defer cross-process locking to follow-up work.
- **Model confusion from over-rendered conflicts:** Mitigate by grouping only relevant current/persisted comparisons and keeping prompt context concise.
- **Future resolver needs more than rendered text:** Mitigate by keeping comparison results structured so a later strategy can generate durable conflict events without reworking the retrieval merge.
- **Skill retrieval parity gap:** Mitigate by updating qmd skill guidance and relying on hardwired injected context for hybrid mode; full qmd tool parity can be tested separately.
- **Thin automated test infrastructure:** Mitigate by adding a minimal TypeScript test script, controllable delayed/rejected synthesis-provider fixtures, and backend-level tests before expanding CLI-level smoke coverage.

---

## Documentation / Operational Notes

Update `README.md` and `docs/memory-backends.md` to state that JSONL transcript append is immediate, markdown synthesis can be eventual, and explicit memory inspection/lifecycle commands flush or report pending work. Update `docs/smoke-tests.md` with commands or fixtures for slow summarizer behavior, queue/debug visibility, and current-session retcon precedence. Normalize terminology across `README.md`, `docs/memory-backends.md`, `docs/smoke-tests.md`, `src/index.ts`, and `src/memory.ts`: synthesis is `markdown synthesis`; qmd is compatibility/retrieval/indexing.

---

## Sources / Research

- `AGENTS.md` sets the priority: cross-session consistency, traceable memory behavior, pluggable memory, and separate raw transcript/facts/summaries/current state/conflicts.
- `src/memory.ts` contains the current `MemoryBackend` interface, transcript backend, qmd backend, two-stage recall, model synthesis, markdown writes, and dispose-time compaction.
- `src/index.ts` contains the CLI loop, memory command routing, before-prompt injection, awaited `afterTurn()`, `/new`, and final cleanup.
- `docs/memory-backends.md` defines the memory backend direction, qmd layout, policy modes, and synthesized-first transcript-fallback retrieval strategy.
- `docs/smoke-tests.md` defines the current build, CLI, memory, markdown synthesis, and qmd skill retrieval smoke-test surface.
