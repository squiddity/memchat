import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { validateUsageEvidence, type MemImportUsageEvidence } from "./usage-telemetry.js";

export const PI_HERDR_USAGE_ADAPTER = "pi-herdr-subagents";

export type MemImportUsageResolutionRequest = {
  key: string;
  hostTaskId: string;
  hostSessionId?: string;
};

export type MemImportUsageResolution = {
  adapter: typeof PI_HERDR_USAGE_ADAPTER;
  hostChildId?: string;
  hostScopeId?: string;
  activitySequence?: number;
  activityUpdatedAt?: string;
  evidence: MemImportUsageEvidence;
};

export interface MemImportUsageResolver {
  readonly adapter: string;
  resolve(requests: MemImportUsageResolutionRequest[]): Promise<Map<string, MemImportUsageResolution>>;
}

type ActivityDirectory = { workspace: string; path: string };

type ActivityCandidate = {
  hostChildId: string;
  createdAt: number;
  sequence: number;
  updatedAt: number;
  evidence: MemImportUsageEvidence;
};

const CHILD_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MAX_ACTIVITY_SIDECAR_BYTES = 256 * 1024;
const SHORT_CHILD_ID = /(?:^|_)([a-f0-9]{8})(?:-|$)/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Extract the adapter's short running-child identity from an opaque launch/session identifier. */
export function piHerdrChildId(hostTaskId: string): string | undefined {
  if (UUID.test(hostTaskId)) return undefined;
  if (CHILD_ID.test(hostTaskId) && /^[a-f0-9]{8}$/i.test(hostTaskId)) return hostTaskId.toLowerCase();
  return SHORT_CHILD_ID.exec(hostTaskId)?.[1]?.toLowerCase();
}

function unavailable(reason: "sidecar-missing" | "sidecar-invalid" | "sidecar-stale" | "sidecar-unmatched"): MemImportUsageEvidence {
  return { version: 1, status: "unavailable", reason };
}

function parseActivitySidecar(value: unknown, expectedChildId: string): ActivityCandidate | undefined {
  const raw = object(value);
  if (!raw || raw.version !== 1 || raw.runningChildId !== expectedChildId) return undefined;
  if (!Number.isSafeInteger(raw.createdAt) || Number(raw.createdAt) < 0 || Number(raw.createdAt) > 8_640_000_000_000_000
    || !Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 0
    || !Number.isSafeInteger(raw.updatedAt) || Number(raw.updatedAt) < Number(raw.createdAt) || Number(raw.updatedAt) > 8_640_000_000_000_000) return undefined;
  if (raw.phase !== "done" || raw.agentActive !== false || raw.turnActive !== false || raw.providerActive !== false || raw.toolActive !== false) return undefined;
  try {
    const evidence = validateUsageEvidence({
      version: 1,
      status: "available",
      source: "pi-herdr-activity-sidecar",
      usage: raw.usage,
      usageByModel: raw.usageByModel,
    });
    return { hostChildId: expectedChildId, createdAt: Number(raw.createdAt), sequence: Number(raw.sequence), updatedAt: Number(raw.updatedAt), evidence };
  } catch {
    return undefined;
  }
}

async function directoryEntries(path: string) {
  try { return await readdir(path, { withFileTypes: true }); } catch { return []; }
}

async function activityDirectories(sessionsRoot: string): Promise<ActivityDirectory[]> {
  if (!existsSync(sessionsRoot)) return [];
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(sessionsRoot); } catch { return []; }
  const directories: ActivityDirectory[] = [];
  const directArtifacts = join(sessionsRoot, "artifacts");
  const workspaces = existsSync(directArtifacts)
    ? [{ path: sessionsRoot }]
    : (await directoryEntries(sessionsRoot)).filter((entry) => entry.isDirectory()).map((entry) => ({ path: join(sessionsRoot, entry.name) }));
  for (const workspace of workspaces) {
    const artifacts = join(workspace.path, "artifacts");
    for (const session of await directoryEntries(artifacts)) {
      if (!session.isDirectory()) continue;
      const activity = join(artifacts, session.name, "subagent-activity");
      if (!existsSync(activity)) continue;
      try {
        const canonicalActivity = await realpath(activity);
        if (canonicalActivity === resolve(activity) && (canonicalActivity === canonicalRoot || canonicalActivity.startsWith(`${canonicalRoot}${sep}`))) directories.push({ workspace: workspace.path, path: canonicalActivity });
      } catch {
        // Cleanup races and symlinked traversal are treated as unavailable.
      }
    }
  }
  return directories;
}

