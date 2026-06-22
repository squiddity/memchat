import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "memchat-cli-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    assert.match(output, /bye/);
  });
});
