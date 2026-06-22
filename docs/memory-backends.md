# Memory backend plan

Memchat should support selectable memory backends for both interactive CLI use and repeatable evaluations. The immediate goal is to compare simple, traceable approaches before adopting heavier memory systems.

## Recommended implementation order

1. `none` — current no-persistence behavior.
2. `transcript` — memchat-owned append-only transcript/event persistence.
3. `qmd` — local markdown search over memchat-owned memory notes.
4. `pi-mem` — pi-native extension backed by the `claude-mem` worker.
5. `memsearch` — markdown-first semantic memory backed by Python/Milvus tooling.

Selectable `none`, `transcript`, and `qmd` backends are now implemented in `src/memory.ts` and wired into the CLI. Memory selection is moving from simple backend names toward policy modes that separate storage backend, persistence policy, retrieval policy, and skill exposure. Current modes include `none`, `transcript`/`transcript-hardwired`, `qmd`/`qmd-hardwired`, `qmd-skill-retrieval`, and `qmd-hybrid`.

The current hardwired `qmd` path uses the planned markdown source-of-truth layout plus model-based markdown synthesis and a TypeScript lexical search fallback. The markdown is qmd-compatible, but synthesis is memchat-owned rather than qmd-driven. Skill-based qmd modes require the local npm package `@tobilu/qmd`, load its package-provided `skills/qmd/SKILL.md` without copying or overriding it, and let the model decide when to use the qmd CLI for retrieval. Replacing the hardwired fallback with the `@tobilu/qmd` SDK/CLI is a future enhancement.

## Selection interface

Use the same selector in CLI, env, and tests/evals:

```bash
npm run dev -- --memory none
npm run dev -- --memory transcript-hardwired
npm run dev -- --memory qmd-hardwired
npm run dev -- --memory qmd-skill-retrieval
npm run dev -- --memory qmd-hybrid
npm run dev -- --memory qmd-hybrid --memory-dir .memchat-experiments/run-001
npm run dev -- --memory qmd-hybrid --summarizer-model openai/gpt-4o-mini

MEMCHAT_MEMORY=qmd-hybrid npm run dev
MEMCHAT_MEMORY_DIR=.memchat-clean npm run dev -- --memory qmd-hardwired
```

Short aliases `transcript` and `qmd` remain supported for the hardwired modes. By default, the memory root is `.memchat/`; use `--memory-dir` or `MEMCHAT_MEMORY_DIR` to preserve progress in one directory and start clean experiments in another.

Interactive commands should start small:

```text
/memory
/memory status
/memory backends
/memory recall <query>
/memory ignore last
/memory ignore recent <n>
/memory index
```

Evaluations should accept the same flag:

```bash
npm run eval -- --memory none
npm run eval -- --memory transcript
npm run eval -- --memory qmd
```

## Candidate comparison

| Backend | Starter simplicity | External server required? | Language/runtime | Source of truth | Main use |
|---|---:|---:|---|---|---|
| `none` | Highest | No | TypeScript | active session only | Baseline |
| `transcript` | High | No | TypeScript | `.memchat/sessions/*.jsonl` | Durable raw recall/eval logging |
| `qmd` | High | No required server | Node/TypeScript package | memchat markdown files | First searchable memory backend |
| `pi-mem` | Medium | Yes, `claude-mem` worker | pi extension + worker | claude-mem DB | pi-native external baseline |
| `memsearch` | Medium-low | No required server, but Python/Milvus stack | Python CLI/API | markdown files + Milvus index | Rich long-term semantic memory |

## Why `qmd` is the preferred first searchable backend

