import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  MEM_IMPORT_COORDINATOR_ALLOWED_CHILDREN,
  MEM_IMPORT_COORDINATOR_PHASE_TOOLS,
  MEM_IMPORT_NAMED_PROFILES,
  MEM_IMPORT_PROFILE_EXTENSION,
  memImportProfileTools,
  renderMemImportNamedProfile,
  type MemImportNamedProfile,
  type MemImportProfileAdapter,
} from "./mem-import/named-profiles.js";
import { MEM_IMPORT_ROLE_TOOLS } from "./mem-import/service.js";

const herdrRoot = resolve(".pi/agents");
const piSubagentsRoot = resolve("fixtures/mem-import/named-profiles/pi-subagents");
const expectedNames = [
  "mem-import-coordinator-extraction",
  "mem-import-coordinator-proposal",
  "mem-import-coordinator-merge",
  "mem-import-coordinator-finalize",
  "mem-import-extractor",
  "mem-import-proposer",
  "mem-import-reconciler",
  "mem-import-merger",
  "mem-import-reviewer",
  "mem-import-repairer",
];
const herdrLifecycle = ["subagent", "subagent_interrupt", "subagent_resume"];
const piSubagentsLifecycle = ["subagent"];
const forbiddenWorkerTools = new Set(["subagent", "subagent_interrupt", "subagents_list", "subagent_resume", "bash", "read", "write", "edit"]);

function parseFlatProfile(content: string): { fields: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, "profile must use flat Markdown frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    assert.ok(field, `unsupported non-flat frontmatter line: ${line}`);
    fields[field[1]!] = field[2]!;
  }
  return { fields, body: match[2]! };
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function rootFor(adapter: MemImportProfileAdapter): string {
  return adapter === "pi-herdr-subagents" ? herdrRoot : piSubagentsRoot;
}

function profilePath(profile: MemImportNamedProfile, adapter: MemImportProfileAdapter): string {
  return resolve(rootFor(adapter), `${profile.name}.md`);
}

