import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  expectedRoleTools,
  loadAcceptanceFixture,
  materializeAcceptanceProbe,
  type AcceptanceProbe,
  type PreparedAcceptanceProbe,
} from "./mem-import/acceptance-materializer.js";
import { MemImportAcceptanceService, buildAssignmentBoundProbeLaunch } from "./mem-import/acceptance-service.js";
import { MemImportProposalService } from "./mem-import/proposal-service.js";
import { MemImportService } from "./mem-import/service.js";
import { MemImportU2Service } from "./mem-import/u2-service.js";

const fixtureRoot = resolve("fixtures/mem-import/acceptance/v1");

async function tempOutput(label: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), `memchat-acceptance-${label}-`)), "output");
}

function redactRuntime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRuntime);
  if (!value || typeof value !== "object") return value;
  const omitted = new Set(["outputRoot", "runId", "taskId", "grant", "coordinatorGrant"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !omitted.has(key)).map(([key, item]) => [key, redactRuntime(item)]));
}

async function executePrepared(probe: PreparedAcceptanceProbe): Promise<unknown> {
  const base = new MemImportService();
  const proposals = new MemImportProposalService(base);
  const canonical = new MemImportU2Service(base);
  if (probe.probe === "normalize") return base.normalize(probe.call as Parameters<MemImportService["normalize"]>[0]);
  if (probe.probe === "extractor") return base.submitExtraction(probe.call as Parameters<MemImportService["submitExtraction"]>[0]);
  if (probe.probe === "proposer") return proposals.submitWorkerProposalBody(probe.call as Parameters<MemImportProposalService["submitWorkerProposalBody"]>[0]);
  if (probe.probe === "merger") return canonical.commitWorkerBatchReceipt(probe.call as Parameters<MemImportU2Service["commitWorkerBatchReceipt"]>[0]);
  return canonical.submitReview(probe.call as Parameters<MemImportU2Service["submitReview"]>[0]);
}

test("tracked mem-import acceptance fixture validates hashes and excludes runtime authority", async () => {
  const fixture = await loadAcceptanceFixture(fixtureRoot);
  assert.equal(fixture.manifest.fixtureId, "tiny-glass-tower-v1");
  assert.deepEqual(fixture.manifest.supportedProbes, ["normalize", "extractor", "proposer", "merger", "reviewer"]);
  assert.match(fixture.fixtureHash, /^[a-f0-9]{64}$/);
  assert.match(fixture.semanticStateHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify({ extraction: fixture.extraction, proposal: fixture.proposal, review: fixture.review, calls: fixture.calls, expected: fixture.expected }), /coordinatorGrant|outputRoot|hostTaskId|submittedAt/);
});

for (const probe of ["normalize", "extractor", "proposer", "merger", "reviewer"] as const satisfies readonly AcceptanceProbe[]) {
  test(`acceptance ${probe} probe materializes independently and executes one production tool`, async () => {
    const prepared = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(probe), probe });
    assert.equal(prepared.targetTool, ({
      normalize: "mem_import_normalize",
      extractor: "mem_extraction_submit",
      proposer: "mem_proposal_submit",
      merger: "mem_merge_commit",
      reviewer: "mem_review_submit",
    } as const)[probe]);
    if (probe === "normalize") assert.deepEqual(prepared.assignmentTools, ["mem_import_normalize"]);
    else {
      assert.deepEqual(prepared.assignmentTools, expectedRoleTools(probe));
      assert.equal(prepared.assignment?.role, probe);
    }
    const result = await executePrepared(prepared);
    if (probe === "normalize") assert.equal((result as { units: unknown[] }).units.length, prepared.expected.unitCount);
    else if (probe === "extractor") assert.equal((result as { candidateCount: number }).candidateCount, prepared.expected.candidateCount);
    else if (probe === "merger") {
      assert.equal((result as { artifactCount: number }).artifactCount, 2);
      assert.equal((result as { candidateDispositionCount: number }).candidateDispositionCount, prepared.expected.candidateDispositionCount);
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
  const evidence = { facility: "ordinary-subagent" as const, hostTaskId, requestedTools: launch.tools, observedTools: launch.tools, toolCalls: [prepared.targetTool], outcome: "completed" as const };
  await assert.rejects(acceptance.validateProbe(prepared, { ...evidence, toolCalls: [prepared.targetTool, prepared.targetTool] }), /exactly once/);
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
  assert.doesNotMatch(JSON.stringify(persisted.receipt), new RegExp(prepared.assignment!.grant));
  assert.doesNotMatch(JSON.stringify(persisted.receipt), new RegExp(prepared.coordinatorGrant));
});

test("acceptance fixture materialization is semantically stable across fresh run roots", async () => {
  for (const probe of ["normalize", "extractor", "proposer", "merger", "reviewer"] as const satisfies readonly AcceptanceProbe[]) {
    const first = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(`${probe}-first`), probe });
    const second = await materializeAcceptanceProbe({ fixtureRoot, outputRoot: await tempOutput(`${probe}-second`), probe });
    assert.equal(first.fixtureHash, second.fixtureHash);
    assert.equal(first.semanticStateHash, second.semanticStateHash);
    assert.deepEqual(redactRuntime(first.call), redactRuntime(second.call));
  }
});
