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
        assert.equal(fields["auto-exit"], "true");
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
      assert.match(body, /usageEvidence/);
      assert.match(body, /hostAdapter equal to the selected adapter/);
      assert.match(body, /Optional terminal `usageEvidence` is only a live hint/);
      assert.match(body, /authoritative content-free sidecar/);
      assert.match(body, /never estimate it/i);
    }
  });
}

test("facility preflight profiles enforce named read-only nested isolation", async () => {
  const coordinator = parseFlatProfile(await readFile(resolve(herdrRoot, "facility-preflight-coordinator.md"), "utf8"));
  assert.equal(coordinator.fields.spawning, "true");
  assert.equal(coordinator.fields["allowed-child-agents"], "facility-preflight-reader");
  assert.deepEqual(csv(coordinator.fields.tools), ["subagent"]);
  assert.match(coordinator.body, /Set `agent` to `facility-preflight-reader`/);
  assert.match(coordinator.body, /Do not replace the named profile with a raw `tools` allowlist/);
  assert.doesNotMatch(coordinator.body, /subagent_done|Completion contract:/);

  const reader = parseFlatProfile(await readFile(resolve(herdrRoot, "facility-preflight-reader.md"), "utf8"));
  assert.equal(reader.fields.spawning, "false");
  assert.equal(reader.fields["auto-exit"], "true");
  assert.deepEqual(csv(reader.fields.tools), ["read"]);
  assert.deepEqual(csv(reader.fields["deny-tools"]).filter((tool) => forbiddenWorkerTools.has(tool)).sort(), [...forbiddenWorkerTools].filter((tool) => tool !== "read").sort());
  assert.match(reader.body, /Do not read any file/);
  assert.doesNotMatch(reader.body, /subagent_done|Completion contract:/);
});

test("named profiles leave task completion behavior to the subagent facility", async () => {
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    for (const profile of MEM_IMPORT_NAMED_PROFILES) {
      const { body } = parseFlatProfile(await readFile(profilePath(profile, adapter), "utf8"));
      assert.doesNotMatch(body, /Completion contract:|when (?:this phase|your assigned work) is complete|summarizing what you accomplished/);
    }
  }
});

test("proposal coordinator profiles bound waves and atomic reconciliation sets", async () => {
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    const coordinator = parseFlatProfile(await readFile(profilePath(MEM_IMPORT_NAMED_PROFILES.find((item) => item.phase === "proposal")!, adapter), "utf8")).body;
    assert.match(coordinator, /never create a book-wide reconciliation set/);
    assert.match(coordinator, /waves of at most four/);
    assert.match(coordinator, /up to four disjoint reconciliation sets in parallel/);
    assert.match(coordinator, /within 50 proposals, 62 expected proposal artifacts, and 12 synthesized/);
    assert.match(coordinator, /one set yields exactly one identity packet and cannot be batched/);
    assert.match(coordinator, /never pass derived `candidateIds`, `unitIds`, or `proposalHashes`/);
    assert.match(coordinator, /do not immediately call `mem_import_assignment_brief`/);
    assert.match(coordinator, /treat an atomic identity-scope bound as structural/);
  }
});

