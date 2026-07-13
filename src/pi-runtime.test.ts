import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { resolvePiRuntimePaths } from "./pi-runtime.js";

test("uses only the project-local pi runtime by default", () => {
  const paths = resolvePiRuntimePaths({ cwd: "/tmp/memchat-project" });

  assert.equal(paths.agentDir, "/tmp/memchat-project/.memchat/pi");
  assert.equal(paths.modelsPath, "/tmp/memchat-project/.memchat/pi/models.json");
  assert.equal(paths.authPath, "/tmp/memchat-project/.memchat/pi/auth.json");
});

test("uses an explicitly configured credentials file without changing resource roots", () => {
  const paths = resolvePiRuntimePaths({
    cwd: "/tmp/memchat-project",
    authFile: "../shared/auth.json",
  });

  assert.equal(paths.agentDir, "/tmp/memchat-project/.memchat/pi");
  assert.equal(paths.modelsPath, "/tmp/memchat-project/.memchat/pi/models.json");
  assert.equal(paths.authPath, resolve("/tmp/memchat-project", "../shared/auth.json"));
});
