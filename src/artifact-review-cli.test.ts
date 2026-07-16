import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseArgs, runArtifactReview } from "./artifact-review-cli.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "memchat-artifact-review-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("artifact review defaults to a stable local-test port and accepts an explicit root/port", () => {
  assert.deepEqual(parseArgs([]), { root: ".memchat-agent-testing/output", port: 8522 });
  assert.deepEqual(parseArgs(["storyboards", "--port", "8530"]), { root: "storyboards", port: 8530 });
  assert.throws(() => parseArgs(["--port", "0"]), /between 1 and 65535/);
  assert.throws(() => parseArgs(["one", "two"]), /Usage:/);
});

test("artifact review serves only rooted JSON files and ignores symlinks", async () => {
  await withTempDir(async (repo) => {
    const root = join(repo, "artifacts");
    await mkdir(join(root, "stages"), { recursive: true });
    await writeFile(join(root, "stages", "packet.json"), '{"kind":"extraction"}\n');
    await writeFile(join(root, "notes.md"), "# Not JSON\n");
    const outside = await mkdtemp(join(tmpdir(), "memchat-artifact-review-outside-"));
    await writeFile(join(outside, "secret.json"), '{"secret":true}\n');
    await symlink(outside, join(root, "escape"));

    let port: string | undefined;
    let request: Promise<void> | undefined;
    await runArtifactReview(
      { root: "artifacts", port: 0 },
      repo,
      {
        discoverTailscale: () => ({ address: "127.0.0.1", dnsName: "reviewer.example.ts.net" }),
        viewerBundle: resolve("node_modules/vanilla-jsoneditor/standalone.js"),
        onUrl: (url) => { port = new URL(url).port; },
        onServerStarted: (server) => {
          request = (async () => {
            while (!port) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
            const base = `http://127.0.0.1:${port}`;
            const tree = await (await fetch(`${base}/api/tree`)).json() as { entries: unknown[] };
            assert.match(JSON.stringify(tree), /packet\.json/);
            assert.doesNotMatch(JSON.stringify(tree), /notes\.md|escape|secret/);
            const file = await (await fetch(`${base}/api/file?path=stages%2Fpacket.json`)).json() as { text: string };
            assert.match(file.text, /extraction/);
            assert.equal((await fetch(`${base}/api/file?path=..%2Fsecret.json`)).status, 400);
            server.close();
          })();
        },
      },
    );
    await request;
    await rm(outside, { recursive: true, force: true });
  });
});

test("artifact review rejects a root that resolves outside its repository", async () => {
  await withTempDir(async (repo) => {
    const outside = await mkdtemp(join(tmpdir(), "memchat-artifact-review-outside-"));
    try {
      await symlink(outside, join(repo, "escape"));
      await assert.rejects(runArtifactReview({ root: "escape", port: 0 }, repo), /outside the repository/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
