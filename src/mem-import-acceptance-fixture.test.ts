import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  expectedRoleTools,
  loadAcceptanceFixture,
  materializeAcceptanceProbe,
  releaseAcceptanceProbeLease,
  type AcceptanceProbe,
  type PreparedAcceptanceProbe,
} from "./mem-import/acceptance-materializer.js";
import { MemImportAcceptanceService, buildAssignmentBoundProbeLaunch } from "./mem-import/acceptance-service.js";
import { ALL_ACCEPTANCE_PROBES, runFocusedAcceptance } from "./mem-import/focused-acceptance-runner.js";
import type { AssignmentBoundAcceptanceHost } from "./mem-import/pi-sdk-acceptance-adapter.js";
import { acceptanceSourceRevision } from "./mem-import/source-revision.js";
import { MemImportIdentityService } from "./mem-import/identity-service.js";
import { MemImportProposalService } from "./mem-import/proposal-service.js";
import { MemImportService } from "./mem-import/service.js";
import { MemImportU2Service } from "./mem-import/u2-service.js";

const fixtureRoot = resolve("fixtures/mem-import/acceptance/v1");
const exactHostEvidence = {
  evidenceSource: "host-runtime",
  profileStatus: "verified",
  toolProfileStatus: "exact",
  isolationMode: "sdk-in-memory",
  auxiliaryLaunchCount: 0,
} as const;

test("active guidance uses brief extension-agnostic facility acceptance", async () => {
  const [skill, parentPreflight, acceptance, recipes, capabilities, adapter] = await Promise.all([
    readFile(resolve("skills/mem-import/SKILL.md"), "utf8"),
    readFile(resolve("skills/mem-import/references/parent-preflight.md"), "utf8"),
    readFile(resolve("skills/mem-import/references/acceptance.md"), "utf8"),
    readFile(resolve("skills/mem-import/references/facility-recipes.md"), "utf8"),
    readFile(resolve("skills/mem-import/references/subagent-capabilities.md"), "utf8"),
    readFile(resolve("skills/mem-import/references/adapters/pi-herdr-subagents.md"), "utf8"),
  ]);
  assert.match(skill, /Parent agent:[\s\S]*parent preflight and coordinator launch/);
  assert.match(skill, /Corpus coordinator:[\s\S]*Do not run acceptance/);
  assert.match(skill, /end the turn and remain idle/i);
  assert.match(skill, /Never derive observed evidence from the assignment or worker prose/);
  assert.match(parentPreflight, /Choose one facility/);
  assert.match(parentPreflight, /otherwise run \[brief acceptance\]/);
  assert.match(parentPreflight, /Do not run role-by-role conformance/);
  assert.match(acceptance, /does not require a named extension, programmatic adapter, exhaustive role certification/);
  assert.match(acceptance, /at most one tiny nested child/);
  assert.match(acceptance, /Stop when the planned capabilities are demonstrated/);
  assert.match(acceptance, /optional maintainer conformance/);
  assert.match(recipes, /\.memchat\/mem-import\/facility-recipes/);
  assert.match(capabilities, /do not make unavailable adapter-specific evidence universal/);
  assert.match(adapter, /known recipe, not a required mem-import backend or programmatic adapter/);
  assert.match(adapter, /Real imports still require each assignment's exact profile/);
});

async function tempOutput(label: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), `memchat-acceptance-${label}-`)), "output");
}

function redactRuntime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRuntime);
  if (!value || typeof value !== "object") return value;
  const omitted = new Set(["outputRoot", "runId", "taskId", "grant", "coordinatorGrant"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !omitted.has(key)).map(([key, item]) => [key, redactRuntime(item)]));
}

