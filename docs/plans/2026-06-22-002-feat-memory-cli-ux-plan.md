---
title: "feat: Improve memory CLI UX"
type: feat
date: 2026-06-22
---

# feat: Improve memory CLI UX

## Summary

Improve memchat's interactive memory UX so debug output stays readable without clobbering prompts, lifecycle work owns the prompt while it runs, low-value current-session hits are less likely to pollute injected context, and users can mark mistaken turns before they become durable memory.

---

## Problem Frame

The async session-aware memory implementation works, but the interactive run exposed UX friction. Background debug lines can appear while the readline prompt is active, so typed input and debug output interleave. `/new` can trigger compaction while the user is already typing the next prompt, which makes it unclear whether the old or new session owns that input. Retrieval also injected low-value current-session turns from accidental inputs and routine clarification replies alongside useful story state.

These issues do not require a new memory backend. They need a terminal-native output discipline, explicit lifecycle prompt ownership, lightweight memory hygiene, and retrieval ranking improvements that preserve current-session precedence for real continuity details.

---

## Requirements

**Terminal output and prompt ownership**

- R1. Memory debug output must not overwrite or visually merge with the active `you>` prompt or partially typed user input.
- R2. Debug output remains scrollback-readable in plain terminals and pi interactive shells without requiring a full-screen TUI.
- R3. Long lifecycle operations such as flush and compaction must display a clear busy state and withhold the next prompt until ownership has moved to the new session.
- R4. Non-debug mode remains quiet except for user-facing warnings or command results.

**Memory hygiene and retrieval quality**

- R5. Users can explicitly mark the previous turn or a small recent range as mistaken/ignored so it is excluded from future synthesis and retrieval.
- R6. Mistake marking is traceable: raw transcripts can retain an audit record, but synthesized markdown and injected memory should not treat ignored turns as useful continuity.
- R7. Current-session retrieval should down-rank routine acknowledgements, accidental strings, and meta-corrections when stronger story/state hits are available.
- R8. Current-session precedence for meaningful state, inventory, names, locations, retcons, and conflicts must remain intact.

**Validation and docs**

- R9. Tests cover prompt-safe debug rendering, lifecycle prompt blocking, ignored-turn behavior, and retrieval filtering.
- R10. README and smoke tests document the debug output mode, mistake command, and lifecycle behavior.

---

## Key Technical Decisions

- KTD1. **Use a terminal-native event log, not a full TUI:** A small output coordinator should serialize prompt clearing, debug lines, assistant streaming, and prompt redraw. This keeps scrollback useful and avoids a dependency-heavy TUI rewrite.
- KTD2. **Make lifecycle work an input boundary:** `/new` and shutdown should visibly enter a busy lifecycle state and only render the next `you>` prompt after flush/compaction and session rotation finish.
- KTD3. **Treat mistakes as annotations, not deletion:** Keep raw transcript traceability while adding stable turn identities and ignore metadata that tells queued synthesis, already-written markdown, and retrieval to skip ignored turns.
- KTD4. **Make ignore effective immediately:** Ignoring a turn should tombstone current-session hits and cancel or skip queued synthesis when possible; if markdown has already been written, future retrieval and compaction must treat source-cited ignored turns as excluded.
- KTD5. **Filter current-session hits by value, not by source tier:** Current-session hits remain first-class, but low-value conversational/meta turns should lose to stateful story facts when prompt context is capped.

---

## High-Level Technical Design

```mermaid
flowchart TB
  Input[readline prompt] --> Coordinator[CLI output coordinator]
  Debug[background memory debug event] --> Coordinator
  Assistant[assistant stream] --> Coordinator
  Lifecycle[/new or /exit lifecycle work] --> Coordinator

  Coordinator --> Clear[clear active prompt line when needed]
  Clear --> Log[print prefixed debug/event block]
  Log --> Redraw[redraw prompt only when input is accepted]
  Lifecycle --> Busy[show busy lifecycle state]
  Busy --> Rotate[finish flush/compaction/session rotation]
  Rotate --> Redraw

  Turn[conversation turn] --> Transcript[raw transcript audit]
  UserMark[/memory ignore last] --> Annotation[ignored-turn annotation]
  Annotation --> Synthesis[markdown synthesis skips ignored turns]
  Annotation --> Retrieval[current-session and persisted retrieval down-rank/exclude ignored turns]
```

The CLI should route all writes through one output coordinator. Memory hygiene should be represented as metadata that downstream synthesis and retrieval can honor without erasing the raw audit trail.

---

## Scope Boundaries

### In Scope