[`qmd`](https://github.com/tobi/qmd) is an on-device search engine for markdown documents. It combines BM25, vector search, and reranking, but we can begin with simple local indexing/search.

Advantages for memchat:

- MIT licensed.
- TypeScript/Node-friendly via `@tobilu/qmd` SDK or CLI.
- SQLite-backed.
- No mandatory background server.
- Optional MCP/HTTP daemon if later useful.
- Good agent-oriented outputs (`--json`, `--files`, `get`, `multi-get`).
- Lets memchat keep ownership of what gets remembered.
- Fits a markdown source-of-truth workflow for summaries/facts/state.

Important limitation: `qmd` is a search/index layer, not a full memory system. Memchat must still decide what to write as durable memory.

## Proposed local memory layout

```text
.memchat/
  sessions/
    <session-id>.jsonl        # raw transcript/events
  memory/
    facts.md                  # extracted stable facts
    state.md                  # current chat/world state snapshot
    summaries/
      YYYY-MM-DD.md           # chronological summaries/notes
    conflicts.md              # retcons/conflicting claims
  qmd.sqlite                  # qmd index, rebuildable cache
```

Do not treat generated indexes as authoritative. Markdown and JSONL are the durable source of truth.

## Initial backend abstraction

Keep the interface small and event-oriented:

```ts
type MemoryPersistencePolicy = "none" | "hardwired" | "skill" | "hybrid";
type MemoryRetrievalPolicy = "none" | "hardwired" | "skill" | "hybrid";

interface MemoryBackend {
  id: string;
  status(): Promise<MemoryStatus>;
  beforePrompt(input: MemoryInput): Promise<MemoryContext>;
  afterTurn(turn: ConversationTurn): Promise<void>;
  recall(query: string): Promise<MemoryHit[]>;
  dispose?(): Promise<void>;
}
```

Traceability should be part of every recall result:

```ts
type MemoryHit = {
  text: string;
  source: string;
  kind: "transcript" | "summary" | "fact" | "state" | "conflict";
  score?: number;
  timestamp?: string;
};
```

## Backend behavior sketches

### `none`

- No durable writes.
- `beforePrompt` returns no memory context.
- `/memory status` reports disabled.
- Baseline for evals.

### `transcript`

- Persist raw user/assistant turns and metadata as JSONL.
- Optional `/memory recall` can do simple text search over transcripts.
- No model-based summarization required initially.
- Provides restart survival and inspection even before semantic memory.

### `qmd`

- Write memchat-owned markdown memory notes under `.memchat/memory/`.
- Configure/index that directory with qmd.
- Start with lexical/BM25 search for lower setup cost.
- Later add embeddings/reranking via qmd’s vector pipeline.
- `/memory recall <query>` searches qmd and returns cited snippets.
- `beforePrompt` retrieves top relevant snippets and injects them into context.

Current first implementation:

1. Persist raw turns to JSONL for transcript traceability.
2. After each assistant turn, run markdown synthesis to write reusable memory into `summaries/YYYY-MM-DD.md`, `facts.md`, `state.md`, and `conflicts.md` when persistence policy is `hardwired` or `hybrid`. JSONL append is immediate; markdown synthesis can run as background work and is flushed or reported by memory inspection and lifecycle commands.
3. Default the summarizer model to the active session model; allow `--summarizer-model` / `MEMCHAT_SUMMARIZER_MODEL` to choose a cheaper or specialized background model.
4. On session disposal (`/new` or `/exit`), compact/restates markdown memory so summaries are concise, facts are deduplicated, current state is current, and conflicts remain explicit.
5. `/memory index` initializes markdown files and reports indexed file count.
6. `/memory ignore last` and `/memory ignore recent <n>` append ignore annotations to the raw JSONL audit log. Ignored turns stay inspectable in transcripts, but current-session hits are tombstoned, pending synthesis is skipped when possible, and source-cited markdown is filtered from future retrieval/compaction.
7. In hardwired retrieval modes, before each prompt run session-aware two-stage lexical recall: compare current-session details with synthesized markdown first, and only fall back to JSONL transcript when markdown has no hits, weak hits, or conflict/uncertainty/source-verification cues.
8. Inject top hits as “Relevant remembered context” in hardwired/hybrid retrieval modes, preferring synthesized markdown hits over transcript hits.
9. In `qmd-skill-retrieval`, skip automatic context injection and rely on the loaded qmd skill for model-centric retrieval. Memchat adds wrapper system guidance, without modifying the third-party skill, telling the model to search `.memchat/memory` first and consult `.memchat/sessions` only for missing, weak, conflicting, or provenance-sensitive answers.
10. In `qmd-hybrid`, combine automatic session-aware two-stage lexical recall with optional model-centric qmd skill retrieval using the same synthesized-first strategy.
11. For now, render possible current-session conflicts or retcons in prompt context. A later conflict-resolution strategy may generate durable conflict events from the same comparison results.

Current safety note: qmd skill modes intentionally enable pi built-in tools so the unmodified package qmd skill declaring `allowed-tools: Bash(qmd:*)` can call `qmd` directly. A future hardening task should restrict actual Bash execution to qmd-only commands while preserving compatibility with unmodified qmd-style skills.

### `pi-mem`

[`pi-mem`](https://github.com/ArtemisAI/pi-mem) / `pi-agent-memory` is a native pi extension around `claude-mem`.

Pros:

- Already maps pi events.
- Registers memory recall tools.
- Useful external baseline.

Cons:

- AGPL-3.0.
- Requires `claude-mem` worker on `localhost:37777` by default.
- More oriented toward coding-agent observations/tool use than fiction/chat state.

### `memsearch`

[`memsearch`](https://github.com/zilliztech/memsearch) is markdown-first semantic memory with Milvus/Milvus Lite.

Pros:

- MIT licensed.
- Human-readable markdown source of truth.
- Strong retrieval architecture: search, expand, transcript.
- Cross-agent/plugin ecosystem.

Cons:

- Python stack and Milvus dependency.
- No native pi adapter yet.
- More integration work than `qmd`.

## Evaluation requirements

All backends should log comparable events so evals can compare fairly:

- selected memory backend,
- raw user/assistant turns,
- selected model,
- memory writes,
- memory queries,
- retrieved hits,
- injected context,
- final assistant answer.

A minimal fiction consistency eval should test:

1. Establish invented details, e.g. closet contains a brass telescope, old coats, and a locked cedar box.
2. Add distractor turns.
3. Restart or create a new process/session.
4. Ask about the closet contents.
5. Score exact recall, contradiction avoidance, uncertainty handling, and source traceability.