async function executePrepared(probe: PreparedAcceptanceProbe, releaseRepairLease = true): Promise<unknown> {
  const base = new MemImportService();
  const proposals = new MemImportProposalService(base);
  const identities = new MemImportIdentityService(base);
  const canonical = new MemImportU2Service(base);
  if (probe.probe === "normalize") return base.normalize(probe.call as Parameters<MemImportService["normalize"]>[0]);
  if (probe.probe === "extractor") return base.submitExtraction(probe.call as Parameters<MemImportService["submitExtraction"]>[0]);
  if (probe.probe === "proposer") return proposals.submitWorkerProposalBody(probe.call as Parameters<MemImportProposalService["submitWorkerProposalBody"]>[0]);
  if (probe.probe === "reconciler") return identities.submitWorkerIdentity(probe.call as Parameters<MemImportIdentityService["submitWorkerIdentity"]>[0]);
  if (probe.probe === "merger") return canonical.commitWorkerBatchReceipt(probe.call as Parameters<MemImportU2Service["commitWorkerBatchReceipt"]>[0]);
  if (probe.probe === "reviewer") return canonical.submitReview(probe.call as Parameters<MemImportU2Service["submitReview"]>[0]);
  try {
    return await canonical.applyWorkerRepairBatchReceipt(probe.call as Parameters<MemImportU2Service["applyWorkerRepairBatchReceipt"]>[0]);
  } finally {
    if (releaseRepairLease) await releaseAcceptanceProbeLease(probe, canonical);
  }
}

test("tracked mem-import acceptance fixture validates hashes and excludes runtime authority", async () => {
  const fixture = await loadAcceptanceFixture(fixtureRoot);
  assert.equal(fixture.manifest.fixtureId, "tiny-glass-tower-v1");
  assert.deepEqual(fixture.manifest.supportedProbes, ["normalize", "extractor", "proposer", "reconciler", "merger", "reviewer", "repairer"]);
  assert.match(fixture.fixtureHash, /^[a-f0-9]{64}$/);
  assert.match(fixture.semanticStateHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify({ extraction: fixture.extraction, proposal: fixture.proposal, review: fixture.review, identity: fixture.identity, repair: fixture.repair, calls: fixture.calls, expected: fixture.expected }), /coordinatorGrant|outputRoot|hostTaskId|submittedAt/);
});

for (const probe of ["normalize", "extractor", "proposer", "reconciler", "merger", "reviewer", "repairer"] as const satisfies readonly AcceptanceProbe[]) {
  test(`acceptance ${probe} probe materializes independently and executes one production tool`, async () => {
    const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(probe), probe });
    assert.equal(prepared.targetTool, ({
      normalize: "mem_import_normalize",
      extractor: "mem_extraction_submit",
      proposer: "mem_proposal_submit",
      reconciler: "mem_identity_submit",
      merger: "mem_merge_commit",
      reviewer: "mem_review_submit",
      repairer: "mem_merge_apply_repair_batch",
    } as const)[probe]);
    if (probe === "normalize") assert.deepEqual(prepared.assignmentTools, ["mem_import_normalize"]);
    else {
      assert.deepEqual(prepared.assignmentTools, expectedRoleTools(probe));
      assert.equal(prepared.assignment?.role, probe);
    }
    const result = await executePrepared(prepared);
    if (probe === "normalize") assert.equal((result as { units: unknown[] }).units.length, prepared.expected.unitCount);
    else if (probe === "extractor") assert.equal((result as { candidateCount: number }).candidateCount, prepared.expected.candidateCount);
    else if (probe === "merger" || probe === "repairer") {
      assert.equal((result as { artifactCount: number }).artifactCount, 2);
      assert.equal((result as { candidateDispositionCount: number }).candidateDispositionCount, 2);
    } else assert.match((result as { contentHash: string }).contentHash, /^[a-f0-9]{64}$/);
  });
}

test("coordinator effect inventory discovers authoritative probe hashes without artifact paths", async () => {
  const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput("effect-inventory"), probe: "proposer" });
  const result = await executePrepared(prepared) as { contentHash: string };
  const base = new MemImportService();
  await base.recordWorkerDispatch({
    outputRoot: prepared.outputRoot,
    runId: prepared.runId,
    coordinatorGrant: prepared.coordinatorGrant,
    taskId: prepared.assignment!.taskId,
    facility: "ordinary-subagent",
    hostTaskId: "acceptance-proposer-host",
    requestedTools: prepared.assignmentTools,
    observedTools: prepared.assignmentTools,
    outcome: "completed",
  });
  const entries = [] as Awaited<ReturnType<MemImportService["effectInventory"]>>["entries"];
  let continuationCursor: string | undefined;
  do {
    const page = await base.effectInventory({ outputRoot: prepared.outputRoot, runId: prepared.runId, coordinatorGrant: prepared.coordinatorGrant, maxItems: 1, ...(continuationCursor ? { continuationCursor } : {}) });
    entries.push(...page.entries);
    continuationCursor = page.continuationCursor;
    assert.ok(JSON.stringify(page).length < 10_000);
  } while (continuationCursor);
  const target = entries.find((entry) => entry.taskId === prepared.assignment!.taskId && entry.effect?.kind === "proposal");
  assert.equal(target?.effect?.contentHash, result.contentHash);
  assert.equal(target?.dispatch?.outcome, "completed");
  assert.equal(target?.dispatch?.exactToolMatch, true);
  assert.equal("path" in (target?.effect ?? {}), false);
});

