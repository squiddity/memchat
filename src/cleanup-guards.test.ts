import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type PackageJson = {
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  files?: string[];
};

type CleanupViolation = {
  path: string;
  category: string;
  detail: string;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const retiredImporter = ["world", "import"].join("-");
const retiredOutputDirectory = ["world", "-", "output"].join("");
const retiredIdentifier = ["World", "Import"].join("");
const retiredConstant = ["WORLD", "IMPORT"].join("_");
const retiredServiceToken = ["u", "2", "-", "service"].join("");
const retiredServiceClass = ["MemImport", "U", "2", "Service"].join("");
const roadmapWordPattern = /\bU\d+[a-z]?\b/;
const roadmapFilenamePattern = /(?:^|\/)u\d+-/;

const activeRoots = [
  "src",
  "scripts",
  "extensions",
  "skills",
  ".pi/agents",
  "fixtures",
  "docs",
  "README.md",
  "AGENTS.md",
  ".gitignore",
  ".npmignore",
  ".nvmrc",
  ".node-version",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
];

const expectedBins = {
  memchat: "dist/index.js",
  "memchat-markdown-review": "dist/markdown-review-cli.js",
  "memchat-artifact-review": "dist/artifact-review-cli.js",
};
const expectedPackageFiles = [
  "dist/index.js",
  "dist/artifact-review-cli.js",
  "dist/markdown-review-cli.js",
  "dist/local-env.js",
  "dist/memory.js",
  "dist/model-selection.js",
  "dist/output-coordinator.js",
  "dist/pi-runtime.js",
  "dist/mem-import/",
  "src/mem-import/",
  "extensions/",
  "skills/",
  "fixtures/mem-import/named-profiles/",
  "docs/architecture.md",
  "docs/cli.md",
  "docs/memory-backends.md",
  "docs/playtesting.md",
  "docs/smoke-tests.md",
  "README.md",
];
const expectedScripts = [
  "dev",
  "fixture:alice-excerpt",
  "conformance:mem-import",
  "markdown-review",
  "artifact-review",
  "build",
  "start",
  "test",
  "test:mem-import",
  "test:cleanup",
];

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function isHistoricalDocumentation(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "docs/plans" || normalized.startsWith("docs/plans/") || normalized === "docs/evaluations" || normalized.startsWith("docs/evaluations/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const deletedLegacyPaths = [
  ["src", `${retiredImporter}-cli.ts`].join("/"),
  ["src", `${retiredImporter}-cli-format.ts`].join("/"),
  ["src", retiredImporter].join("/"),
  ["legacy", "skills", retiredImporter].join("/"),
  ["docs", `${retiredImporter}.md`].join("/"),
  ["scripts", `${retiredImporter}-run.sh`].join("/"),
  ["src", "mem-import", retiredServiceToken].join("/"),
];
const deletedLegacyPathPattern = new RegExp(deletedLegacyPaths.map(escapeRegExp).join("|"));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(path: string, displayPath: string): Promise<Array<{ path: string; relativePath: string }>> {
  if (isHistoricalDocumentation(displayPath)) return [];
  const info = await stat(path);
  if (info.isFile()) return [{ path, relativePath: normalizePath(displayPath) }];
  if (!info.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const files: Array<{ path: string; relativePath: string }> = [];
  for (const entry of entries) {
    const childDisplayPath = normalizePath(join(displayPath, entry.name));
    files.push(...await collectFiles(join(path, entry.name), childDisplayPath));
  }
  return files;
}

function textViolations(relativePath: string, text: string): CleanupViolation[] {
  const violations: CleanupViolation[] = [];
  const add = (category: string, detail: string): void => {
    violations.push({ path: relativePath, category, detail });
  };
  if (text.toLowerCase().includes(retiredImporter)) add("retired importer vocabulary", "hyphenated importer token");
  if (text.toLowerCase().includes(retiredOutputDirectory)) add("retired output path", "obsolete output directory token");
  if (text.includes(retiredIdentifier)) add("retired importer identifier", "camel-case identifier");
  if (text.includes(retiredConstant)) add("retired importer identifier", "constant identifier");
  if (text.includes(retiredServiceToken)) add("retired service vocabulary", "service token");
  if (text.includes(retiredServiceClass)) add("retired service identifier", "service identifier");
  if (roadmapWordPattern.test(text)) add("roadmap label", "whole-word numbered label");
  if (deletedLegacyPathPattern.test(text)) add("deleted legacy path", "path reference");
  return violations;
}

function pathViolations(relativePath: string): CleanupViolation[] {
  const normalized = normalizePath(relativePath);
  const violations: CleanupViolation[] = [];
  if (normalized.toLowerCase().includes(retiredOutputDirectory)) {
    violations.push({ path: normalized, category: "retired path", detail: "obsolete output directory token" });
  }
  if (deletedLegacyPathPattern.test(normalized)) {
    violations.push({ path: normalized, category: "deleted legacy path", detail: "path reference" });
  }
  return violations;
}

function filenameViolations(relativePath: string): CleanupViolation[] {
  const normalized = normalizePath(relativePath);
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const violations: CleanupViolation[] = [];
  if (filename.toLowerCase().includes(retiredImporter)) {
    violations.push({ path: normalized, category: "retired filename", detail: "hyphenated importer token" });
  }
  if (filename.toLowerCase().includes(retiredOutputDirectory)) {
    violations.push({ path: normalized, category: "retired filename", detail: "obsolete output directory token" });
  }
  if (filename.includes(retiredIdentifier) || filename.includes(retiredConstant)) {
    violations.push({ path: normalized, category: "retired filename", detail: "retired importer identifier" });
  }
  if (filename.includes(retiredServiceToken) || filename.includes(retiredServiceClass)) {
    violations.push({ path: normalized, category: "retired filename", detail: "retired service identifier" });
  }
  if (roadmapFilenamePattern.test(filename)) {
    violations.push({ path: normalized, category: "retired filename", detail: "numbered roadmap filename label" });
  }
  return violations;
}

async function scanActiveTree(): Promise<CleanupViolation[]> {
  const files: Array<{ path: string; relativePath: string }> = [];
  for (const activeRoot of activeRoots) {
    const absolutePath = join(repositoryRoot, activeRoot);
    if (await exists(absolutePath)) files.push(...await collectFiles(absolutePath, activeRoot));
  }
  const violations: CleanupViolation[] = [];
  for (const file of files) {
    violations.push(...pathViolations(file.relativePath));
    violations.push(...filenameViolations(file.relativePath));
    const text = await readFile(file.path, "utf8");
    violations.push(...textViolations(file.relativePath, text));
  }
  const distRoot = join(repositoryRoot, "dist");
  if (await exists(distRoot)) {
    for (const file of await collectFiles(distRoot, "dist")) {
      violations.push(...pathViolations(file.relativePath));
      violations.push(...filenameViolations(file.relativePath));
      violations.push(...textViolations(file.relativePath, await readFile(file.path, "utf8")));
    }
  }
  return violations;
}

function formatViolations(violations: CleanupViolation[]): string {
  return violations.map((violation) => `${violation.path}: ${violation.category} (${violation.detail})`).join("\n");
}

test("active product tree contains no retired importer, service, or roadmap vocabulary", async () => {
  const violations = await scanActiveTree();
  assert.deepEqual(violations, [], formatViolations(violations));
});

test("package metadata exposes only current bins and scripts", async () => {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")) as PackageJson;
  const gitignore = await readFile(join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^compendium-output\/$/m);
  assert.doesNotMatch(gitignore, new RegExp(escapeRegExp(retiredOutputDirectory)));
  assert.equal(packageJson.bin && Object.keys(packageJson.bin).length, Object.keys(expectedBins).length);
  assert.deepEqual(packageJson.bin, expectedBins);
  assert.deepEqual(Object.keys(packageJson.scripts ?? {}).sort(), [...expectedScripts].sort());
  assert.equal(packageJson.scripts?.["test:cleanup"], "node --import tsx --test src/cleanup-guards.test.ts");
  assert.deepEqual(packageJson.files, expectedPackageFiles);
  assert.equal(await exists(join(repositoryRoot, retiredOutputDirectory)), false, "retired output tree must be absent");
  assert.ok(!packageJson.files?.some((entry) => entry === "samples/" || entry === "docs/" || entry === "docs/plans/" || entry.includes(retiredOutputDirectory)), "package allowlist must exclude samples, plans, and generated outputs");

  const packageLock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8")) as { name?: string; packages?: { "": PackageJson & { name?: string } } };
  assert.equal(packageLock.name, "memchat");
  assert.equal(packageLock.packages?.[""].name, "memchat");
  assert.deepEqual(packageLock.packages?.[""].bin, expectedBins);
});

