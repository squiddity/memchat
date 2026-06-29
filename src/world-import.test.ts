import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { defaultPackageRoot, renderWorldImportSkillInvocation, worldImportSkill } from "./world-import/model-runner.js";
import { writeExtractionStage } from "./world-import/staging.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memchat-world-router-"));
}

function helper(args: string[], input?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/world-import/command-router.ts", ...args], {
    cwd: process.cwd(),
    input,
    encoding: "utf-8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("local world-import skill is package-loadable independent of runtime cwd", () => {
  const skill = worldImportSkill(defaultPackageRoot());
  assert.equal(skill.name, "world-import");
  assert.equal(resolve(skill.filePath), resolve("skills/world-import/SKILL.md"));
});

test("world import model runner renders structured skill invocation", () => {
  const prompt = renderWorldImportSkillInvocation({ input: "/in", outputRoot: "/out", reviewerModel: "openai/gpt-4o", dryRun: true });
  assert.match(prompt, /^\/skill:world-import /);
  assert.match(prompt, /"input":"\/in"/);
  assert.match(prompt, /"dryRun":true/);
});

test("extraction stage rejects candidates without operational provenance envelope", async () => {
  const output = await tempDir();
  await assert.rejects(
    writeExtractionStage(output, { version: 1, kind: "extraction", unitId: "u", candidates: [{}] }),
    /id must be a non-empty string/,
  );
});

test("helper command flow normalizes, writes generic merge packet, and emits markdown", async () => {
  const root = await tempDir();
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await writeFile(join(input, "chapter.html"), "<html><body><p>Ada guards the glass tower.</p></body></html>", "utf-8");

  const normalized = helper(["normalize", "--input", input, "--output", output]);
  assert.equal(normalized.status, 0, normalized.stderr);
  const units = JSON.parse(helper(["list-units", "--output", output]).stdout) as Array<{ unitId: string; sourceId: string }>;
  assert.equal(units.length, 1);
  const unitText = helper(["read-unit", "--output", output, "--unit", units[0].unitId]);
  assert.match(unitText.stdout, /\[b0001\] Ada guards/);

  const merge = {
    version: 1,
    kind: "merge",
    artifacts: [{
      id: "ada",
      group: "people",
      title: "Ada",
      sections: [{ heading: "Summary", body: "Ada guards the glass tower." }],
      provenance: [{ sourceId: units[0].sourceId, unitId: units[0].unitId, startAnchor: "b0001", endAnchor: "b0001", quote: "Ada guards the glass tower." }],
    }],
  };
  const wrote = helper(["write-merge", "--output", output], JSON.stringify(merge));
  assert.equal(wrote.status, 0, wrote.stderr);
  const emitted = helper(["emit", "--output", output]);
  assert.equal(emitted.status, 0, emitted.stderr);
  const markdown = await readFile(join(output, "world", "people", "ada.md"), "utf-8");
  assert.match(markdown, /# Ada/);
  assert.match(markdown, /## Provenance/);
  assert.match(markdown, /\(\/sources\/units\/.+?#b0001\)/);
  const sourcePage = await readFile(join(output, "world", "sources", "units", `${units[0].unitId}.md`), "utf-8");
  assert.match(sourcePage, /type: "Source Unit"/);
  assert.match(sourcePage, /## b0001/);
  assert.match(sourcePage, /Ada guards the glass tower/);
  const sourceIndex = await readFile(join(output, "world", "sources", "index.md"), "utf-8");
  assert.match(sourceIndex, /\(\/sources\/units\/.+?\.md\)/);
  const coverage = await readFile(join(output, "world", "coverage.md"), "utf-8");
  assert.match(coverage, /\[Ada\]\(\/people\/ada\.md\)/);
});