test("focused acceptance validates one assigned production call and persists a credential-free receipt", async () => {
  const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput("receipt"), probe: "proposer" });
  const launch = buildAssignmentBoundProbeLaunch(prepared, "provider/worker", "medium");
  assert.equal(launch.taskId, prepared.assignment!.taskId);
  assert.deepEqual(launch.tools, prepared.assignmentTools);
  assert.match(launch.task, /mem_proposal_submit exactly once/);
  await executePrepared(prepared);
  const base = new MemImportService();
  const hostTaskId = "acceptance-receipt-host";
  await base.recordWorkerDispatch({
    outputRoot: prepared.outputRoot,
    runId: prepared.runId,
    coordinatorGrant: prepared.coordinatorGrant,
    taskId: prepared.assignment!.taskId,
    facility: "ordinary-subagent",
    hostTaskId,
    requestedTools: launch.tools,
    observedTools: launch.tools,
    outcome: "completed",
    requestedModel: launch.model,
    observedModel: launch.model,
    requestedThinking: launch.thinking,
    observedThinking: launch.thinking,
  });
  const acceptance = new MemImportAcceptanceService(base, () => new Date("2026-07-21T00:00:00.000Z"));
  const evidence = { ...exactHostEvidence, facility: "ordinary-subagent" as const, hostTaskId, requestedTools: launch.tools, observedTools: launch.tools, toolCalls: [prepared.targetTool], outcome: "completed" as const, observedModel: launch.model, observedThinking: launch.thinking };
  await assert.rejects(acceptance.validateProbe(prepared, { ...evidence, toolCalls: [prepared.targetTool, prepared.targetTool] }), /exactly once/);
  await assert.rejects(acceptance.validateProbe(prepared, { ...evidence, toolProfileStatus: "unrestricted" }), /verified\/exact tool-profile evidence/);
  await assert.rejects(acceptance.validateProbe(prepared, { ...evidence, auxiliaryLaunchCount: 1 }), /forbids auxiliary or helper child launches/);
  await assert.rejects(acceptance.validateProbe(prepared, { ...evidence, evidenceSource: undefined }), /host-derived verified\/exact/);
  const stateRoot = join(await mkdtemp(join(tmpdir(), "memchat-acceptance-state-")), "acceptance");
  const persisted = await acceptance.persistProbe({
    stateRoot,
    profile: { protocolVersion: 1, toolSchemaVersion: "fixture-v1", adapter: "test-adapter", runtime: "node-test", model: launch.model, thinking: launch.thinking, sourceRevision: "test-revision" },
    prepared,
    evidence,
    requiredProbes: ["proposer"],
  });
  assert.equal(persisted.receipt.status, "accepted");
  assert.equal(persisted.receipt.probes.proposer?.effect?.kind, "proposal");
  assert.deepEqual(persisted.receipt.probes.proposer?.hostProfile, exactHostEvidence);
  assert.doesNotMatch(JSON.stringify(persisted.receipt), new RegExp(prepared.assignment!.grant));
  assert.doesNotMatch(JSON.stringify(persisted.receipt), new RegExp(prepared.coordinatorGrant));
});

