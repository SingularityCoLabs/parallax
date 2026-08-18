import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getProvider,
  listProviders,
  providerIds,
  initCatalog,
  resetCatalog,
  loadConfig,
  effectiveModel,
  effectiveBaseUrl,
} from '../src/config/index.ts';

/**
 * The layered catalog: BASE_PROVIDERS (identity) ⊕ models.dev snapshot
 * (metadata) ⊕ parallax.json (overrides). These tests run against the bundled
 * snapshot (network disabled globally in vitest.config.ts).
 */

let tmp: string;
let savedHome: string | undefined;
let savedCwd: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'parallax-catalog-'));
  savedHome = process.env.PARALLAX_HOME;
  savedCwd = process.cwd();
  process.env.PARALLAX_HOME = join(tmp, 'home');
  process.chdir(tmp); // so ./parallax.json resolves under tmp, not the repo
  resetCatalog();
});

afterEach(() => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env.PARALLAX_HOME;
  else process.env.PARALLAX_HOME = savedHome;
  resetCatalog();
  rmSync(tmp, { recursive: true, force: true });
});

describe('catalog: snapshot enrichment', () => {
  it('keeps curated providers and enriches them with models.dev metadata', () => {
    initCatalog();
    const ids = providerIds();
    for (const id of [
      'fake',
      'anthropic',
      'openai',
      'nvidia',
      'openrouter',
      'moonshot',
      'custom',
    ]) {
      expect(ids).toContain(id);
    }
    const anthropic = getProvider('anthropic')!;
    // Identity from BASE_PROVIDERS is preserved.
    expect(anthropic.wire).toBe('anthropic');
    expect(anthropic.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(anthropic.defaultModel).toBe('claude-opus-4-8');
    // Rich metadata comes from the snapshot.
    const opus = anthropic.modelInfo?.['claude-opus-4-8'];
    expect(opus?.cost?.input).toBe(5);
    expect(opus?.limitContext).toBe(1_000_000);
    expect(opus?.toolCall).toBe(true);
  });

  it('marks every curated provider supported', () => {
    initCatalog();
    for (const info of listProviders()) expect(info.supported).toBe(true);
  });
});

describe('catalog: parallax.json overrides', () => {
  it('adds a custom OpenAI-compatible provider', () => {
    writeFileSync(
      join(tmp, 'parallax.json'),
      JSON.stringify({
        providers: {
          myvllm: {
            name: 'My vLLM',
            baseURL: 'http://localhost:8000/v1',
            env: ['MYVLLM_API_KEY'],
            wire: 'openai',
            defaultModel: 'llama-3-8b',
            models: { 'llama-3-8b': { name: 'Llama 3 8B', limitContext: 8192 } },
          },
        },
      }),
    );
    initCatalog();
    const p = getProvider('myvllm');
    expect(p).toBeDefined();
    expect(p!.wire).toBe('openai');
    expect(p!.baseUrl).toBe('http://localhost:8000/v1');
    expect(p!.apiKeyEnv).toEqual(['MYVLLM_API_KEY']);
    expect(p!.defaultModel).toBe('llama-3-8b');
    expect(p!.modelInfo?.['llama-3-8b']?.limitContext).toBe(8192);
  });

  it('overrides an existing provider base URL without losing its models', () => {
    writeFileSync(
      join(tmp, 'parallax.json'),
      JSON.stringify({ providers: { openai: { baseURL: 'https://proxy.local/v1' } } }),
    );
    initCatalog();
    const openai = getProvider('openai')!;
    expect(openai.baseUrl).toBe('https://proxy.local/v1');
    expect(openai.models).toContain('gpt-4o'); // curated models retained
    expect(openai.wire).toBe('openai');
  });

  it('feeds provider/model defaults into loadConfig', () => {
    const prevProvider = process.env.PARALLAX_PROVIDER;
    const prevModel = process.env.PARALLAX_MODEL;
    delete process.env.PARALLAX_PROVIDER;
    delete process.env.PARALLAX_MODEL;
    try {
      writeFileSync(
        join(tmp, 'parallax.json'),
        JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini' }),
      );
      const config = loadConfig();
      expect(config.provider).toBe('openai');
      expect(effectiveModel(config)).toBe('gpt-4o-mini');
      expect(effectiveBaseUrl(config)).toBe('https://api.openai.com/v1');
    } finally {
      if (prevProvider !== undefined) process.env.PARALLAX_PROVIDER = prevProvider;
      if (prevModel !== undefined) process.env.PARALLAX_MODEL = prevModel;
    }
  });

  it('ignores a malformed parallax.json instead of crashing', () => {
    writeFileSync(join(tmp, 'parallax.json'), '{ not valid json ');
    expect(() => initCatalog()).not.toThrow();
    expect(getProvider('anthropic')).toBeDefined();
  });
});