function sessionStartMs(name: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(name);
  if (!match) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), Number(match[7]));
}

/** Accept old persisted values that included the session file extension. */
function sessionStem(hostSessionId: string): string {
  return hostSessionId.endsWith(".jsonl") ? hostSessionId.slice(0, -".jsonl".length) : hostSessionId;
}

async function workspaceHostTimes(workspace: string, hostTaskId: string, childId: string): Promise<number[]> {
  const times: number[] = [];
  for (const entry of await directoryEntries(workspace)) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const base = entry.name.slice(0, -6);
    if (base !== hostTaskId && !base.endsWith(`_${hostTaskId}`) && !(hostTaskId === childId && base.includes(`_${childId}-`))) continue;
    const startedAt = sessionStartMs(entry.name);
    if (startedAt !== undefined) times.push(startedAt);
  }
  return times;
}

async function readActivityJson(directory: string, name: string): Promise<unknown> {
  const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const handle = await open(`/proc/self/fd/${directoryHandle.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_ACTIVITY_SIDECAR_BYTES) throw new Error("Invalid activity sidecar file");
      return JSON.parse(await handle.readFile("utf-8"));
    } finally {
      await handle.close();
    }
  } finally {
    await directoryHandle.close();
  }
}

/**
 * Resolve only content-free Pi/Herdr activity sidecars. This intentionally never
 * opens session JSONL, prompt, response, profile, grant, or credential files.
 */
export class PiHerdrUsageResolver implements MemImportUsageResolver {
  readonly adapter = PI_HERDR_USAGE_ADAPTER;

  constructor(
    private readonly sessionsRoot = process.env.MEM_IMPORT_PI_HERDR_SESSIONS_ROOT?.trim()
      || join(homedir(), ".pi", "agent", "sessions", `--${process.cwd().replace(/^\/+/, "").replaceAll("/", "-")}--`),
  ) {}

  async resolve(requests: MemImportUsageResolutionRequest[]): Promise<Map<string, MemImportUsageResolution>> {
    const resolved = new Map<string, MemImportUsageResolution>();
    const directories = await activityDirectories(this.sessionsRoot);
    for (const request of requests) {
      const childId = piHerdrChildId(request.hostTaskId);
      if (!childId) {
        resolved.set(request.key, { adapter: PI_HERDR_USAGE_ADAPTER, evidence: unavailable("sidecar-unmatched") });
        continue;
      }
      const sessionId = sessionStem(request.hostSessionId ?? request.hostTaskId);
      const matchedWorkspaces: string[] = [];
      for (const workspace of [...new Set(directories.map((item) => item.workspace))]) {
        if ((await workspaceHostTimes(workspace, sessionId, childId)).length > 0) matchedWorkspaces.push(workspace);
      }
      if (matchedWorkspaces.length !== 1) {
        resolved.set(request.key, { adapter: PI_HERDR_USAGE_ADAPTER, hostChildId: childId, evidence: unavailable("sidecar-unmatched") });
        continue;
      }
      const workspace = matchedWorkspaces[0]!;
      let found = false;
      let invalid = false;
      let stale = false;
      let latest: ActivityCandidate | undefined;
      for (const directory of directories.filter((item) => item.workspace === workspace)) {
        const name = `${childId}.json`;
        if (!existsSync(join(directory.path, name))) continue;
        found = true;
        try {
          const raw = await readActivityJson(directory.path, name);
          const parsed = parseActivitySidecar(raw, childId);
          if (!parsed) {
            const envelope = object(raw);
            if (envelope?.version === 1 && envelope.runningChildId === childId && envelope.phase !== "done") stale = true;
            else invalid = true;
            continue;
          }
          if (!latest || parsed.updatedAt > latest.updatedAt || (parsed.updatedAt === latest.updatedAt && parsed.sequence > latest.sequence)) latest = parsed;
        } catch {
          invalid = true;
        }
      }
      const base = {
        adapter: PI_HERDR_USAGE_ADAPTER,
        hostChildId: childId,
        hostScopeId: createHash("sha256").update(workspace).digest("hex").slice(0, 20),
      } satisfies Pick<MemImportUsageResolution, "adapter" | "hostChildId" | "hostScopeId">;
      resolved.set(request.key, latest
        ? { ...base, activitySequence: latest.sequence, activityUpdatedAt: new Date(latest.updatedAt).toISOString(), evidence: latest.evidence }
        : { ...base, evidence: unavailable(found && invalid ? "sidecar-invalid" : found && stale ? "sidecar-stale" : "sidecar-missing") });
    }
    return resolved;
  }
}
