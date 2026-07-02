import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { envToggle, loadLocalEnv, providerAuthEnvKeys, reviewerProvider, truthyEnv } from "./local-env.js";

test("loadLocalEnv loads missing values without overwriting existing ones", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "memchat-local-env-"));
  await writeFile(join(cwd, ".env"), "FOO=from-env\nBAR='quoted value'\nBAZ=from-file\n", "utf-8");

  const previousFoo = process.env.FOO;
  const previousBar = process.env.BAR;
  const previousBaz = process.env.BAZ;
  process.env.FOO = "already-set";
  delete process.env.BAR;
  delete process.env.BAZ;

  try {
    const loadedPath = loadLocalEnv(cwd);
    assert.equal(loadedPath, join(cwd, ".env"));
    assert.equal(process.env.FOO, "already-set");
    assert.equal(process.env.BAR, "quoted value");
    assert.equal(process.env.BAZ, "from-file");
  } finally {
    if (previousFoo === undefined) delete process.env.FOO;
    else process.env.FOO = previousFoo;
    if (previousBar === undefined) delete process.env.BAR;
    else process.env.BAR = previousBar;
    if (previousBaz === undefined) delete process.env.BAZ;
    else process.env.BAZ = previousBaz;
  }
});

test("reviewerProvider and providerAuthEnvKeys report known auth envs", () => {
  assert.equal(reviewerProvider("openrouter/deepseek/deepseek-v4-pro"), "openrouter");
  assert.deepEqual(providerAuthEnvKeys("openrouter"), ["OPENROUTER_API_KEY"]);
  assert.deepEqual(providerAuthEnvKeys("lemonade"), ["MEMCHAT_LEMONADE_API_KEY", "MEMCHAT_LEMONADE_BASE_URL"]);
});

test("truthyEnv and envToggle honor explicit env settings", () => {
  assert.equal(truthyEnv("1"), true);
  assert.equal(truthyEnv("off"), false);

  const previous = process.env.MEMCHAT_LOCAL_ENV_TOGGLE;
  process.env.MEMCHAT_LOCAL_ENV_TOGGLE = "false";
  try {
    assert.equal(envToggle("MEMCHAT_LOCAL_ENV_TOGGLE", true), false);
  } finally {
    if (previous === undefined) delete process.env.MEMCHAT_LOCAL_ENV_TOGGLE;
    else process.env.MEMCHAT_LOCAL_ENV_TOGGLE = previous;
  }
});