- Terminal-native debug output coordination for readline-based CLI sessions.
- Busy-state prompt ownership for `/new`, `/exit`, and flush/compaction operations.
- A small explicit mistake/ignore command for recent turns.
- Retrieval quality filtering for low-value current-session hits.
- Tests and docs for the observed interactive-shell behavior.

### Deferred to Follow-Up Work

- A full curses-style or React/Ink TUI with panes, keybindings, and persistent debug panels.
- Automatic detection of accidental user input without explicit user marking.
- Editing or deleting historical transcript records from disk.
- Rich memory curation UI beyond a small CLI command surface.

---

## Implementation Units

### U1. Add a prompt-safe output coordinator

- **Goal:** Centralize CLI writes so memory debug lines, assistant streaming, warnings, and prompts do not clobber each other.
- **Requirements:** R1, R2, R4, R9.
- **Dependencies:** None.
- **Files:** `src/index.ts`, `src/cli-lifecycle.test.ts`, `docs/smoke-tests.md`.
- **Approach:** Introduce a small coordinator around the existing `output.write`, spinner, debug printers, and readline prompt. It should snapshot active readline text/cursor state when available, clear the active prompt line before printing asynchronous debug output, print debug blocks with consistent prefixes, and redraw the prompt plus partial input only when the CLI is accepting input. Keep behavior terminal-native so pi interactive shell scrollback remains readable.
- **Patterns to follow:** Existing `InlineSpinner`, `printMemoryDebugLine()`, `printMemoryDebugEvent()`, `printInjectedMemoryContext()`, and `attachSessionEvents()` in `src/index.ts`.
- **Test scenarios:**
  - Happy path: a debug event emitted while waiting for input prints on its own line and the `you>` prompt is redrawn afterward.
  - Edge case: a fake readline state with partial text such as `what is my` is restored after an async memory debug line.
  - Edge case: multi-line injected memory context prints as one readable debug block without interleaving with the prompt.
  - Error path: debug output in non-TTY piped mode remains line-oriented and does not emit terminal cursor control that pollutes logs.
  - Integration: assistant streaming still prints `memchat>` output without double prompts or missing newlines.
  - Integration: a PTY-style or coordinator-level test exercises prompt redraw behavior that piped stdin cannot observe.
- **Verification:** Manual interactive-shell output shows debug blocks and prompts as separate scrollback entries.

### U2. Own prompt state during lifecycle work

- **Goal:** Prevent user input from appearing to race with `/new`, `/exit`, flush, or compaction.
- **Requirements:** R1, R3, R4, R9.
- **Dependencies:** U1.
- **Files:** `src/index.ts`, `src/cli-lifecycle.test.ts`, `docs/smoke-tests.md`.
- **Approach:** Treat lifecycle operations as a busy state: pause prompt redraw and buffer or ignore interactive input until the lifecycle operation finishes, show a concise lifecycle message, run flush/compaction/session rotation, then render the new prompt only after the new session exists. Keep warnings visible if lifecycle flush times out or fails. Tests should assert the first post-`/new` user turn is recorded under the new memory session rather than only proving piped input is processed sequentially.
- **Patterns to follow:** Existing `startNewSession()`, `flushMemory()`, final cleanup, and memory debug event output in `src/index.ts`.
- **Test scenarios:**
  - Happy path: `/new` prints a busy lifecycle message before compaction and prints `Started new session` before the next prompt.
  - Edge case: input sent immediately after `/new` is processed only after session rotation finishes and is recorded under the new session id.
  - Failure path: a flush timeout prints a warning and does not render ambiguous old-session and new-session prompts.
  - Integration: `/exit` flush/compaction output remains readable and ends with `bye`.
- **Verification:** Users can tell which session owns the next prompt after `/new`.

### U3. Add explicit recent-turn ignore annotations

