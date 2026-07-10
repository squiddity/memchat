import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverTailscale, parseArgs, resolveReviewRoot, runReview, tailscaleUrlFromStartup } from "./markdown-review-cli.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "memchat-markdown-review-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parseArgs defaults to world-output and accepts one explicit root", () => {
  assert.deepEqual(parseArgs([]), { root: "world-output" });
  assert.deepEqual(parseArgs(["storyboards"]), { root: "storyboards" });
  assert.throws(() => parseArgs(["one", "two"]), /Usage:/);
});

test("resolveReviewRoot accepts contained directories and rejects unsafe roots", async () => {
  await withTempDir(async (repo) => {
    await mkdir(join(repo, "world-output"));
    await mkdir(join(repo, "storyboards"));
    await writeFile(join(repo, "not-a-directory.md"), "# no");
    const outside = await mkdtemp(join(tmpdir(), "memchat-markdown-review-outside-"));
    try {
      await symlink(outside, join(repo, "escape"));
      assert.equal(await resolveReviewRoot(repo, "world-output"), resolve(repo, "world-output"));
      assert.equal(await resolveReviewRoot(repo, "storyboards"), resolve(repo, "storyboards"));
      await assert.rejects(resolveReviewRoot(repo, "missing"), /does not exist/);
      await assert.rejects(resolveReviewRoot(repo, "not-a-directory.md"), /not a directory/);
      await assert.rejects(resolveReviewRoot(repo, ".."), /outside the repository/);
      await assert.rejects(resolveReviewRoot(repo, "escape"), /outside the repository/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("discoverTailscale rejects missing or malformed local Tailscale data", async () => {
  await withTempDir(async (dir) => {
    const fake = join(dir, "tailscale");
    await writeFile(fake, "#!/bin/sh\nif [ \"$1\" = ip ]; then echo not-an-ip; else echo not-json; fi\n");
    await chmod(fake, 0o755);
    assert.throws(() => discoverTailscale(fake), /trusted IPv4 address/);

    await writeFile(fake, "#!/bin/sh\nif [ \"$1\" = ip ]; then echo 100.64.0.1; else echo not-json; fi\n");
    assert.throws(() => discoverTailscale(fake), /malformed/);

    await writeFile(fake, "#!/bin/sh\nif [ \"$1\" = ip ]; then echo 100.64.0.1; else echo '{\"Self\":{\"DNSName\":\"reviewer.example.ts.net.\"}}'; fi\n");
    assert.deepEqual(discoverTailscale(fake), { address: "100.64.0.1", dnsName: "reviewer.example.ts.net" });
  });
});

test("tailscaleUrlFromStartup reports only the confirmed DNS URL and actual port", () => {
  assert.equal(
    tailscaleUrlFromStartup("🌐 Server running at http://100.101.102.103:8522/index.md\n", "reviewer.example.ts.net"),
    "http://reviewer.example.ts.net:8522/index.md",
  );
  assert.equal(tailscaleUrlFromStartup("Server running at http://100.101.102.103:abc", "reviewer.example.ts.net"), undefined);
  assert.equal(tailscaleUrlFromStartup("not ready", "reviewer.example.ts.net"), undefined);
  assert.equal(
    tailscaleUrlFromStartup("Server running at \u001b]8;;http://100.101.102.103:8521\u001b\\http://100.101.102.103:8521\u001b]8;;\u001b\\", "reviewer.example.ts.net"),
    "http://reviewer.example.ts.net:8521",
  );
});

test("runReview serves a fixture through mdts and shuts it down", async () => {
  await withTempDir(async (repo) => {
    const root = join(repo, "world-output");
    await mkdir(root);
    await writeFile(join(root, "index.md"), "# Fixture review\n");
    const mdts = resolve("node_modules/.bin/mdts");
    let viewerPort: string | undefined;
    let request: Promise<void> | undefined;
    await runReview(
      { root: "world-output" },
      repo,
      {
        discoverTailscale: () => ({ address: "127.0.0.1", dnsName: "reviewer.example.ts.net" }),
        mdtsBinary: mdts,
        onUrl: (url) => {
          viewerPort = new URL(url).port;
        },
        onChildStarted: (child) => {
          request = (async () => {
            let timedOut = false;
            const deadline = setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
            }, 10_000);
            try {
              while (!viewerPort) {
                if (timedOut) throw new Error("Timed out waiting for mdts startup URL.");
                await new Promise((resolveWait) => setTimeout(resolveWait, 10));
              }
              const response = await fetch(`http://127.0.0.1:${viewerPort}/api/filetree`);
              assert.equal(response.status, 200);
              assert.match(JSON.stringify(await response.json()), /index\.md/);
              child.kill("SIGTERM");
            } finally {
              clearTimeout(deadline);
            }
          })();
        },
      },
    );
    await request;
    await assert.rejects(fetch(`http://127.0.0.1:${viewerPort}/api/filetree`));
  });
});

test("review runtime homes are owner-only", async () => {
  await withTempDir(async (repo) => {
    const home = join(repo, "runtime-home");
    await mkdir(home, { mode: 0o700 });
    await chmod(home, 0o700);
    const mode = (await (await import("node:fs/promises")).stat(home)).mode & 0o777;
    assert.equal(mode, 0o700);
  });
});
