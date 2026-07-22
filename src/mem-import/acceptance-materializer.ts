import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { MemImportIdentityService, canonicalHash } from "./identity-service.js";
import { MemImportProposalService } from "./proposal-service.js";
import { MEM_IMPORT_ROLE_TOOLS, MemImportService, type AssignmentRole } from "./service.js";
import { MemImportU2Service, type ReviewPacket } from "./u2-service.js";
import type { SourceManifestEntry, StageEnvelope, WorldImportGroup } from "../world-import/types.js";

export type AcceptanceProbe = "normalize" | AssignmentRole;

type FixtureManifest = {
  version: 1;
  kind: "mem-import-acceptance-fixture";
  fixtureId: string;
  protocolVersion: number;
  supportedProbes: AcceptanceProbe[];
  files: Record<string, string>;
  forbiddenRuntimeFields: string[];
};

type ExtractionSemantic = {
  version: 1;
  candidates: Array<{
    id: string;
    group: WorldImportGroup;
    title: string;
    startBlock: number;
    endBlock: number;
    payload?: unknown;
  }>;
};

type ProposalSemantic = {
  version: 1;
  artifacts: Array<{
    id: string;
    group: WorldImportGroup;
    type?: string;
    title: string;
    description: string;
    tags?: string[];
    sections: Array<{ heading: string; body: string }>;
    candidateIds: string[];
    startBlock: number;
    endBlock: number;
  }>;
  rationale: string;
};

type ReviewSemantic = {
  version: 1;
  checkpointId: string;
  findings: Array<Record<string, unknown>>;
  requestedActions: Array<Record<string, unknown>>;
  rationale: string;
};

type IdentitySemantic = {
  version: 1;
  id: string;
  decisions: Array<Record<string, unknown>>;
  rationale: string;
};

type RepairSemantic = {
  version: 1;
  checkpointId: string;
  actionId: string;
  finding: ReviewPacket["findings"][number];
  action: ReviewPacket["requestedActions"][number];
  artifactId: string;
  description: string;
  section: { heading: string; body: string };
  rationale: string;
};

type CallsFixture = {
  version: 1;
  targets: Record<AcceptanceProbe, string>;
  singleCall: true;
};

export type AcceptanceEffectExpectation = Record<string, unknown>;

export type PreparedAcceptanceProbe = {
  probe: AcceptanceProbe;
  fixtureId: string;
  fixtureHash: string;
  semanticStateHash: string;
  outputRoot: string;
  runId: string;
  coordinatorGrant: string;
  targetTool: string;
  assignmentTools: string[];
  call: Record<string, unknown>;
  expected: AcceptanceEffectExpectation;
  assignment?: {
    taskId: string;
    role: Exclude<AcceptanceProbe, "normalize">;
    grant: string;
  };
  workerLease?: { fence: number };
};

type LoadedFixture = {
  manifest: FixtureManifest;
  fixtureHash: string;
  semanticStateHash: string;
  inputRoot: string;
  extraction: ExtractionSemantic;
  proposal: ProposalSemantic;
  review: ReviewSemantic;
  identity: IdentitySemantic;
  repair: RepairSemantic;
  calls: CallsFixture;
  expected: Record<AcceptanceProbe, AcceptanceEffectExpectation>;
};

