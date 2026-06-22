import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryBackend, type ConversationTurn, type MemoryBackend, type MemoryFlushResult, type MemorySynthesis } from "./memory.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "memchat-memory-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function synthesis(label: string): MemorySynthesis {
  return {
    summaryBullets: [`Summary ${label}`],
    facts: [`Fact ${label}`],
    state: [`State ${label}`],
    conflicts: [],
  };
}

function turn(partial: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    userText: "Remember that the closet contains a brass telescope.",
    assistantText: "I'll remember the brass telescope in the closet.",
    timestamp: "2026-06-22T12:00:00.000Z",
    ...partial,
  };
}

async function flush(memory: MemoryBackend, reason: MemoryFlushResult["reason"]): Promise<MemoryFlushResult> {
  assert.ok(memory.flush, "backend should expose flush");
  return memory.flush({ reason });
}

test("none backend flush is a completed no-op", async () => {
  const memory = createMemoryBackend({ id: "none", cwd: process.cwd() });
  const result = await flush(memory, "manual");
  assert.deepEqual(result, {
    reason: "manual",
    pending: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    failures: [],
  });
});

test("transcript backend exposes empty work status and no-op flush", async () => {
  await withTempDir(async (dir) => {
    const memory = createMemoryBackend({ id: "transcript", cwd: process.cwd(), root: dir });
    const status = await memory.status();
    assert.deepEqual(status.work, { pending: 0, completed: 0, failed: 0, timedOut: 0, failures: [] });

    const result = await flush(memory, "recall");
    assert.equal(result.reason, "recall");
    assert.equal(result.pending, 0);
    assert.equal(result.failed, 0);
  });
});

test("new memory hit metadata preserves existing rendered context", async () => {
  await withTempDir(async (dir) => {
    const memory = createMemoryBackend({ id: "transcript", cwd: process.cwd(), root: dir, sessionId: "session-a" });
    await memory.afterTurn(turn());

    const context = await memory.beforePrompt({ userText: "telescope" });
    assert.equal(context.hits.length, 1);
    assert.equal(context.hits[0]?.sessionId, "session-a");
    assert.equal(context.hits[0]?.sourceTier, "transcript");
    assert.match(context.text, /Relevant remembered context:/);
    assert.match(context.text, /brass telescope/);
  });
});

test("qmd afterTurn returns before delayed markdown synthesis completes", async () => {
  await withTempDir(async (dir) => {
    const delayed = deferred<MemorySynthesis>();
    const memory = createMemoryBackend({
      id: "qmd",
      cwd: process.cwd(),
      root: dir,
      sessionId: "session-a",
      synthesisProvider: {
        label: "delayed-test",
        synthesizeTurn: () => delayed.promise,
      },
    });

    await memory.afterTurn(turn());
    let status = await memory.status();
    assert.equal(status.work?.pending, 1);

    const currentHits = await memory.recall("telescope");
    assert.equal(currentHits[0]?.sourceTier, "current-session");
    assert.equal(currentHits[0]?.pending, true);

    delayed.resolve(synthesis("one"));
    const flushed = await flush(memory, "manual");
    assert.equal(flushed.pending, 0);
    assert.equal(flushed.completed, 1);

    status = await memory.status();
    assert.equal(status.work?.pending, 0);
    const facts = await readFile(join(dir, "memory", "facts.md"), "utf-8");
    assert.match(facts, /Fact one/);
  });
});

test("markdown synthesis failures fall back without crashing queued work", async () => {
  await withTempDir(async (dir) => {
    const memory = createMemoryBackend({
      id: "qmd",
      cwd: process.cwd(),
      root: dir,
      sessionId: "session-a",
      synthesisProvider: {
        label: "rejecting-test",
        synthesizeTurn: async () => {
          throw new Error("summarizer unavailable");
        },
      },
    });

    await memory.afterTurn(turn());
    const flushed = await flush(memory, "manual");
    assert.equal(flushed.failed, 1);
    assert.equal(flushed.completed, 1);
    assert.match(flushed.failures[0] ?? "", /summarizer unavailable/);

    const summary = await readFile(join(dir, "memory", "summaries", "2026-06-22.md"), "utf-8");
    assert.match(summary, /Unsynthesized turn/);
  });
});

test("markdown synthesis queue preserves rapid turn order", async () => {
  await withTempDir(async (dir) => {
    const seen: string[] = [];
    const memory = createMemoryBackend({
      id: "qmd",
      cwd: process.cwd(),
      root: dir,
      sessionId: "session-a",
      synthesisProvider: {
        label: "ordered-test",
        async synthesizeTurn({ turn: inputTurn }) {
          seen.push(inputTurn.timestamp);
          return synthesis(inputTurn.timestamp);
        },
      },
    });

    await memory.afterTurn(turn({ timestamp: "2026-06-22T12:00:00.000Z", userText: "First turn mentions an amber key." }));
    await memory.afterTurn(turn({ timestamp: "2026-06-22T12:01:00.000Z", userText: "Second turn mentions a blue door." }));
    await flush(memory, "manual");

    assert.deepEqual(seen, ["2026-06-22T12:00:00.000Z", "2026-06-22T12:01:00.000Z"]);
    const summary = await readFile(join(dir, "memory", "summaries", "2026-06-22.md"), "utf-8");
    assert.ok(summary.indexOf("Summary 2026-06-22T12:00:00.000Z") < summary.indexOf("Summary 2026-06-22T12:01:00.000Z"));
  });
});

test("qmd recall de-duplicates current-session and flushed markdown hits from the same turn", async () => {
  await withTempDir(async (dir) => {
    const memory = createMemoryBackend({
      id: "qmd",
      cwd: process.cwd(),
      root: dir,
      sessionId: "session-a",
      synthesisProvider: {
        label: "dedupe-test",
        async synthesizeTurn() {
          return synthesis("telescope");
        },
      },
    });

    await memory.afterTurn(turn());
    await flush(memory, "manual");
    const hits = await memory.recall("telescope");
    const sameTurnHits = hits.filter((hit) => hit.sessionId === "session-a" && hit.timestamp === "2026-06-22T12:00:00.000Z");
    assert.equal(sameTurnHits.length, 1);
    assert.equal(sameTurnHits[0]?.sourceTier, "current-session");
    assert.equal(sameTurnHits[0]?.pending, false);
  });
});

test("qmd retrieval renders current-session retcon candidates beside persisted memory", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "facts.md"), "# Facts\n\n- The closet contains a brass telescope. Source: .memchat/sessions/old.jsonl @ 2026-06-21T12:00:00.000Z\n", "utf-8");
    const memory = createMemoryBackend({ id: "qmd", cwd: process.cwd(), root: dir, sessionId: "session-new" });

    await memory.afterTurn(turn({
      userText: "Actually now it contains a silver astrolabe instead.",
      assistantText: "Understood — the current version has a silver astrolabe instead.",
      timestamp: "2026-06-22T12:02:00.000Z",
    }));

    const context = await memory.beforePrompt({ userText: "What are the closet contents?" });
    assert.match(context.text, /Persisted remembered context:/);
    assert.match(context.text, /brass telescope/);
    assert.match(context.text, /Possible conflicts or retcons:/);
    assert.match(context.text, /silver astrolabe/);
    assert.equal(context.hits[0]?.sourceTier, "current-session");
    assert.ok((context.hits[0]?.conflictsWith?.length ?? 0) > 0);
  });
});
