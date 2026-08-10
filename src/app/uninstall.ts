import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep, parse as parsePath } from 'node:path';
import { configHome, databasePath } from '../config/index.ts';
import { SqliteSessionStore } from '../sessions/index.ts';
import { PACKAGE_NAME } from '../version.ts';

export type UninstallTargetKind = 'file' | 'directory';

export interface UninstallTarget {
  /** Absolute path that would be removed. */
  path: string;
  /** Human label for the CLI listing. */
  label: string;
  kind: UninstallTargetKind;
  exists: boolean;
  /** Total bytes on disk (recursive for directories); 0 when absent. */
  bytes: number;
}

export interface UninstallPlan {
  /** Parallax's state directory (`~/.parallax` unless `PARALLAX_HOME` overrides). */
  home: string;
  /** The sessions database, which `PARALLAX_DB` may relocate outside `home`. */
  databasePath: string;
  /** Persisted session count, or `undefined` when the database is absent/unreadable. */
  sessionCount: number | undefined;
  targets: UninstallTarget[];
  totalBytes: number;
  /** Whether the running CLI came from an installed package or a source checkout. */
  installKind: 'package' | 'source';
  packageName: string;
  /** The exact command that removes the binary, or `null` for a source checkout. */
  removeCommand: string | null;
}

export interface UninstallResult {
  removed: string[];
  failed: Array<{ path: string; message: string }>;
}

/**
 * Paths we refuse to delete no matter what the config says: the filesystem root,
 * the user's home directory, and the current working directory. A mistyped
 * `PARALLAX_HOME` must not turn `uninstall` into `rm -rf $HOME`.
 */
function assertSafeToRemove(target: string): void {
  const abs = resolve(target);
  const forbidden = new Set([parsePath(abs).root, resolve(homedir()), resolve(process.cwd())]);
  if (forbidden.has(abs)) {
    throw new Error(
      `Refusing to remove ${abs}: it is a filesystem root, your home directory, or the ` +
        `current directory. Check PARALLAX_HOME / PARALLAX_DB.`,
    );
  }
}

/** Bytes on disk for a file or directory tree. Symlinks count as their own size. */
function sizeOf(target: string): number {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(join(target, entry.name));
  }
  return total;
}

function describe(path: string, label: string, kind: UninstallTargetKind): UninstallTarget {
  const exists = existsSync(path);
  return { path, label, kind, exists, bytes: exists ? sizeOf(path) : 0 };
}

/** True if `child` is `parent` or nested inside it (path-segment aware, never a string prefix). */
function isWithin(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Count persisted sessions without creating anything. Opening a SqliteSessionStore
 * runs migrations (and would create the file), so this only reads an existing
 * database and degrades to `undefined` if it is unreadable.
 */
async function countSessions(dbPath: string): Promise<number | undefined> {
  if (!existsSync(dbPath)) return undefined;
  let store: SqliteSessionStore;
  try {
    store = new SqliteSessionStore(dbPath);
  } catch {
    return undefined;
  }
  try {
    return (await store.listSessions()).length;
  } catch {
    return undefined;
  } finally {
    store.close();
  }
}

/** Where the running CLI lives — an installed package, or a working copy of the repo. */
function detectInstallKind(): 'package' | 'source' {
  return import.meta.url.includes('/node_modules/') ? 'package' : 'source';
}

/**
 * Enumerate everything Parallax has written outside its own install directory
 * (blueprint §28.1). This is a pure inspection: it creates no files and deletes
 * nothing, so the CLI can show it before asking for confirmation. Use
 * `planUninstallWithSessions()` to also report how many sessions would be lost.
 */
export function planUninstall(): UninstallPlan {
  const home = resolve(configHome());
  const db = resolve(databasePath());

  const targets: UninstallTarget[] = [describe(home, 'state directory', 'directory')];
  // PARALLAX_DB can point the database outside the state directory; if so it is
  // its own target, along with the WAL sidecars SQLite keeps beside it.
  if (!isWithin(home, db)) {
    targets.push(describe(db, 'sessions database', 'file'));
    targets.push(describe(`${db}-wal`, 'database write-ahead log', 'file'));
    targets.push(describe(`${db}-shm`, 'database shared memory', 'file'));
  }

  const installKind = detectInstallKind();
  return {
    home,
    databasePath: db,
    sessionCount: undefined,
    targets,
    totalBytes: targets.reduce((sum, t) => sum + t.bytes, 0),
    installKind,
    packageName: PACKAGE_NAME,
    removeCommand: installKind === 'package' ? `npm uninstall --global ${PACKAGE_NAME}` : null,
  };
}

/** `planUninstall()` plus the persisted session count read from the database. */
export async function planUninstallWithSessions(): Promise<UninstallPlan> {
  const plan = planUninstall();
  return { ...plan, sessionCount: await countSessions(plan.databasePath) };
}

/**
 * Delete the planned targets. Each path is re-checked against the refusal list
 * immediately before removal, so a plan constructed elsewhere cannot smuggle in a
 * dangerous path. Removing the package binary is deliberately NOT done here — the
 * CLI cannot know which package manager installed it, so it prints the command
 * instead of guessing.
 */
export function executeUninstall(plan: UninstallPlan): UninstallResult {
  const result: UninstallResult = { removed: [], failed: [] };
  for (const target of plan.targets) {
    if (!target.exists) continue;
    try {
      assertSafeToRemove(target.path);
      rmSync(target.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      result.removed.push(target.path);
    } catch (err) {
      result.failed.push({
        path: target.path,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/** Render a byte count for the CLI listing. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
