import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProvider, MissingApiKeyError } from '../src/app/index.ts';
import { loadConfig, effectiveModel, resolveApiKey, defaultConfig } from '../src/config/index.ts';

const ENV_KEYS = [
  'PARALLAX_PROVIDER',
  'PARALLAX_MODEL',
  'PARALLAX_API_BASE_URL',
  'PARALLAX_API_KEY',
  'NVIDIA_API_KEY',
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

describe('provider selection', () => {
  it('defaults to the fake provider with model fake-1', () => {
    const config = loadConfig();
    expect(config.provider).toBe('fake');
    expect(effectiveModel(config)).toBe('fake-1');
    const provider = buildProvider(config);
    expect(provider.name).toBe('fake');
  });

  it('reads provider/model/base-url from the environment', () => {
    process.env.PARALLAX_PROVIDER = 'nvidia';
    process.env.PARALLAX_API_BASE_URL = 'https://integrate.api.nvidia.com/v1';
    const config = loadConfig();
    expect(config.provider).toBe('nvidia');
    // NVIDIA default model when none specified.
    expect(effectiveModel(config)).toBe('meta/llama-3.3-70b-instruct');
  });

  it('builds an nvidia provider when an API key is present', () => {
    process.env.PARALLAX_PROVIDER = 'nvidia';
    process.env.NVIDIA_API_KEY = 'nvapi-abc';
    const config = loadConfig();
    expect(resolveApiKey('nvidia')).toBe('nvapi-abc');
    const provider = buildProvider(config);
    expect(provider.name).toBe('nvidia');
  });

  it('throws a helpful error when the nvidia API key is missing', () => {
    process.env.PARALLAX_PROVIDER = 'nvidia';
    const config = loadConfig();
    expect(() => buildProvider(config)).toThrowError(MissingApiKeyError);
    try {
      buildProvider(config);
    } catch (err) {
      expect((err as Error).message).toContain('NVIDIA_API_KEY');
    }
  });

  it('an explicit model overrides the provider default', () => {
    const config = {
      ...defaultConfig(),
      provider: 'nvidia' as const,
      defaultModel: 'qwen/qwen2.5-coder-32b',
    };
    expect(effectiveModel(config)).toBe('qwen/qwen2.5-coder-32b');
  });
});