test("Proposer and merger profiles require demand-driven evidence reads", async () => {
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    const proposer = parseFlatProfile(await readFile(profilePath(MEM_IMPORT_NAMED_PROFILES.find((item) => item.role === "proposer")!, adapter), "utf8")).body;
    assert.match(proposer, /description\/capsule/);
    assert.match(proposer, /standalone summary/);
    assert.match(proposer, /richer supported sections/);
    assert.match(proposer, /progressive disclosure/);
    assert.match(proposer, /group-appropriate details/);
    assert.match(proposer, /provenance/);
    assert.match(proposer, /read its exact candidate IDs directly/);
    assert.match(proposer, /do not call extraction inventory first/);
    assert.match(proposer, /Candidate title, payload, metadata, and provenance are sufficient/);
    assert.match(proposer, /never to verify anchors, expand adequate prose, increase confidence/);
    const merger = parseFlatProfile(await readFile(profilePath(MEM_IMPORT_NAMED_PROFILES.find((item) => item.role === "merger")!, adapter), "utf8")).body;
    assert.match(merger, /byte-for-byte accepts require no source\/extraction reread/);
    assert.match(merger, /Read canonical bodies only for collision, replacement, synthesis, deletion, or stale read sets/);
    assert.match(merger, /reopen only exact source spans/);
    assert.match(merger, /call `mem_merge_requirements` with exactly that subset before building the transaction/i);
    assert.match(merger, /Prefer grouped `proposalAccepts`/);
    assert.match(merger, /never put `proposalHash` on an upsert/);
    assert.match(merger, /exact final `canonicalId`/);
    assert.match(merger, /never leave a provisional ID/);
    assert.match(merger, /standalone retrieval quality/);
    assert.match(merger, /protected existing Markdown links/);
    assert.match(merger, /`related` deduplicated and complementary/);
    assert.match(merger, /both directions/);
    assert.match(merger, /Call `mem_merge_validate`, fix every issue/);
  }
});

test("reviewer profiles make requested narrative omissions repair-level", async () => {
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    const reviewer = parseFlatProfile(await readFile(profilePath(MEM_IMPORT_NAMED_PROFILES.find((item) => item.role === "reviewer")!, adapter), "utf8")).body;
    assert.match(reviewer, /dedicated synopsis, source-ordered timeline, chapter\/scene guide/);
    assert.match(reviewer, /report it as `repair`, not `info`/);
    assert.match(reviewer, /falsely says those units were unavailable/);
  }
});

test("proposer, reviewer, and repairer profiles preserve authored traversal contract", async () => {
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    for (const role of ["proposer", "reviewer", "repairer"] as const) {
      const body = parseFlatProfile(await readFile(profilePath(MEM_IMPORT_NAMED_PROFILES.find((item) => item.role === role)!, adapter), "utf8")).body;
      assert.match(body, /\[\[artifact-id\|reader-facing label\]\]/);
      assert.match(body, /aliases(?:\/| and |,?\s*)possessives/i);
      assert.match(body, /pronouns/);
      assert.match(body, /ambiguous nouns/);
      assert.match(body, /self-links/);
      assert.match(body, /existing Markdown links/);
      assert.match(body, /URLs/);
      assert.match(body, /code/);
      assert.match(body, /provenance quotes/);
      assert.match(body, /`related`/);
      assert.match(body, /deduplicated/);
      assert.match(body, /(?:both directions|bidirectional|reciprocal)/i);
    }
    const reviewer = parseFlatProfile(await readFile(profilePath(MEM_IMPORT_NAMED_PROFILES.find((item) => item.role === "reviewer")!, adapter), "utf8")).body;
    assert.match(reviewer, /material semantic retrieval\/traversal problems/);
    assert.match(reviewer, /cannot infer every missed plain-text link/);
  }
});

test("review/finalization profiles wait passively and hold no heartbeat capability", async () => {
  const profile = MEM_IMPORT_NAMED_PROFILES.find((item) => item.phase === "finalize")!;
  for (const adapter of ["pi-herdr-subagents", "pi-subagents"] as const) {
    const { fields, body } = parseFlatProfile(await readFile(profilePath(profile, adapter), "utf8"));
    assert.equal(csv(fields.tools).includes("mem_import_heartbeat_merge_lease"), false);
    assert.match(body, /launch no reader, documentation, setup, wait, or other helper child/);
    assert.match(body, /do not acquire the coordinator merge lease before or while a reviewer\/repairer runs/);
    assert.match(body, /make no status, lease, heartbeat, resume, or other tool call/);
    assert.match(body, /`subagent_resume` is recovery only after an actual interrupted terminal state/);
    assert.match(body, /Acquire the coordinator merge lease only after checks report zero errors/);
  }
});

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
