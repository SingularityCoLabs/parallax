import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { childLogger } from '../observability/index.ts';
import { PACKAGE_NAME, VERSION } from '../version.ts';
import { configHome } from './paths.ts';

/**
 * Lightweight "update available" check (opt-in network, mirrors `modelsDev.ts`).
 * On startup Parallax asks the npm registry for the package's `latest`/`next`
 * dist-tags, compares them to the running `VERSION`, and caches the result to
 * `~/.parallax/update.json` for a day. The UI reads the cache synchronously and,
 * when a newer version exists, shows the exact reinstall command — Parallax
 * never installs anything itself.
 *
 * Never blocks and never throws: offline, a slow registry, or a malformed
 * response just leaves the cache untouched. Opt out entirely with
 * `PARALLAX_NO_UPDATE_CHECK=1` (and it self-disables for `-dev`/`0.0.0` builds).
 */

const log = childLogger({ mod: 'update-check' });

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 3_000;

/** What the UI needs: the running version, the newest available, and its channel. */
export interface UpdateInfo {
  current: string;
  latest: string;
  /** npm dist-tag that currently points at the selected newer version. */
  channel: 'latest' | 'next';
  checkedAt: number;
}

const cacheSchema = z.object({
  current: z.string(),
  latest: z.string(),
  channel: z.enum(['latest', 'next']),
  checkedAt: z.number(),
});

function cachePath(): string {
  return process.env.PARALLAX_UPDATE_CACHE ?? join(configHome(), 'update.json');
}

export function updateCheckDisabled(): boolean {
  if (process.env.PARALLAX_NO_UPDATE_CHECK === '1') return true;
  // Dev/unreleased builds have nothing meaningful to compare against.
  return VERSION === '0.0.0' || VERSION.includes('-dev.');
}

/** Split a semver-ish version into numeric release parts + a prerelease tail. */
function parseVersion(v: string): { release: number[]; pre: string | undefined } {
  const [core, ...preParts] = v.split('-');
  const release = (core ?? '').split('.').map((n) => Number(n) || 0);
  return { release, pre: preParts.length > 0 ? preParts.join('-') : undefined };
}

/** Compare prerelease tails dot-by-dot (numeric-aware), SemVer §11 style. */
function comparePre(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = Number(x);
    const yn = Number(y);
    const bothNum = !Number.isNaN(xn) && !Number.isNaN(yn);
    if (bothNum) {
      if (xn !== yn) return xn < yn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * True if `candidate` is a newer version than `current` (SemVer precedence,
 * incl. prerelease rules: `1.0.0-beta.2` > `1.0.0-beta.1`, and `1.0.0` >
 * `1.0.0-beta.9`). Not-newer or unparseable → false, so a weird tag never
 * nags the user.
 */
export function isNewer(candidate: string, current: string): boolean {
  if (candidate === current) return false;
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < len; i += 1) {
    const x = a.release[i] ?? 0;
    const y = b.release[i] ?? 0;
    if (x !== y) return x > y;
  }
  // Same release numbers → a release outranks a prerelease; else compare tails.
  if (a.pre === undefined && b.pre === undefined) return false;
  if (a.pre === undefined) return true; // candidate is stable, current is pre
  if (b.pre === undefined) return false; // candidate is pre, current is stable
  return comparePre(a.pre, b.pre) > 0;
}

/** Read the cached result if present and fresh (mtime within TTL). */
export async function readUpdateCache(): Promise<UpdateInfo | undefined> {
  try {
    const path = cachePath();
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > CACHE_TTL_MS) return undefined;
    const parsed = cacheSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    // Only surface if it still describes the running version (a fresh install
    // would otherwise show a stale "newer" line from a previous version).
    return parsed.current === VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(info: UpdateInfo): Promise<void> {
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(info)}\n`, 'utf8');
  await rename(tmp, path);
}

const distTagsSchema = z.object({ latest: z.string().optional(), next: z.string().optional() });

function registryUrl(): string {
  const base = process.env.PARALLAX_REGISTRY_URL ?? 'https://registry.npmjs.org';
  return `${base.replace(/\/$/, '')}/-/package/${PACKAGE_NAME}/dist-tags`;
}

/**
 * Refresh the update cache from the npm registry, returning the newer version
 * (if any) so the caller can show it immediately on first run. Best-effort:
 * returns `undefined` on opt-out, offline, timeout, or when already current.
 */
export async function refreshUpdateInfo(): Promise<UpdateInfo | undefined> {
  if (updateCheckDisabled()) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(registryUrl(), {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'parallax' },
    });
    if (!res.ok) return undefined;
    const tags = distTagsSchema.parse(await res.json());
    // Compare both supported public channels and choose the semver-newest one.
    // Pre-1.0 releases currently advance `latest`; `next` remains understood for
    // future prerelease-channel use and for older registry state.
    const candidates: Array<{ v: string; channel: 'latest' | 'next' }> = [];
    if (tags.latest) candidates.push({ v: tags.latest, channel: 'latest' });
    if (tags.next) candidates.push({ v: tags.next, channel: 'next' });
    let best: UpdateInfo | undefined;
    for (const c of candidates) {
      if (!isNewer(c.v, VERSION)) continue;
      if (!best || isNewer(c.v, best.latest)) {
        best = { current: VERSION, latest: c.v, channel: c.channel, checkedAt: Date.now() };
      }
    }
    if (best) await writeCache(best);
    return best;
  } catch (err) {
    log.debug({ err }, 'update check failed (offline?) — ignoring');
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The reinstall command to show the user for a given update. */
export function upgradeCommand(info: UpdateInfo): string {
  const suffix = info.channel === 'next' ? '@next' : '';
  return `npm install --global ${PACKAGE_NAME}${suffix}`;
}
