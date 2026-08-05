import { lstat, readFile } from "node:fs/promises";
import { join, normalize, posix } from "node:path";

export const PROJECTION_OWNERSHIP_FILENAME = ".mem-import-generated.json";

export type ProjectionOwnershipManifest = {
  version: 1;
  kind: "mem-import-projection-ownership";
  files: string[];
};

export function projectionOwnershipPath(outputRoot: string): string {
  return join(outputRoot, PROJECTION_OWNERSHIP_FILENAME);
}

export function normalizeOwnedProjectionPath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\\") || normalize(value) !== value || value === "." || value.startsWith("../") || value.includes("/../") || !value.endsWith(".md")) {
    throw new Error(`Invalid generated projection path ${value}`);
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized.startsWith("../") || normalized.includes("/../")) throw new Error(`Invalid generated projection path ${value}`);
  return value;
}

export function validateProjectionOwnership(value: unknown): ProjectionOwnershipManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid mem-import projection ownership manifest");
  const manifest = value as Partial<ProjectionOwnershipManifest>;
  if (manifest.version !== 1 || manifest.kind !== "mem-import-projection-ownership" || !Array.isArray(manifest.files) || !manifest.files.every((file) => typeof file === "string")) throw new Error("Invalid mem-import projection ownership manifest");
  const files = [...new Set(manifest.files.map(normalizeOwnedProjectionPath))].sort();
  return { version: 1, kind: "mem-import-projection-ownership", files };
}

export async function readProjectionOwnership(outputRoot: string): Promise<ProjectionOwnershipManifest | undefined> {
  try {
    const path = projectionOwnershipPath(outputRoot);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlinked projection ownership manifest: ${path}`);
    return validateProjectionOwnership(JSON.parse(await readFile(path, "utf-8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new Error("Invalid mem-import projection ownership manifest JSON");
    throw error;
  }
}
