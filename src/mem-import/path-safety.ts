import { lstat } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";

export type PathSafetyOptions = {
  /** Include the requested path itself in the check. */
  includeLeaf?: boolean;
  /** Require every traversed non-leaf component to be a directory. */
  requireDirectories?: boolean;
  onSymlink?: (path: string) => Error;
  onNonDirectory?: (path: string) => Error;
};

/**
 * Check existing components without ever resolving an intermediate component.
 * A single lstat on a deep path follows symlinked ancestors, so walk from the
 * filesystem root instead. Missing descendants stop the walk: they cannot
 * conceal an existing later component.
 */
export async function assertNoSymlinkedPathComponents(path: string, options: PathSafetyOptions = {}): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  const limit = options.includeLeaf === false ? Math.max(0, components.length - 1) : components.length;
  let current = root;
  for (let index = 0; index < limit; index += 1) {
    current = join(current, components[index]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw options.onSymlink?.(current) ?? new Error(`Refusing symlinked path component: ${current}`);
      if (options.requireDirectories && index < limit - 1 && !info.isDirectory()) {
        throw options.onNonDirectory?.(current) ?? new Error(`Path component is not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/** Check the parent and leaf before an operation that may create or replace a path. */
export async function assertSafePathForWrite(path: string): Promise<void> {
  await assertNoSymlinkedPathComponents(path, { requireDirectories: true });
}

/** Check a path's existing ancestors while allowing the leaf to be absent. */
export async function assertSafePathAncestors(path: string): Promise<void> {
  await assertNoSymlinkedPathComponents(path, { includeLeaf: false, requireDirectories: true });
}