- **Goal:** Let users mark accidental or mistaken turns so they stop contributing to synthesized memory and injected retrieval.
- **Requirements:** R5, R6, R9, R10.
- **Dependencies:** U1.
- **Files:** `src/index.ts`, `src/memory.ts`, `src/memory.test.ts`, `src/cli-lifecycle.test.ts`, `README.md`, `docs/memory-backends.md`, `docs/smoke-tests.md`.
- **Approach:** Add a small command surface such as `/memory ignore last` and optionally `/memory ignore recent <n>`. Add stable turn identity to transcript records and current-session hits, then expose backend methods such as `ignoreRecentTurns(count)` or `ignoreTurn(id)`. Ignore should immediately tombstone current-session hits, cancel or skip queued synthesis tasks when the turn has not yet been written, and record source-level ignore annotations for already-synthesized markdown so retrieval excludes those source-cited snippets and future compaction can restate memory without them. Keep raw transcript records for audit.
- **Execution note:** Start with tests that reproduce accidental input being injected after a later story prompt, then add ignore behavior.
- **Patterns to follow:** Existing command parsing in `handleInput()`, `TranscriptRecord`, `ConversationTurn`, current-session hit metadata, and markdown source citations in `src/memory.ts`.
- **Test scenarios:**
  - Happy path: after two accidental turns, `/memory ignore recent 2` prevents those turns from appearing in `beforePrompt()` context.
  - Edge case: ignoring a non-existent recent turn reports a clear command message and does not corrupt memory state.
  - Error path: ignored turns remain in raw JSONL transcript or audit records with traceable metadata.
  - Integration: a queued synthesis task for an ignored turn is skipped or produces no durable markdown.
  - Integration: a turn ignored after markdown has already been written is filtered from recall by source identity and removed from future compaction output.
  - Integration: compaction after ignored turns does not restate them into facts/state/summary markdown.
- **Verification:** Mistaken inputs can be excluded from future continuity without deleting the audit trail.

### U4. Tune current-session retrieval value ranking

- **Goal:** Reduce low-value current-session hits while preserving current-session precedence for meaningful continuity.
- **Requirements:** R7, R8, R9.
- **Dependencies:** U3.
- **Files:** `src/memory.ts`, `src/memory.test.ts`, `README.md`, `docs/smoke-tests.md`.
- **Approach:** Add lightweight value scoring for current-session hits. Prefer hits with story state, inventory, names, locations, explicit user preferences, or retcon cues. Down-rank short accidental strings, generic acknowledgements, and meta-corrections when higher-value hits exist. Keep traceable reasons simple; avoid adding a semantic classifier in this pass.
- **Patterns to follow:** Existing `searchCurrentSession()`, `scoreText()`, `stageRank()`, `mergeHits()`, `renderContext()`, and memory kind/source-tier metadata in `src/memory.ts`.
- **Test scenarios:**
  - Happy path: a story inventory hit outranks a generic greeting when both match a broad query.
  - Edge case: if the only relevant hit is low-value, retrieval can still return it rather than hiding all context.
  - Error path: ignored turns are excluded even if their lexical score is high.
  - Integration: with `maxPromptHits` small, a low-value current-session hit does not displace a stronger persisted story-state hit.
  - Integration: current-session retcon hits still outrank persisted older memory.
- **Verification:** Prompt context is less noisy in story sessions without regressing retcon/current-session precedence tests.

### U5. Document and smoke-test the improved interactive UX

- **Goal:** Make the new CLI behavior discoverable and repeatable for manual testing.
- **Requirements:** R2, R3, R5, R10.
- **Dependencies:** U1, U2, U3, U4.
- **Files:** `README.md`, `docs/smoke-tests.md`, `src/cli-lifecycle.test.ts`.
- **Approach:** Update the command docs and smoke-test guide with the isolated memory-dir interactive-shell pattern, debug output expectations, lifecycle prompt behavior, and mistake-ignore command examples.
- **Patterns to follow:** Existing README memory backend section and `docs/smoke-tests.md` CLI command style.
- **Test scenarios:**
  - Documentation consistency: README and smoke tests describe the same command names and debug behavior.
  - Smoke scenario: start `qmd-hybrid` with `--memory-debug`, create a story detail, ignore accidental input, run `/new`, then recall the durable detail.
- **Verification:** A user can repeat the interactive-shell scenario without rediscovering flags or expected output.

---

## Risks & Dependencies

- **Readline rendering is easy to regress:** Keep the coordinator small and cover both TTY-like and piped output.
- **Ignore annotations can hide useful context if too broad:** Start with explicit recent-turn commands and clear command feedback.
- **Ranking heuristics can overfit the observed transcript:** Preserve fallback behavior when low-value hits are the only relevant hits.
- **Debug readability competes with model streaming:** Route both through the same coordinator so fixes do not only cover memory events.

---

## Sources / Research

- `src/index.ts` contains readline prompt handling, spinner logic, memory debug printers, assistant streaming subscriptions, `/new`, `/exit`, and flush calls.
- `src/memory.ts` contains current-session hit creation, retrieval ranking, context rendering, markdown synthesis, compaction, and source metadata.
- `src/cli-lifecycle.test.ts` and `src/memory.test.ts` provide the existing test harness for CLI command behavior and memory retrieval.
- `README.md`, `docs/memory-backends.md`, and `docs/smoke-tests.md` document qmd-compatible memory modes, debug output, and interactive-shell testing.
