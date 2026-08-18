import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseModelsDev,
  normalizeModel,
  refreshFromNetwork,
  modelsCachePath,
} from '../src/config/index.ts';

/** A minimal but realistic api.json payload (models.dev shape). */
const API_JSON = JSON.stringify({
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY'],
    npm: '@ai-sdk/anthropic',
    models: {
      'claude-opus-4-8': {
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4.8',
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
        limit: { context: 1000000, output: 128000 },
        tool_call: true,
        reasoning: true,
        attachment: true,
        release_date: '2026-05-28',
      },
    },
  },
  someco: {
    id: 'someco',
    name: 'SomeCo',
    env: ['SOMECO_API_KEY'],
    npm: '@ai-sdk/openai-compatible',
    api: 'https://api.someco.ai/v1',
    models: { 'sc-1': { id: 'sc-1' } },
  },
});

let tmp: string;
let savedHome: string | undefined;
let savedDisable: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'parallax-md-'));
  savedHome = process.env.PARALLAX_HOME;
  savedDisable = process.env.PARALLAX_DISABLE_MODELS_FETCH;
  process.env.PARALLAX_HOME = join(tmp, 'home');
  delete process.env.PARALLAX_DISABLE_MODELS_FETCH; // opt back into fetch for these tests
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedHome === undefined) delete process.env.PARALLAX_HOME;
  else process.env.PARALLAX_HOME = savedHome;
  if (savedDisable === undefined) delete process.env.PARALLAX_DISABLE_MODELS_FETCH;
  else process.env.PARALLAX_DISABLE_MODELS_FETCH = savedDisable;
  rmSync(tmp, { recursive: true, force: true });
});

describe('models.dev parsing', () => {
  it('parses a valid api.json payload', () => {
    const catalog = parseModelsDev(API_JSON);
    expect(Object.keys(catalog)).toEqual(['anthropic', 'someco']);
    expect(catalog.anthropic!.models['claude-opus-4-8']!.cost!.input).toBe(5);
  });

  it('normalizes a model entry to ModelInfo (snake_case → camelCase)', () => {
    const catalog = parseModelsDev(API_JSON);
    const info = normalizeModel(catalog.anthropic!.models['claude-opus-4-8']!);
    expect(info.id).toBe('claude-opus-4-8');
    expect(info.cost).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
    expect(info.limitContext).toBe(1_000_000);
    expect(info.limitOutput).toBe(128_000);
    expect(info.toolCall).toBe(true);
    expect(info.releaseDate).toBe('2026-05-28');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseModelsDev('{ nope')).toThrow();
  });
});

describe('models.dev fetch + cache', () => {
  /** A fetch mock that returns a FRESH Response each call (bodies read once). */
  const freshFetch = (body = API_JSON): ReturnType<typeof vi.fn> =>
    vi.fn().mockImplementation(() => Promise.resolve(new Response(body, { status: 200 })));

  it('fetches, parses, and writes the cache atomically', async () => {
    const fetchMock = freshFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshFromNetwork(true);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toContain('anthropic');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Cache file written.
    expect(existsSync(modelsCachePath())).toBe(true);
    expect(readFileSync(modelsCachePath(), 'utf8')).toContain('claude-opus-4-8');
  });

  it('serves a fresh cache without hitting the network', async () => {
    const fetchMock = freshFetch();
    vi.stubGlobal('fetch', fetchMock);
    await refreshFromNetwork(true); // seed cache
    fetchMock.mockClear();

    const result = await refreshFromNetwork(false); // not forced → cache hit
    expect(result).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches when the cache is stale (mtime older than TTL)', async () => {
    const fetchMock = freshFetch();
    vi.stubGlobal('fetch', fetchMock);
    await refreshFromNetwork(true); // seed cache
    // Age the cache well past the 24h TTL.
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(modelsCachePath(), old, old);
    fetchMock.mockClear();

    const result = await refreshFromNetwork(false);
    expect(result).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined (no throw) when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await refreshFromNetwork(true);
    expect(result).toBeUndefined();
  });

  it('respects PARALLAX_DISABLE_MODELS_FETCH', async () => {
    process.env.PARALLAX_DISABLE_MODELS_FETCH = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await refreshFromNetwork(true);
    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