test("focused acceptance receipt explicitly covers reconciler and repairer profiles", async () => {
  const stateRoot = join(await mkdtemp(join(tmpdir(), "memchat-acceptance-all-roles-")), "acceptance");
  const profile = { protocolVersion: 1, toolSchemaVersion: "fixture-v1", adapter: "test-adapter", runtime: "node-test", model: "provider/worker", thinking: "medium", sourceRevision: "test-revision" };
  const requiredProbes = ["normalize", "extractor", "proposer", "reconciler", "merger", "reviewer", "repairer"] as const satisfies readonly AcceptanceProbe[];
  let status: "accepted" | "partial" = "partial";
  for (const probe of requiredProbes) {
    const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(`receipt-${probe}`), probe });
    await executePrepared(prepared);
    const base = new MemImportService();
    const evidence = probe === "normalize"
      ? { facility: "coordinator-direct" as const, requestedTools: prepared.assignmentTools, observedTools: prepared.assignmentTools, toolCalls: [prepared.targetTool], outcome: "completed" as const }
      : { ...exactHostEvidence, facility: "ordinary-subagent" as const, hostTaskId: `acceptance-${probe}-host`, requestedTools: prepared.assignmentTools, observedTools: prepared.assignmentTools, toolCalls: [prepared.targetTool], outcome: "completed" as const, observedModel: profile.model, observedThinking: profile.thinking };
    if (probe !== "normalize") {
      await base.recordWorkerDispatch({
        outputRoot: prepared.outputRoot,
        runId: prepared.runId,
        coordinatorGrant: prepared.coordinatorGrant,
        taskId: prepared.assignment!.taskId,
        facility: "ordinary-subagent",
        hostTaskId: "hostTaskId" in evidence ? evidence.hostTaskId : "",
        requestedTools: prepared.assignmentTools,
        observedTools: prepared.assignmentTools,
        outcome: "completed",
      });
    }
    const persisted = await new MemImportAcceptanceService(base).persistProbe({ stateRoot, profile, prepared, evidence, requiredProbes: [...requiredProbes] });
    status = persisted.receipt.status;
    if (probe === "repairer") {
      assert.equal(persisted.receipt.probes.reconciler?.effect?.kind, "identity");
      assert.equal(persisted.receipt.probes.repairer?.effect?.kind, "repair");
    }
  }
  assert.equal(status, "accepted");
});

test("conditional acceptance rejects valid but fixture-divergent identity and repair effects", async () => {
  for (const probe of ["reconciler", "repairer"] as const) {
    const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(`altered-${probe}`), probe });
    if (probe === "reconciler") {
      const packet = prepared.call.packet as { decisions: Array<{ rationale: string }> };
      packet.decisions[0]!.rationale = "A different but structurally valid identity rationale.";
    } else {
      const batch = prepared.call.batch as { operations: Array<{ artifact: { description: string } }> };
      batch.operations[0]!.artifact.description = "A different but provenance-backed repair description.";
    }
    await executePrepared(prepared);
    const base = new MemImportService();
    const hostTaskId = `altered-${probe}-host`;
    await base.recordWorkerDispatch({
      outputRoot: prepared.outputRoot,
      runId: prepared.runId,
      coordinatorGrant: prepared.coordinatorGrant,
      taskId: prepared.assignment!.taskId,
      facility: "ordinary-subagent",
      hostTaskId,
      requestedTools: prepared.assignmentTools,
      observedTools: prepared.assignmentTools,
      outcome: "completed",
    });
    await assert.rejects(new MemImportAcceptanceService(base).validateProbe(prepared, {
      ...exactHostEvidence,
      facility: "ordinary-subagent",
      hostTaskId,
      requestedTools: prepared.assignmentTools,
      observedTools: prepared.assignmentTools,
      toolCalls: [prepared.targetTool],
      outcome: "completed",
    }), /does not match the tracked fixture expectation/);
  }
});

