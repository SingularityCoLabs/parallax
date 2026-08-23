import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  loadCredentials,
  getCredential,
  saveCredential,
  credentialsPath,
  resolveApiKey,
  initCatalog,
  resetCatalog,
} from '../src/config/index.ts';

/**
 * The opt-in on-disk API-key store (`credentials.json`). It is isolated per-test
 * via `PARALLAX_HOME` (so `credentialsPath()` points at a temp dir and no real
 * key is read), and must: round-trip, survive corruption, be written 0600, and
 * sit *below* environment variables in `resolveApiKey`'s precedence.
 */

let tmp: string;
let savedHome: string | undefined;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'parallax-creds-'));
  savedHome = process.env.PARALLAX_HOME;
  process.env.PARALLAX_HOME = join(tmp, 'home');
  // Neutralize any ambient keys so precedence assertions are deterministic.
  for (const key of ['PARALLAX_API_KEY', 'ANTHROPIC_API_KEY']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetCatalog();
  initCatalog();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PARALLAX_HOME;
  else process.env.PARALLAX_HOME = savedHome;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetCatalog();
  rmSync(tmp, { recursive: true, force: true });
});

describe('credentials store', () => {
  it('round-trips a saved key', () => {
    expect(loadCredentials()).toEqual({});
    saveCredential('anthropic', 'sk-ant-test');
    expect(getCredential('anthropic')).toBe('sk-ant-test');
    expect(loadCredentials()).toEqual({ anthropic: 'sk-ant-test' });
  });

  it('merges without clobbering other providers', () => {
    saveCredential('anthropic', 'sk-ant-1');
    saveCredential('openai', 'sk-oai-2');
    expect(loadCredentials()).toEqual({ anthropic: 'sk-ant-1', openai: 'sk-oai-2' });
    // Overwriting one leaves the other intact.
    saveCredential('anthropic', 'sk-ant-3');
    expect(getCredential('anthropic')).toBe('sk-ant-3');
    expect(getCredential('openai')).toBe('sk-oai-2');
  });

  it('writes the file with no group/other access (0600)', () => {
    saveCredential('anthropic', 'sk-ant-test');
    const mode = statSync(credentialsPath()).mode;
    // The security property: owner-only. Group/other bits must be clear.
    expect(mode & 0o077).toBe(0);
  });

  it('treats a malformed file as empty rather than throwing', () => {
    mkdirSync(dirname(credentialsPath()), { recursive: true });
    writeFileSync(credentialsPath(), 'not json {{{', 'utf8');
    expect(loadCredentials()).toEqual({});
    expect(getCredential('anthropic')).toBeUndefined();
  });

  it('lets an environment variable win over a stored key', () => {
    saveCredential('anthropic', 'sk-from-disk');
    expect(resolveApiKey('anthropic')).toBe('sk-from-disk'); // falls back to disk
    process.env.ANTHROPIC_API_KEY = 'sk-from-env';
    expect(resolveApiKey('anthropic')).toBe('sk-from-env'); // env takes precedence
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveApiKey('anthropic')).toBe('sk-from-disk'); // and back to disk
  });
});
