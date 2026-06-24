---
date: 2026-06-24
topic: provenance-preserving-world-library
---

# Requirements: Provenance-Preserving World Library

## Summary
Build a loosely coupled, agent-friendly canon-builder standard + toolkit that ingests large-scale fiction or world material (e.g. EPUB, HTML, Markdown, or archives of those formats) and ongoing lore, then synthesizes it into an interconnected, file-canonical world library. The canonical store is a typed markdown tree optimized for agents and humans, while qmd or similar vector/search indexing acts as a companion accelerator rather than the source of truth.

---

## Problem Frame
Memchat already has strong memory primitives: raw transcript persistence, synthesized facts/state/conflicts, provenance cues, ignored-turn handling, and multi-stage retrieval. What it does not yet provide is a reusable canon-building layer that can ingest large narrative sources, preserve provenance across multiple inputs, and produce durable world knowledge that other systems can use without inheriting memchat itself.

Existing lorebook ecosystems point in two different directions. Older systems often bias toward explicit JSON records with keyword triggers and manual context management. Newer agent-memory systems bias toward retrieval layers, vector stores, and generic long-term memory. This work exists in the gap between them: it should preserve a canonical world library as durable files, but also support efficient targeted retrieval through companion indexing.

The motivating use case is large imported fiction or world material in a variety of ingestible formats (e.g. EPUB, HTML pages, Markdown documents, or archives thereof), where chapter summaries alone would be the wrong output. The importer should do real synthesis, breaking the source into reusable world artifacts around characters, settings, rules, and plot-linked canon, with strong provenance links back to source material.

---

## Key Decisions

- **Persistence-first over retrieval-first.** The first release is primarily a canon builder, not a smarter source searcher. Retrieval matters, but it serves the persisted world library rather than replacing it.
- **File-canonical over index-canonical.** The source of truth is a readable, inspectable file tree. Search/vector indexes may be regenerated or swapped without redefining canon.
- **Typed packets in markdown-tree form.** The standard should behave like strongly typed canon packets, but stored in a markdown tree rather than a single large summary file or opaque database.
- **Auto-canon on import by default.** Imported material should become usable canon quickly, without a heavy review-first workflow in the first release.
- **No automatic conflict winner.** Imported canon has high precedence, but disagreements between imported material, later lore, and manual corrections remain visible instead of being silently resolved.
- **Loose coupling is part of the product.** Although this work lives in the memchat repo, the first release should result in an independently usable canon-builder toolkit with an agent-operable CLI and skill contract.
- **Format-agnostic ingestion by default.** The toolkit should accept a variety of structured and semi-structured text inputs (e.g. EPUB, HTML, Markdown, or archives of those formats) rather than optimizing for any single format.
- **Reuse before rebuilding.** The first release should adapt existing memchat provenance, markdown memory, qmd, CLI, and skill primitives where compatible, while keeping the canon format and toolkit independently usable.

---

## Requirements

**Format and source of truth**

- R1. The toolkit must persist canon in a file-canonical format that remains inspectable and useful without requiring a vector index or database.
- R2. The canonical format must be a markdown tree with strong typed conventions, so the stored artifacts behave like structured canon packets rather than chapter-sized summary blobs.
- R3. The format must preserve explicit provenance for every persisted canon artifact and for atomic factual claims or typed fields inside artifacts when they are independently reusable, including enough information to trace each claim or artifact back to one or more source materials or source spans.
- R4. The canonical store must remain portable across tools and systems so it can be used independently of memchat.

**World-library artifact model**

- R5. The importer must synthesize an interconnected set of world artifacts centered on at least characters, settings, rules, and plot-linked canon.
- R6. The canonical structure must support links between artifacts so downstream retrieval can move from one world object to adjacent relevant objects instead of treating each file as an isolated note.
- R7. The canonical structure must distinguish durable canon artifacts from raw imported sources and from regenerated retrieval indexes.
- R8. The canonical structure must support both exact-source inspection and compact prompt-ready reuse of distilled canon.

