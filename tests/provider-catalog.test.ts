import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProvider, MissingApiKeyError, apiKeyEnvHint } from '../src/app/index.ts';
import {
  loadConfig,
  effectiveModel,
  effectiveBaseUrl,
  resolveApiKey,
  defaultConfig,
  getProvider,
  providerIds,
} from '../src/config/index.ts';

const ENV_KEYS = [
  'PARALLAX_PROVIDER',
  'PARALLAX_MODEL',
  'PARALLAX_API_BASE_URL',
  'PARALLAX_API_KEY',
  'NVIDIA_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'MOONSHOT_API_KEY',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('provider catalog', () => {
  it('exposes the expected providers', () => {
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
  });

  it('resolves each provider default model and base URL from the catalog', () => {
    for (const id of ['anthropic', 'openai', 'openrouter', 'moonshot']) {
      const info = getProvider(id)!;
      const config = { ...defaultConfig(), provider: id };
      expect(effectiveModel(config)).toBe(info.defaultModel);
      expect(effectiveBaseUrl(config)).toBe(info.baseUrl);
    }
  });

  it('an explicit base URL override wins over the catalog', () => {
    const config = { ...defaultConfig(), provider: 'openai', apiBaseUrl: 'https://proxy.local/v1' };
    expect(effectiveBaseUrl(config)).toBe('https://proxy.local/v1');
  });

  it('resolveApiKey reads the provider-specific env var', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xyz';
    expect(resolveApiKey('anthropic')).toBe('sk-ant-xyz');
    expect(resolveApiKey('openai')).toBeUndefined();
  });

  it('PARALLAX_API_KEY overrides any provider-specific key', () => {
    process.env.PARALLAX_API_KEY = 'override';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xyz';
    expect(resolveApiKey('anthropic')).toBe('override');
  });

  it('apiKeyEnvHint names the primary env var for a provider', () => {
    expect(apiKeyEnvHint('anthropic')).toBe('ANTHROPIC_API_KEY');
    expect(apiKeyEnvHint('openai')).toBe('OPENAI_API_KEY');
    expect(apiKeyEnvHint('moonshot')).toBe('MOONSHOT_API_KEY');
  });
});

describe('buildProvider dispatch', () => {
  it('builds the fake provider by default (no key needed)', () => {
    const config = loadConfig();
    expect(config.provider).toBe('fake');
    expect(buildProvider(config).name).toBe('fake');
  });

  it('builds an Anthropic provider when the key is present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-abc';
    const config = { ...defaultConfig(), provider: 'anthropic' };
    const provider = buildProvider(config);
    expect(provider.name).toBe('anthropic');
  });

  it('builds an OpenAI-compatible provider for openai/openrouter/moonshot/nvidia', () => {
    for (const id of ['openai', 'openrouter', 'moonshot', 'nvidia']) {
      const provider = buildProvider({ ...defaultConfig(), provider: id }, { apiKey: 'k' });
      expect(provider.name).toBe(id);
    }
  });

  it('throws a helpful MissingApiKeyError naming the provider env var', () => {
    const config = { ...defaultConfig(), provider: 'anthropic' };
    expect(() => buildProvider(config)).toThrowError(MissingApiKeyError);
    try {
      buildProvider(config);
    } catch (err) {
      expect((err as Error).message).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('reads provider + model from the environment', () => {
    process.env.PARALLAX_PROVIDER = 'anthropic';
    process.env.PARALLAX_MODEL = 'claude-sonnet-4-6';
    const config = loadConfig();
    expect(config.provider).toBe('anthropic');
    expect(effectiveModel(config)).toBe('claude-sonnet-4-6');
  });
});
