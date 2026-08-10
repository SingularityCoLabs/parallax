import { realpathSync } from 'node:fs';
import { isAbsolute, resolve, relative, basename, dirname } from 'node:path';

/**
 * Result of resolving a user/model-supplied path against the workspace root.
 * `outsideWorkspace` is the authoritative escape flag — it is computed from the
 * REAL (symlink-resolved) path, never a string prefix (blueprint §17).
 */
export interface ResolvedPath {
  /** The originally requested path (as given). */
  requested: string;
  /** Absolute, normalized path (no symlink resolution). */
  absolute: string;
  /** Symlink-resolved absolute path (of the path or its nearest existing parent). */
  real: string;
  /** True if `real` is outside the canonical workspace root. */
  outsideWorkspace: boolean;
  /** True if the target itself exists on disk. */
  exists: boolean;
}

/** Canonicalize the workspace root once (resolves any symlinks in it). */
export function canonicalizeRoot(root: string): string {
  const abs = resolve(root);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** True if `child` is the same as or nested within `parent` (path-segment aware). */
function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Walk up from `absolute` to the nearest ancestor that exists, returning its
 * realpath plus whether the full target exists. Used so a not-yet-created file
 * (write_file) is validated against its real parent directory, defeating
 * `newlink -> /etc` style escapes (blueprint §17.2, §17.3).
 */
function realpathOfNearestExisting(absolute: string): { real: string; exists: boolean } {
  let current = absolute;
  const suffix: string[] = [];
  // Bound the walk to the number of path segments.
  for (let i = 0; i < 4096; i += 1) {
    try {
      const realParent = realpathSync(current);
      // The suffix segments do not exist on disk, so they cannot contain
      // symlinks — resolving them against the real parent is safe.
      const real = suffix.length > 0 ? resolve(realParent, ...suffix) : realParent;
      return { real, exists: suffix.length === 0 };
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root without resolving; treat as-is.
        return { real: absolute, exists: false };
      }
      suffix.unshift(basename(current));
      current = parent;
    }
  }
  return { real: absolute, exists: false };
}

/**
 * Resolve `requested` against `workspaceRoot` and classify it. Relative paths
 * resolve against the root; absolute paths are honored but still checked. The
 * escape decision uses the symlink-resolved real path (blueprint §17.1).
 */
export function resolveWorkspacePath(workspaceRoot: string, requested: string): ResolvedPath {
  const canonicalRoot = canonicalizeRoot(workspaceRoot);
  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(canonicalRoot, requested);
  const { real, exists } = realpathOfNearestExisting(absolute);
  const outsideWorkspace = !isWithin(canonicalRoot, real);
  return { requested, absolute, real, outsideWorkspace, exists };
}