**Import, reimport, and provenance handling**

- R9. The toolkit must support importing one or more lengthy source documents across a variety of ingestible formats (e.g. EPUB, HTML, Markdown, or archives thereof), not limited to any single format.
- R10. Import must perform real synthesis into world artifacts rather than only storing documents whole or emitting chapter-by-chapter summaries.
- R11. Reimport must preserve stable artifact identities and explicit reimport mapping states, such as unchanged, updated, split, merged, deprecated, and newly created, so canon artifacts can still be traced across successive imports of the same or updated source material.
- R12. The system must preserve multi-source provenance when one canon artifact is supported by more than one source.
- R13. Imported source material must carry high precedence in the system’s interpretation of canon, but that precedence must not silently erase disagreement from later lore or manual corrections.

**Conflict and disagreement handling**

- R14. When imported canon, ongoing lore, or manual correction disagree, the system must preserve the disagreement as an explicit visible state rather than automatically selecting a winner.
- R15. The first release must allow downstream agents and tools to detect that a canon artifact is disputed.
- R16. Conflict resolution workflows may be deferred, but the stored format must not make later resolution impossible or lossy.

**Retrieval and agent use**

- R17. The stored canon must be optimized for efficient targeted retrieval by agents, including use through companion indexers such as qmd.
- R18. The retrieval layer must be optional but expected in serious use: the canonical files remain authoritative, while indexes accelerate discovery and assembly.
- R19. The stored canon must remain usable for both semantic retrieval and more explicit/manual context-management styles used by lorebook-oriented systems, including optional activation or export metadata such as aliases, keywords, tags, and priority hints where useful.
- R20. The toolkit must expose an agent-friendly invocation surface so an agent can import, reimport, inspect, and retrieve world-library artifacts through a CLI plus a companion skill contract.

---

## Key Flows

- F1. **Import a new source corpus**
  - **Trigger:** A user or agent provides one or more source materials in an ingestible format (e.g. EPUB, HTML, Markdown, or archives thereof).
  - **Steps:** The toolkit ingests the materials, performs synthesis, emits typed markdown canon artifacts, records provenance, and prepares companion retrieval/index inputs.
  - **Outcome:** A usable world library exists as canonical files, with linked artifacts and source traceability.

- F2. **Reimport or refresh an existing source**
  - **Trigger:** A source document changes, is reprocessed, or is re-imported with updated synthesis behavior.
  - **Steps:** The toolkit updates the world library while preserving provenance continuity and surfacing disagreement instead of flattening it.
  - **Outcome:** Canon stays refreshable without losing source traceability or silently rewriting contested knowledge.

- F3. **Agent retrieves targeted canon for use in a memchat-like system**
  - **Trigger:** An agent needs world knowledge for a prompt or question.
  - **Steps:** The agent uses the skill-described CLI to query the world library directly and, where helpful, through a companion index such as qmd.
  - **Outcome:** The agent receives targeted canon artifacts with traceable provenance, not a generic monolithic summary.

---

## Acceptance Examples

- AE1. **Covers R5, R9, R10, R17.** After importing a long fiction source (e.g. an EPUB or a collection of Markdown/HTML documents), the output is not a single chapter-summary file; it includes distinct linked canon artifacts for major characters, settings, and world rules that can be retrieved individually.
- AE2. **Covers R3, R11, R12.** When a character fact is supported by two imported sources, the canonical artifact records both sources and retains that relationship after a later reimport.
- AE3. **Covers R14, R15, R16.** When later lore disagrees with imported canon, the stored world library marks the disagreement explicitly and does not silently choose one version as canonical truth.
- AE4. **Covers R1, R2, R18.** If the vector/search index is deleted, the canonical markdown tree still remains readable, navigable, and sufficient to rebuild the index.
- AE5. **Covers R19, R20.** An agent can use the documented CLI + skill contract to retrieve targeted canon for a scene without requiring bespoke memchat-only integration logic.

---

## Success Criteria