for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
  test(`${adapter} has ten stable profiles rendered from the shared manifest`, async () => {
    assert.deepEqual(MEM_IMPORT_NAMED_PROFILES.map((profile) => profile.name), expectedNames);
    assert.equal(new Set(expectedNames).size, 10);
    const files = (await readdir(rootFor(adapter))).filter((name) => name.startsWith("mem-import-") && name.endsWith(".md")).sort();
    assert.deepEqual(files, expectedNames.map((name) => `${name}.md`).sort());
    for (const profile of MEM_IMPORT_NAMED_PROFILES) {
      assert.equal(await readFile(profilePath(profile, adapter), "utf8"), renderMemImportNamedProfile(profile, adapter));
    }
  });

  test(`${adapter} workers retain exact effective role tools and disable spawning`, async () => {
    for (const profile of MEM_IMPORT_NAMED_PROFILES.filter((item) => item.kind === "worker")) {
      const { fields, body } = parseFlatProfile(await readFile(profilePath(profile, adapter), "utf8"));
      assert.ok(profile.role);
      const declaredTools = csv(fields.tools);
      // pi-subagents prepends read when explicit skills are configured. Its
      // adapter rendering deliberately has no skills field, so this is also
      // the effective --tools list rather than merely the declared list.
      const effectiveTools = adapter === "pi-subagents" && csv(fields.skills).length > 0 && !declaredTools.includes("read")
        ? ["read", ...declaredTools]
        : declaredTools;
      assert.deepEqual(effectiveTools, MEM_IMPORT_ROLE_TOOLS[profile.role]);
      assert.deepEqual(declaredTools, memImportProfileTools(profile, adapter));
      assert.equal(fields.name, `mem-import-${profile.role}`);
      assert.deepEqual(declaredTools.filter((tool) => forbiddenWorkerTools.has(tool)), []);
      if (adapter === "pi-herdr-subagents") {
        assert.equal(fields.spawning, "false");
        assert.equal(fields["auto-exit"], "true");
        assert.equal(fields["session-mode"], "standalone");
        assert.equal(fields.skills, undefined);
        assert.deepEqual(csv(fields["deny-tools"]).filter((tool) => forbiddenWorkerTools.has(tool)).sort(), [...forbiddenWorkerTools].sort());
      } else {
        assert.equal(fields.defaultContext, "fresh");
        assert.equal(fields.maxSubagentDepth, "0");
        assert.equal(fields.skills, undefined, "pi-subagents skills would broaden exact worker tools with read");
        assert.equal(fields.subagentOnlyExtensions, MEM_IMPORT_PROFILE_EXTENSION);
      }
      assert.equal(fields.cwd, undefined, "profiles must inherit the invoking checkout rather than pin a machine path");
      assert.ok(body.trim().length > 0, "profiles must contain generated role guidance");
      assert.doesNotMatch(body, /coordinatorGrant|\brunId:|\boutputRoot:|candidateId:|sourceId:/i);
    }
  });

  test(`${adapter} coordinators use only phase and adapter lifecycle tools`, async () => {
    const lifecycle = adapter === "pi-herdr-subagents" ? herdrLifecycle : piSubagentsLifecycle;
    for (const profile of MEM_IMPORT_NAMED_PROFILES.filter((item) => item.kind === "coordinator")) {
      const { fields, body } = parseFlatProfile(await readFile(profilePath(profile, adapter), "utf8"));
      assert.ok(profile.phase);
      const tools = csv(fields.tools);
      assert.deepEqual(tools, [...MEM_IMPORT_COORDINATOR_PHASE_TOOLS[profile.phase], ...lifecycle]);
      assert.deepEqual(tools, memImportProfileTools(profile, adapter));
      assert.equal(fields.name, `mem-import-coordinator-${profile.phase}`);
      assert.deepEqual(
        csv(fields["allowed-child-agents"]),
        adapter === "pi-herdr-subagents" ? [...MEM_IMPORT_COORDINATOR_ALLOWED_CHILDREN[profile.phase]] : [],
      );
      assert.ok(tools.includes("subagent"));
      assert.equal(tools.some((tool) => Object.values(MEM_IMPORT_ROLE_TOOLS).some((roleTools) => roleTools.includes(tool))), false);
      assert.equal(tools.some((tool) => ["bash", "read", "write", "edit"].includes(tool)), false);
      assert.equal(tools.some((tool) => tool === "mem_import_begin" || tool === "mem_import_begin_compendium"), false);
      if (adapter === "pi-herdr-subagents") {
        assert.equal(fields.spawning, "true");
        assert.equal(fields["auto-exit"], "false");
        assert.equal(fields["session-mode"], "standalone");
        assert.equal(fields.skills, undefined);
      } else {
        assert.equal(fields.defaultContext, "fresh");
        assert.equal(fields.maxSubagentDepth, "1");
        assert.equal(fields.subagentOnlyExtensions, MEM_IMPORT_PROFILE_EXTENSION);
        assert.deepEqual(tools.filter((tool) => tool.startsWith("subagent")), ["subagent"]);
      }
      assert.equal(fields.cwd, undefined);
      assert.ok(body.trim().length > 0, "profiles must contain generated phase guidance");
      assert.match(body, /every worker `subagent` call must set `agent` to the exact `assignment\.profile`/);
      assert.match(body, /`name` is display-only/);
      assert.match(body, /do not launch or retry bare/);
      assert.match(body, /fresh task ID/);
    }
  });
}

test("extension loading is explicit where supported and ambient Herdr loading remains configured", async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { pi?: { extensions?: string[] } };
  assert.ok(packageJson.pi?.extensions?.includes(MEM_IMPORT_PROFILE_EXTENSION));
  await readFile(resolve(MEM_IMPORT_PROFILE_EXTENSION), "utf8");
});

test("all profile fixtures are credential-free and contain no runtime payload", async () => {
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    for (const profile of MEM_IMPORT_NAMED_PROFILES) {
      const content = await readFile(profilePath(profile, adapter), "utf8");
      assert.doesNotMatch(content, /coordinatorGrant|\bgrant:|\brunId:|\boutputRoot:|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|bearer\s+/i);
      assert.doesNotMatch(content, /<html|sourceId:|unitId:|candidateId:|task:/i);
    }
  }
});
