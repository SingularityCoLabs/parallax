import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSessionStore } from '../src/sessions/index.ts';
import { databasePath } from '../src/config/index.ts';
import {
  formatBytes,
  planUninstall,
  planUninstallWithSessions,
  executeUninstall,
  type UninstallPlan,
} from '../src/app/uninstall.ts';

let dir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'parallax-uninstall-'));
  for (const key of ['PARALLAX_HOME', 'PARALLAX_DB']) savedEnv[key] = process.env[key];
  process.env.PARALLAX_HOME = join(dir, 'state');
  delete process.env.PARALLAX_DB;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const session = {
  cwd: '/w',
  provider: 'fake',
  model: 'm',
  permissionMode: 'workspace',
} as const;

/** Create a populated sessions database at `dbPath`. */
async function seedDatabase(dbPath: string, count = 1): Promise<void> {
  mkdirSync(join(dbPath, '..'), { recursive: true });
  const store = new SqliteSessionStore(dbPath);
  try {
    for (let i = 0; i < count; i += 1) await store.createSession(session);
  } finally {
    store.close();
  }
}

/** A hand-built plan aimed at `path`, used to prove the removal guard holds. */
function planTargeting(path: string): UninstallPlan {
  return {
    home: path,
    databasePath: join(path, 'sessions.sqlite'),
    sessionCount: undefined,
    targets: [{ path, label: 'state directory', kind: 'directory', exists: true, bytes: 1 }],
    totalBytes: 1,
    installKind: 'source',
    packageName: '@singularitycolabs/parallax',
    removeCommand: null,
  };
}

describe('planUninstall', () => {
  it('reports nothing to remove when Parallax has never run', async () => {
    const plan = await planUninstallWithSessions();
    expect(plan.home).toBe(join(dir, 'state'));
    expect(plan.databasePath).toBe(join(dir, 'state', 'sessions.sqlite'));
    expect(plan.targets.every((t) => !t.exists)).toBe(true);
    expect(plan.totalBytes).toBe(0);
    expect(plan.sessionCount).toBeUndefined();
  });

  it('creates nothing while inspecting (a dry run must not leave a database behind)', () => {
    planUninstall();
    expect(existsSync(join(dir, 'state'))).toBe(false);
  });

  it('finds the state directory, its size, and the persisted session count', async () => {
    await seedDatabase(databasePath(), 2);

    const plan = await planUninstallWithSessions();
    const stateDir = plan.targets.find((t) => t.kind === 'directory');
    expect(stateDir?.path).toBe(join(dir, 'state'));
    expect(stateDir?.exists).toBe(true);
    expect(plan.sessionCount).toBe(2);
    expect(plan.totalBytes).toBeGreaterThan(0);
  });

  it('treats a database relocated by PARALLAX_DB as its own target, with sidecars', async () => {
    const dbPath = join(dir, 'elsewhere', 'data.sqlite');
    mkdirSync(join(dir, 'state'), { recursive: true });
    await seedDatabase(dbPath);
    writeFileSync(`${dbPath}-wal`, 'wal sidecar');
    process.env.PARALLAX_DB = dbPath;

    const plan = await planUninstallWithSessions();
    const paths = plan.targets.map((t) => t.path);
    expect(paths).toContain(join(dir, 'state'));
    expect(paths).toContain(dbPath);
    expect(paths).toContain(`${dbPath}-wal`);
    expect(plan.sessionCount).toBe(1);
  });
});

describe('executeUninstall', () => {
  it('removes the state directory and everything in it', async () => {
    await seedDatabase(databasePath());
    const home = join(dir, 'state');
    expect(existsSync(databasePath())).toBe(true);

    const result = executeUninstall(await planUninstallWithSessions());
    expect(result.failed).toEqual([]);
    expect(result.removed).toContain(home);
    expect(existsSync(home)).toBe(false);
  });

  it('removes a relocated database and its sidecars without touching its parent', async () => {
    const dbPath = join(dir, 'elsewhere', 'data.sqlite');
    await seedDatabase(dbPath);
    writeFileSync(`${dbPath}-wal`, 'wal sidecar');
    process.env.PARALLAX_DB = dbPath;

    executeUninstall(await planUninstallWithSessions());
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    // The directory that happened to hold the database is not ours to delete.
    expect(existsSync(join(dir, 'elsewhere'))).toBe(true);
  });

  it('skips targets that do not exist instead of failing', async () => {
    const result = executeUninstall(await planUninstallWithSessions());
    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('refuses to remove the home directory', () => {
    const result = executeUninstall(planTargeting(homedir()));
    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.message).toMatch(/Refusing to remove/);
    expect(existsSync(homedir())).toBe(true);
  });

  it('refuses to remove the current working directory', () => {
    const result = executeUninstall(planTargeting(process.cwd()));
    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(existsSync(process.cwd())).toBe(true);
  });

  it('refuses to remove a filesystem root', () => {
    const result = executeUninstall(planTargeting('/'));
    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(existsSync('/')).toBe(true);
  });
});

describe('formatBytes', () => {
  it('renders readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