- The first release produces a file-canonical world library that a future planner could treat as an independent product surface, not just an internal memchat backend detail.
- Imported long-form sources in various ingestible formats yield reusable, linked world artifacts rather than coarse narrative summaries.
- Provenance remains inspectable across import, reimport, and multi-source synthesis.
- Disagreements are visible and machine-detectable even before conflict-resolution workflows exist.
- A downstream agent can use the toolkit through its CLI + skill contract to retrieve targeted canon efficiently for a memchat-like system.

---

## Scope Boundaries

### Deferred for later
- Full conflict-resolution workflows, including automatic or human-guided winner selection.
- A richer end-user canon-management application with browsing, editing, and review UX beyond the toolkit surface.
- Deep optimization of retrieval policies beyond the initial file-canonical + companion-index approach.

### Outside this product's identity
- A retrieval-only source search tool with little or no persisted canon layer.
- A memchat-exclusive feature that cannot be reused independently.
- A canonical format whose authority depends on a specific vector store or database remaining present.

---

## Dependencies / Assumptions

- The first release assumes a strong bias toward fiction and worldbuilding use cases, especially characters, settings, rules, and plot-linked canon.
- The first release assumes imported source material in a variety of ingestible formats (e.g. EPUB, HTML, Markdown, or archives thereof) is a primary input rather than a secondary convenience path for any single format.
- The first release assumes agent operation matters from day one: the CLI and skill contract are product requirements, not later polish.
- The first release assumes qmd-style indexing is a realistic companion path, but not a canonical dependency.

---

## Outstanding Questions

### Deferred to Planning
- What exact typed markdown conventions best express canon packets while keeping the files pleasant for both human and agent use?
- Which minimum artifact types are required in v1 beyond characters, settings, rules, and plot-linked canon?
- What reimport matching strategy best preserves provenance continuity across importer revisions and source updates?

---

## Sources / Research

- `AGENTS.md` — project goals around traceable memory, pluggable memory, and explicit separation of transcript/facts/summaries/state/conflicts.
- `docs/architecture.md` — memory quality bar, especially contradiction avoidance and inspectability.
- `docs/memory-backends.md` — current source-of-truth posture, qmd compatibility, and transcript vs synthesized memory model.
- `docs/cli.md` — current CLI memory surfaces and qmd-related operation modes.
- `docs/ideation/2026-06-24-memchat-world-manager-lorebooks-ideation.html` — ideation source, especially the top-ranked Provenance-Preserving World Library direction.
- `src/memory.ts` — current fact/state/conflict typing, provenance-bearing memory hits, ignored-turn handling, current-session precedence, and conflict-aware rendering substrate.
- `src/index.ts` — current CLI command surface, memory prompts, and qmd skill guidance substrate.
- External grounding gathered during ideation: SillyTavern World Info / lorebook docs, Cloudflare Agents memory model, Redis long-term memory architecture overview, MongoDB/LangGraph memory overview, AdaMem long-horizon dialogue memory summary.

---

## Deferred / Open Questions

### From 2026-06-24 review

- **Auto-canon lacks trust guard** — Key Decisions / Import, reimport, and provenance handling (P1, product-lens, adversarial, confidence 100)

  The product depends on users and agents trusting synthesized canon. If import writes usable canon by default without a lightweight review, confidence, or correction gate, the first experience can create plausible but wrong world facts that provenance can trace but not prevent from being reused.

- **Independent toolkit premise lacks validation** — Problem Frame / Key Decisions (P1, product-lens, confidence 75)

  If the reusable toolkit is the wrong first wedge, the first release can spend its scarce product budget on portability, standards, and external operability before proving the core memchat memory outcome users actually need.

- **No minimum slice** — Requirements / Key Decisions (P1, scope-guardian, product-lens, confidence 100)

  Planning can turn this into an all-or-nothing release that must deliver format-agnostic ingestion, artifact synthesis, reimport continuity, conflict visibility, retrieval, CLI, and skill integration before any usable canon-builder can ship or be validated.