test("focused acceptance runner derives launch scope and persists all role receipts through a host adapter", async () => {
  const host: AssignmentBoundAcceptanceHost = {
    adapter: "test-assignment-bound-host",
    runtime: "node-test",
    async launch(prepared, options) {
      await executePrepared(prepared, false);
      return {
        ...exactHostEvidence,
        facility: "ordinary-subagent",
        hostTaskId: `runner-${prepared.probe}`,
        requestedTools: prepared.assignmentTools,
        observedTools: prepared.assignmentTools,
        toolCalls: [prepared.targetTool],
        outcome: "completed",
        observedModel: options.model,
        observedThinking: options.thinking,
      };
    },
  };
  const result = await runFocusedAcceptance({
    fixtureRoot,
    stateRoot: join(await mkdtemp(join(tmpdir(), "memchat-runner-state-")), "acceptance"),
    disposableRoot: join(await mkdtemp(join(tmpdir(), "memchat-runner-work-")), "probes"),
    profile: { protocolVersion: 1, toolSchemaVersion: "fixture-v1", model: "provider/worker", thinking: "medium", sourceRevision: "test-revision" },
    host,
    probes: [...ALL_ACCEPTANCE_PROBES],
  });
  assert.equal(result.receipt.status, "accepted");
  assert.deepEqual(result.probes.map((item) => item.probe), [...ALL_ACCEPTANCE_PROBES]);
  assert.equal(result.receipt.probes.reconciler?.effect?.kind, "identity");
  assert.equal(result.receipt.probes.repairer?.effect?.kind, "repair");
  assert.doesNotMatch(JSON.stringify(result.receipt), /coordinatorGrant|\"grant\"/);
});

test("focused acceptance runner rejects host-observed tool broadening", async () => {
  const host: AssignmentBoundAcceptanceHost = {
    adapter: "broadened-test-host",
    runtime: "node-test",
    async launch(prepared, options) {
      await executePrepared(prepared, false);
      return {
        ...exactHostEvidence,
        facility: "ordinary-subagent",
        hostTaskId: "broadened-host",
        requestedTools: prepared.assignmentTools,
        observedTools: [...prepared.assignmentTools, "bash"],
        toolCalls: [prepared.targetTool],
        outcome: "completed",
        observedModel: options.model,
        observedThinking: options.thinking,
      };
    },
  };
  await assert.rejects(runFocusedAcceptance({
    fixtureRoot,
    stateRoot: join(await mkdtemp(join(tmpdir(), "memchat-runner-reject-state-")), "acceptance"),
    disposableRoot: join(await mkdtemp(join(tmpdir(), "memchat-runner-reject-work-")), "probes"),
    profile: { protocolVersion: 1, toolSchemaVersion: "fixture-v1", model: "provider/worker", thinking: "medium", sourceRevision: "test-revision" },
    host,
    probes: ["extractor"],
  }), /allowlist does not exactly match/);
});

test("acceptance source revision fingerprints untracked file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "memchat-acceptance-revision-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  await writeFile(join(root, "tracked.txt"), "tracked\n", "utf8");
  git("add", "tracked.txt");
  git("-c", "user.name=Memchat Test", "-c", "user.email=memchat@example.invalid", "commit", "-qm", "fixture");
  const clean = await acceptanceSourceRevision(root);
  assert.doesNotMatch(clean, /\+dirty-/);
  await writeFile(join(root, "untracked.txt"), "first\n", "utf8");
  const first = await acceptanceSourceRevision(root);
  assert.match(first, /\+dirty-[a-f0-9]{16}$/);
  await writeFile(join(root, "untracked.txt"), "second\n", "utf8");
  const second = await acceptanceSourceRevision(root);
  assert.notEqual(second, first);
});

test("focused acceptance runner rejects host model or thinking clamping", async () => {
  const host: AssignmentBoundAcceptanceHost = {
    adapter: "clamped-test-host",
    runtime: "node-test",
    async launch(prepared, options) {
      await executePrepared(prepared, false);
      return {
        ...exactHostEvidence,
        facility: "ordinary-subagent",
        hostTaskId: "clamped-host",
        requestedTools: prepared.assignmentTools,
        observedTools: prepared.assignmentTools,
        toolCalls: [prepared.targetTool],
        outcome: "completed",
        observedModel: options.model,
        observedThinking: "off",
      };
    },
  };
  await assert.rejects(runFocusedAcceptance({
    fixtureRoot,
    stateRoot: join(await mkdtemp(join(tmpdir(), "memchat-runner-clamp-state-")), "acceptance"),
    disposableRoot: join(await mkdtemp(join(tmpdir(), "memchat-runner-clamp-work-")), "probes"),
    profile: { protocolVersion: 1, toolSchemaVersion: "fixture-v1", model: "provider/worker", thinking: "high", sourceRevision: "test-revision" },
    host,
    probes: ["extractor"],
  }), /observed thinking off, expected high/);
});

test("acceptance fixture materialization is semantically stable across fresh run roots", async () => {
  for (const probe of ["normalize", "extractor", "proposer", "reconciler", "merger", "reviewer", "repairer"] as const satisfies readonly AcceptanceProbe[]) {
    const first = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(`${probe}-first`), probe });
    const second = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(`${probe}-second`), probe });
    assert.equal(first.fixtureHash, second.fixtureHash);
    assert.equal(first.semanticStateHash, second.semanticStateHash);
    assert.deepEqual(redactRuntime(first.call), redactRuntime(second.call));
  }
});