type MaterializerServices = {
  base?: MemImportService;
  proposals?: MemImportProposalService;
  identities?: MemImportIdentityService;
  canonical?: MemImportU2Service;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertFixturePath(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || normalize(relativePath).startsWith("..")) throw new Error(`Invalid acceptance fixture path ${relativePath}`);
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}/`)) throw new Error(`Acceptance fixture path escapes its root: ${relativePath}`);
  return path;
}

function findForbiddenField(value: unknown, forbidden: Set<string>, path = "$fixture"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], forbidden, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key)) return `${path}.${key}`;
    const found = findForbiddenField(item, forbidden, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

export async function loadAcceptanceFixture(fixtureRootInput: string): Promise<LoadedFixture> {
  const fixtureRoot = resolve(fixtureRootInput);
  const manifestPath = join(fixtureRoot, "fixture.json");
  const manifestText = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestText) as FixtureManifest;
  if (!isRecord(manifest) || manifest.version !== 1 || manifest.kind !== "mem-import-acceptance-fixture" || typeof manifest.fixtureId !== "string" || !Array.isArray(manifest.supportedProbes) || !isRecord(manifest.files) || !Array.isArray(manifest.forbiddenRuntimeFields)) throw new Error("Invalid mem-import acceptance fixture manifest");
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`Invalid fixture hash for ${relativePath}`);
    const actualHash = sha256(await readFile(assertFixturePath(fixtureRoot, relativePath)));
    if (actualHash !== expectedHash) throw new Error(`Acceptance fixture hash mismatch for ${relativePath}`);
  }
  const [extraction, proposal, review, identity, repair, calls, expected] = await Promise.all([
    readJson<ExtractionSemantic>(join(fixtureRoot, "semantic", "extraction.json")),
    readJson<ProposalSemantic>(join(fixtureRoot, "semantic", "proposal.json")),
    readJson<ReviewSemantic>(join(fixtureRoot, "semantic", "review.json")),
    readJson<IdentitySemantic>(join(fixtureRoot, "semantic", "identity.json")),
    readJson<RepairSemantic>(join(fixtureRoot, "semantic", "repair.json")),
    readJson<CallsFixture>(join(fixtureRoot, "calls.json")),
    readJson<Record<AcceptanceProbe, AcceptanceEffectExpectation>>(join(fixtureRoot, "expected-effects.json")),
  ]);
  const semantic = { extraction, proposal, review, identity, repair, calls, expected };
  const forbidden = findForbiddenField(semantic, new Set(manifest.forbiddenRuntimeFields));
  if (forbidden) throw new Error(`Acceptance fixture contains forbidden runtime field ${forbidden}`);
  if (calls.version !== 1 || calls.singleCall !== true) throw new Error("Acceptance fixture calls must require one production-tool call");
  for (const probe of manifest.supportedProbes) if (!calls.targets[probe] || !expected[probe]) throw new Error(`Acceptance fixture is missing call or expectation for ${probe}`);
  return {
    manifest,
    fixtureHash: sha256(manifestText),
    semanticStateHash: canonicalHash(semantic),
    inputRoot: join(fixtureRoot, "input"),
    extraction,
    proposal,
    review,
    identity,
    repair,
    calls,
    expected,
  };
}

function anchorsFor(unit: SourceManifestEntry, startBlock: number, endBlock: number): { startAnchor: string; endAnchor: string } {
  if (!Number.isInteger(startBlock) || !Number.isInteger(endBlock) || startBlock < 0 || endBlock < startBlock || endBlock >= unit.anchors.length) throw new Error(`Acceptance fixture block range ${startBlock}-${endBlock} is outside normalized unit ${unit.unitId}`);
  return { startAnchor: unit.anchors[startBlock]!, endAnchor: unit.anchors[endBlock]! };
}

type ExtractionToolStage = {
  version: 1;
  kind: "extraction";
  unitId: string;
  sourceId: string;
  candidates: Array<Record<string, unknown>>;
};

type ProposalToolBody = {
  artifacts: Array<Record<string, unknown> & { id: string }>;
  candidateDispositions: Array<{ unitId: string; candidateId: string; disposition: "represented"; artifactId: string }>;
  rationale: string;
};

function extractionStage(fixture: LoadedFixture, unit: SourceManifestEntry): ExtractionToolStage {
  return {
    version: 1,
    kind: "extraction",
    unitId: unit.unitId,
    sourceId: unit.sourceId,
    candidates: fixture.extraction.candidates.map((candidate) => ({
      id: candidate.id,
      group: candidate.group,
      title: candidate.title,
      provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, ...anchorsFor(unit, candidate.startBlock, candidate.endBlock) }],
      ...(candidate.payload === undefined ? {} : { payload: structuredClone(candidate.payload) }),
    })),
  };
}

function proposalBody(fixture: LoadedFixture, unit: SourceManifestEntry): ProposalToolBody {
  const artifacts = fixture.proposal.artifacts.map((artifact) => ({
    id: artifact.id,
    group: artifact.group,
    ...(artifact.type ? { type: artifact.type } : {}),
    title: artifact.title,
    description: artifact.description,
    ...(artifact.tags?.length ? { tags: [...artifact.tags] } : {}),
    sections: structuredClone(artifact.sections),
    provenance: [{ sourceId: unit.sourceId, unitId: unit.unitId, ...anchorsFor(unit, artifact.startBlock, artifact.endBlock) }],
    metadata: { representedCandidateIds: artifact.candidateIds.map((candidateId) => `${unit.unitId}:${candidateId}`) },
  }));
  const candidateDispositions = fixture.proposal.artifacts.flatMap((artifact) => artifact.candidateIds.map((candidateId) => ({ unitId: unit.unitId, candidateId, disposition: "represented" as const, artifactId: artifact.id })));
  return { artifacts, candidateDispositions, rationale: fixture.proposal.rationale };
}

export async function materializeAcceptanceProbe(options: {
  fixtureRoot: string;
  outputRoot: string;
  probe: AcceptanceProbe;
  services?: MaterializerServices;
}): Promise<PreparedAcceptanceProbe> {
  const fixture = await loadAcceptanceFixture(options.fixtureRoot);
  if (!fixture.manifest.supportedProbes.includes(options.probe)) throw new Error(`Acceptance fixture does not support probe ${options.probe}`);
  const base = options.services?.base ?? new MemImportService();
  const proposals = options.services?.proposals ?? new MemImportProposalService(base);
  const identities = options.services?.identities ?? new MemImportIdentityService(base);
  const canonical = options.services?.canonical ?? new MemImportU2Service(base);
  const run = await base.begin(options.outputRoot);
  const common = {
    probe: options.probe,
    fixtureId: fixture.manifest.fixtureId,
    fixtureHash: fixture.fixtureHash,
    semanticStateHash: fixture.semanticStateHash,
    outputRoot: run.outputRoot,
    runId: run.runId,
    coordinatorGrant: run.coordinatorGrant,
    targetTool: fixture.calls.targets[options.probe],
    expected: fixture.expected[options.probe],
  };
  if (options.probe === "normalize") {
    return { ...common, assignmentTools: [fixture.calls.targets.normalize], call: { ...run, input: fixture.inputRoot } };
  }

  const manifest = await base.normalize({ ...run, input: fixture.inputRoot });
  if (manifest.units.length !== 1) throw new Error(`Acceptance fixture expected one normalized unit, received ${manifest.units.length}`);
  const unit = manifest.units[0]!;
  const stage = extractionStage(fixture, unit);

  if (options.probe === "extractor") {
    const assignment = await base.assignExtractor({ ...run, taskId: "acceptance-extractor", unitIds: [unit.unitId] });
    return {
      ...common,
      assignmentTools: assignment.tools,
      assignment: { taskId: assignment.taskId, role: "extractor", grant: assignment.grant },
      call: { outputRoot: assignment.outputRoot, runId: assignment.runId, taskId: assignment.taskId, grant: assignment.grant, unitId: unit.unitId, stage },
    };
  }

  const seedExtractor = await base.assignExtractor({ ...run, taskId: "seed-extractor", unitIds: [unit.unitId] });
  await base.submitExtraction({ ...seedExtractor, unitId: unit.unitId, stage: stage as unknown as StageEnvelope });
  const body = proposalBody(fixture, unit);

  if (options.probe === "proposer") {
    const assignment = await base.assignWorker({ ...run, taskId: "acceptance-proposer", role: "proposer", unitIds: [unit.unitId] });
    return {
      ...common,
      assignmentTools: assignment.tools,
      assignment: { taskId: assignment.taskId, role: "proposer", grant: assignment.grant },
      call: { outputRoot: assignment.outputRoot, runId: assignment.runId, taskId: assignment.taskId, grant: assignment.grant, ...body },
    };
  }

  const seedProposer = await base.assignWorker({ ...run, taskId: "seed-proposer", role: "proposer", unitIds: [unit.unitId] });
  const proposal = await proposals.submitWorkerProposalBody({ ...seedProposer, ...body });

  if (options.probe === "merger") {
    const assignment = await base.assignWorker({ ...run, taskId: "acceptance-merger", role: "merger", proposalHashes: [proposal.contentHash] });
    return {
      ...common,
      assignmentTools: assignment.tools,
      assignment: { taskId: assignment.taskId, role: "merger", grant: assignment.grant },
      call: {
        outputRoot: assignment.outputRoot,
        runId: assignment.runId,
        taskId: assignment.taskId,
        grant: assignment.grant,
        proposalHashes: [proposal.contentHash],
        readSet: body.artifacts.map((artifact) => ({ artifactId: artifact.id, contentHash: null })),
        changes: body.artifacts.map((artifact) => ({ kind: "accept", proposalHash: proposal.contentHash, artifactId: artifact.id })),
        rationale: "Accept the tracked fixture proposal by immutable reference.",
      },
    };
  }

  const seedMerger = await base.assignWorker({ ...run, taskId: "seed-merger", role: "merger", proposalHashes: [proposal.contentHash] });
  const merged = await canonical.commitWorkerBatch({
    ...seedMerger,
    proposalHashes: [proposal.contentHash],
    readSet: body.artifacts.map((artifact) => ({ artifactId: artifact.id, contentHash: null })),
    changes: body.artifacts.map((artifact) => ({ kind: "accept" as const, proposalHash: proposal.contentHash, artifactId: artifact.id })),
    rationale: "Seed the tracked canonical fixture for an independent downstream probe.",
  });

  if (options.probe === "reconciler") {
    const assignment = await base.assignWorker({ ...run, taskId: "acceptance-reconciler", role: "reconciler", proposalHashes: [proposal.contentHash] });
    return {
      ...common,
      assignmentTools: assignment.tools,
      assignment: { taskId: assignment.taskId, role: "reconciler", grant: assignment.grant },
      call: {
        outputRoot: assignment.outputRoot,
        runId: assignment.runId,
        taskId: assignment.taskId,
        grant: assignment.grant,
        packet: {
          version: 1,
          kind: "mem-import-identity",
          id: fixture.identity.id,
          proposalHashes: [proposal.contentHash],
          baselineRevision: merged.revision,
          baselineContentHash: merged.contentHash,
          decisions: structuredClone(fixture.identity.decisions),
          rationale: fixture.identity.rationale,
          metadata: { fixtureId: fixture.manifest.fixtureId },
        },
      },
    };
  }

  if (options.probe === "reviewer") {
    const assignment = await base.assignWorker({ ...run, taskId: "acceptance-reviewer", role: "reviewer" });
    return {
      ...common,
      assignmentTools: assignment.tools,
      assignment: { taskId: assignment.taskId, role: "reviewer", grant: assignment.grant },
      call: {
        outputRoot: assignment.outputRoot,
        runId: assignment.runId,
        taskId: assignment.taskId,
        grant: assignment.grant,
        packet: {
          version: 1,
          kind: "mem-import-review",
          checkpointId: fixture.review.checkpointId,
          reviewedMergeRevision: merged.revision,
          reviewedMergeHash: merged.contentHash,
          findings: structuredClone(fixture.review.findings),
          requestedActions: structuredClone(fixture.review.requestedActions),
          readSet: (merged.stage.artifacts ?? []).map((artifact) => ({ artifactId: artifact.id, contentHash: canonicalHash(artifact) })),
          metadata: { fixtureId: fixture.manifest.fixtureId, rationale: fixture.review.rationale },
        },
      },
    };
  }

  const reviewAssignment = await base.assignWorker({ ...run, taskId: "seed-repair-reviewer", role: "reviewer" });
  await canonical.submitReview({
    ...reviewAssignment,
    packet: {
      version: 1,
      kind: "mem-import-review",
      checkpointId: fixture.repair.checkpointId,
      reviewedMergeRevision: merged.revision,
      reviewedMergeHash: merged.contentHash!,
      findings: [structuredClone(fixture.repair.finding)],
      requestedActions: [structuredClone(fixture.repair.action)],
      readSet: (merged.stage.artifacts ?? []).map((artifact) => ({ artifactId: artifact.id, contentHash: canonicalHash(artifact) })),
      metadata: { fixtureId: fixture.manifest.fixtureId },
    },
  });
  const assignment = await base.assignWorker({ ...run, taskId: "acceptance-repairer", role: "repairer", checkpointIds: [fixture.repair.checkpointId], actionIds: [fixture.repair.actionId] });
  const lease = await canonical.acquireWorkerLease(assignment);
  const artifact = (merged.stage.artifacts ?? []).find((item) => item.id === fixture.repair.artifactId);
  if (!artifact) throw new Error(`Acceptance repair fixture artifact ${fixture.repair.artifactId} is absent from canonical state`);
  const repairedArtifact = {
    ...structuredClone(artifact),
    description: fixture.repair.description,
    sections: [structuredClone(fixture.repair.section)],
    provenance: artifact.provenance.map(({ quote: _quote, ...ref }) => ref),
  };
  return {
    ...common,
    assignmentTools: assignment.tools,
    assignment: { taskId: assignment.taskId, role: "repairer", grant: assignment.grant },
    workerLease: { fence: lease.fence },
    call: {
      outputRoot: assignment.outputRoot,
      runId: assignment.runId,
      taskId: assignment.taskId,
      grant: assignment.grant,
      fence: lease.fence,
      expectedRevision: merged.revision,
      expectedContentHash: merged.contentHash,
      checkpointId: fixture.repair.checkpointId,
      actionIds: [fixture.repair.actionId],
      batch: {
        proposalHashes: [proposal.contentHash],
        readSet: [{ artifactId: artifact.id, contentHash: canonicalHash(artifact) }],
        operations: [{ kind: "upsert", artifact: repairedArtifact }],
        rationale: fixture.repair.rationale,
      },
    },
  };
}

export async function releaseAcceptanceProbeLease(prepared: PreparedAcceptanceProbe, canonical = new MemImportU2Service()): Promise<void> {
  if (!prepared.workerLease || !prepared.assignment) return;
  await canonical.releaseWorkerLease({
    outputRoot: prepared.outputRoot,
    runId: prepared.runId,
    taskId: prepared.assignment.taskId,
    grant: prepared.assignment.grant,
    fence: prepared.workerLease.fence,
  });
}

export function expectedRoleTools(probe: Exclude<AcceptanceProbe, "normalize">): string[] {
  return [...MEM_IMPORT_ROLE_TOOLS[probe]];
}
