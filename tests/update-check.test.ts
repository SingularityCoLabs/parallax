import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isNewer,
  readUpdateCache,
  refreshUpdateInfo,
  upgradeCommand,
  updateCheckDisabled,
} from '../src/config/updateCheck.ts';
import { VERSION } from '../src/version.ts';

let dir: string;
let cachePath: string;
const savedFetch = globalThis.fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'parallax-upd-'));
  cachePath = join(dir, 'update.json');
  process.env.PARALLAX_UPDATE_CACHE = cachePath;
  delete process.env.PARALLAX_NO_UPDATE_CHECK;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PARALLAX_UPDATE_CACHE;
  delete process.env.PARALLAX_NO_UPDATE_CHECK;
  globalThis.fetch = savedFetch;
});

describe('isNewer (semver precedence, prerelease-aware)', () => {
  it('compares release numbers', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });

  it('orders prereleases within the same release', () => {
    expect(isNewer('0.1.0-beta.12', '0.1.0-beta.8')).toBe(true);
    expect(isNewer('0.1.0-beta.8', '0.1.0-beta.12')).toBe(false);
    expect(isNewer('0.1.0-beta.2', '0.1.0-beta.2')).toBe(false);
  });

  it('treats a stable release as newer than its prerelease', () => {
    expect(isNewer('0.1.0', '0.1.0-beta.9')).toBe(true);
    expect(isNewer('0.1.0-beta.9', '0.1.0')).toBe(false);
  });
});

describe('updateCheckDisabled', () => {
  it('honors the opt-out env var', () => {
    process.env.PARALLAX_NO_UPDATE_CHECK = '1';
    expect(updateCheckDisabled()).toBe(true);
  });
});

describe('upgradeCommand', () => {
  it('is the plain global install for a latest-channel update', () => {
    const cmd = upgradeCommand({
      current: VERSION,
      latest: '9.9.9',
      channel: 'latest',
      checkedAt: 0,
    });
    expect(cmd).toContain('npm install --global');
    expect(cmd).not.toContain('@next');
  });
  it('appends @next for a next-channel update', () => {
    const cmd = upgradeCommand({
      current: VERSION,
      latest: '9.9.9',
      channel: 'next',
      checkedAt: 0,
    });
    expect(cmd).toContain('@next');
  });
});

describe('readUpdateCache', () => {
  it('returns a fresh entry that matches the running version', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        current: VERSION,
        latest: '9.9.9',
        channel: 'latest',
        checkedAt: Date.now(),
      }),
    );
    const info = await readUpdateCache();
    expect(info?.latest).toBe('9.9.9');
  });

  it('ignores a cache written for a different (old) version', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        current: '0.0.1',
        latest: '9.9.9',
        channel: 'latest',
        checkedAt: Date.now(),
      }),
    );
    expect(await readUpdateCache()).toBeUndefined();
  });

  it('returns undefined when there is no cache file', async () => {
    expect(await readUpdateCache()).toBeUndefined();
  });
});

describe('refreshUpdateInfo', () => {
  it('reports and caches a newer version from the registry dist-tags', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ latest: '9.9.9', next: '9.9.9' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const info = await refreshUpdateInfo();
    expect(info?.latest).toBe('9.9.9');
    expect(existsSync(cachePath)).toBe(true);
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).latest).toBe('9.9.9');
  });

  it('returns undefined when the registry only has the current version', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ latest: VERSION }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await refreshUpdateInfo()).toBeUndefined();
  });

  it('never throws when offline (returns undefined)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await refreshUpdateInfo()).toBeUndefined();
  });

  it('respects the opt-out (no network call)', async () => {
    process.env.PARALLAX_NO_UPDATE_CHECK = '1';
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await refreshUpdateInfo()).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
