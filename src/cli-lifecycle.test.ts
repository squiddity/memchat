import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { CliOutputCoordinator } from "./output-coordinator.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "memchat-cli-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function captureStream(isTTY: boolean): { stream: NodeJS.WriteStream; output: () => string } {
  let text = "";
  return {
    stream: {
      isTTY,
      write(chunk: string | Uint8Array) {
        text += String(chunk);
        return true;
      },
    } as NodeJS.WriteStream,
    output: () => text,
  };
}

async function runMemchat(input: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`memchat child process timed out. Output:\n${output}`));
    }, 20_000);

    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error(`memchat exited with code=${code} signal=${signal}. Output:\n${output}`));
    });

    child.stdin.end(input);
  });
}

test("prompt-safe debug rendering clears and redraws an active partial prompt", () => {
  const captured = captureStream(true);
  const coordinator = new CliOutputCoordinator(captured.stream);
  coordinator.setReadline({ line: "what is my", cursor: 10 } as never);
  coordinator.setAcceptingInput(true);

  coordinator.writeAsyncBlock("_ [memory qmd/before-prompt] recalled 2 hit(s)_\n");

  assert.match(captured.output(), /^\r\x1b\[2K/);
  assert.match(captured.output(), /\[memory qmd\/before-prompt\]/);
  assert.match(captured.output(), /you> what is my$/);
});

test("prompt-safe debug rendering keeps non-TTY output line-oriented", () => {
  const captured = captureStream(false);
  const coordinator = new CliOutputCoordinator(captured.stream);
  coordinator.setReadline({ line: "what is my", cursor: 10 } as never);
  coordinator.setAcceptingInput(true);

  coordinator.writeAsyncBlock("[memory injected-context]\nRelevant remembered context:\n- brass telescope");

  assert.equal(captured.output(), "[memory injected-context]\nRelevant remembered context:\n- brass telescope\n");
  assert.doesNotMatch(captured.output(), /\x1b\[2K/);
  assert.doesNotMatch(captured.output(), /you> what is my/);
});

test("/help documents memory ignore commands", async () => {
  const output = await runMemchat("/help\n/exit\n", ["--memory", "none"]);
  assert.match(output, /\/memory ignore last/);
  assert.match(output, /\/memory ignore recent <n>/);
});

test("/memory status reports queue state without requiring a flush", async () => {
  await withTempDir(async (dir) => {
    const output = await runMemchat("/memory status\n/exit\n", ["--memory", "qmd-hardwired", "--memory-dir", dir]);
    assert.match(output, /Memory mode: qmd-hardwired/);
    assert.match(output, /Memory work: pending=0, completed=0, failed=0, timedOut=0/);
    assert.match(output, /bye/);
  });
});

test("/memory index remains usable with flush-aware qmd mode", async () => {
  await withTempDir(async (dir) => {
    const output = await runMemchat("/memory index\n/exit\n", ["--memory", "qmd-hardwired", "--memory-dir", dir]);
    assert.match(output, /indexed \d+ markdown memory file\(s\)/);
    assert.match(output, /Shutting down; flushing memory before exit/);
    assert.match(output, /bye/);
  });
});

test("/new owns lifecycle output before rendering the next piped prompt", async () => {
  await withTempDir(async (dir) => {
    const output = await runMemchat("/memory status\n/new\n/memory status\n/exit\n", ["--memory", "transcript", "--memory-dir", dir]);
    const firstStatus = output.indexOf("Memory mode: transcript");
    const busy = output.indexOf("Starting new session; flushing and compacting memory before the next prompt...");
    const started = output.indexOf("Started new session");
    const nextPrompt = output.indexOf("you> /memory status", busy + 1);

    assert.ok(firstStatus >= 0);
    assert.ok(busy > firstStatus);
    assert.ok(started > busy);
    assert.ok(nextPrompt > started);
    assert.match(output, /bye/);
  });
});
