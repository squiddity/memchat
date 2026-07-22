import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseUntracked(status: string): string[] {
  return status.split("\0").filter(Boolean).flatMap((entry) => entry.startsWith("?? ") ? [entry.slice(3)] : []);
}

/** Content-derived source revision that cannot reuse a clean-HEAD acceptance
 * receipt when tracked, staged, or untracked repository files differ. */
export async function acceptanceSourceRevision(cwd = process.cwd()): Promise<string> {
  const [{ stdout: head }, { stdout: diff }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }),
    execFileAsync("git", ["diff", "--binary", "HEAD"], { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }),
    execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }),
  ]);
  const revision = head.trim();
  if (!status) return revision;
  const hash = createHash("sha256").update(diff);
  for (const relativePath of parseUntracked(status).sort()) {
    hash.update("\0untracked\0").update(relativePath).update("\0");
    hash.update(await readFile(resolve(cwd, relativePath)));
  }
  return `${revision}+dirty-${hash.digest("hex").slice(0, 16)}`;
}
