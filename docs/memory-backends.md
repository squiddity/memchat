# Memory backend plan

Memchat should support selectable memory backends for both interactive CLI use and repeatable evaluations. The immediate goal is to compare simple, traceable approaches before adopting heavier memory systems.

## Recommended implementation order

1. `none` — current no-persistence behavior.
2. `transcript` — memchat-owned append-only transcript/event persistence.
3. `qmd` — local markdown search over memchat-owned memory notes.
4. `pi-mem` — pi-native extension backed by the `claude-mem` worker.
5. `memsearch` — markdown-first semantic memory backed by Python/Milvus tooling.

The next unit of work should implement selectable `none`, `transcript`, and `qmd` modes.

## Selection interface

Use the same selector in CLI, env, and tests/evals:

```bash
npm run dev -- --memory none
npm run dev -- --memory transcript
npm run dev -- --memory qmd

MEMCHAT_MEMORY=qmd npm run dev
```

Interactive commands should start small:

```text
/memory
/memory status
/memory backends
/memory recall <query>
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

Potential first implementation:

1. After each assistant turn, append a simple markdown note to `summaries/YYYY-MM-DD.md`.
2. Run or schedule qmd index/update.
3. Before each prompt, search qmd using the user input.
4. Inject top hits as “Relevant remembered context”.
5. Log query/hits for eval traceability.

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
