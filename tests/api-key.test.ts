import { describe, it, expect } from 'vitest';
import { sanitizeApiKey } from '../src/config/index.ts';
import {
  redactSecrets,
  providerHttpError,
  OpenAiCompatibleProvider,
  ProviderHttpError,
  type FetchLike,
} from '../src/providers/index.ts';
import type { ModelRequest } from '../src/providers/index.ts';

describe('sanitizeApiKey', () => {
  it('leaves a clean key untouched', () => {
    expect(sanitizeApiKey('nvapi-abc123')).toBe('nvapi-abc123');
  });

  it('strips a trailing newline (common from .env / echo > file)', () => {
    expect(sanitizeApiKey('nvapi-abc123\n')).toBe('nvapi-abc123');
    expect(sanitizeApiKey('nvapi-abc123\r\n')).toBe('nvapi-abc123');
  });

  it('strips an EMBEDDED newline (the wrapped-paste case that broke the header)', () => {
    // undici rejects a header value with an interior control char; removing it
    // reassembles the intended key.
    expect(sanitizeApiKey('nvapi-abc\ndef')).toBe('nvapi-abcdef');
    expect(sanitizeApiKey('nvapi-abc\r\n  def')).toBe('nvapi-abcdef');
  });

  it('strips surrounding whitespace, tabs, and non-ASCII', () => {
    expect(sanitizeApiKey('  nvapi-abc  ')).toBe('nvapi-abc');
    expect(sanitizeApiKey('\tnvapi-abc\t')).toBe('nvapi-abc');
    expect(sanitizeApiKey('nvapi abc')).toBe('nvapiabc'); // non-breaking space
  });

  it('returns undefined for undefined or whitespace-only input', () => {
    expect(sanitizeApiKey(undefined)).toBeUndefined();
    expect(sanitizeApiKey('   \n\t ')).toBeUndefined();
    expect(sanitizeApiKey('')).toBeUndefined();
  });

  it('produces a value that is a legal HTTP header (the actual invariant)', () => {
    const key = sanitizeApiKey('nvapi-abc\ndef\n')!;
    // Would throw "invalid header value" before sanitizing.
    expect(() => new Headers({ Authorization: `Bearer ${key}` })).not.toThrow();
  });
});

describe('redactSecrets', () => {
  it('removes the exact key when present in an error message', () => {
    const msg = 'Headers.append: "Bearer nvapi-supersecret" is an invalid header value.';
    const out = redactSecrets(msg, 'nvapi-supersecret');
    expect(out).not.toContain('nvapi-supersecret');
    expect(out).toContain('<redacted>');
  });

  it('redacts any Bearer token even without the key in hand', () => {
    expect(redactSecrets('auth failed: Bearer sk-live-999 rejected')).toBe(
      'auth failed: Bearer <redacted> rejected',
    );
  });

  it('does not redact short or absent secrets', () => {
    expect(redactSecrets('plain error', undefined)).toBe('plain error');
    expect(redactSecrets('key ab here', 'ab')).toBe('key ab here'); // too short to redact
  });
});

describe('provider never leaks the key in a transport error', () => {
  const request: ModelRequest = {
    model: 'm',
    system: 's',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
  };

  it('scrubs an undici-style invalid-header error that echoes the key', async () => {
    const key = 'nvapi-leaky-secret-key';
    // Simulate undici throwing with the Authorization value in the message.
    const fetchImpl: FetchLike = () => {
      throw new TypeError(`Headers.append: "Bearer ${key}" is an invalid header value.`);
    };
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
      baseUrl: 'https://x.test/v1',
      apiKey: key,
      fetchImpl,
    });
    let caught: unknown;
    try {
      for await (const _ of provider.stream(request, new AbortController().signal)) void _;
    } catch (e) {
      caught = e;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).not.toContain(key);
    expect(message).toContain('<redacted>');
  });
});

describe('providerHttpError classification', () => {
  it('carries a provider_error code (not internal_error) for turn.failed', () => {
    const err = providerHttpError('nvidia', 500, 'boom');
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.code).toBe('provider_error');
    expect(err.status).toBe(500);
  });

  it('adds a "pick another model" hint for 404/410 (retired/unknown model)', () => {
    const gone = providerHttpError('nvidia', 410, '{"detail":"end of life"}');
    expect(gone.message).toMatch(/end of life/);
    expect(gone.message).toMatch(/\/models nvidia|\/model/);
    const notFound = providerHttpError('openai', 404, 'no such model');
    expect(notFound.message).toMatch(/pick another/i);
  });

  it('omits the hint for other statuses (e.g. 401 auth)', () => {
    const unauth = providerHttpError('nvidia', 401, 'unauthorized');
    expect(unauth.message).not.toMatch(/pick another/i);
  });

  it('surfaces a 410 through the provider stream with the hint', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response('{"status":410,"detail":"The model has reached its end of life."}', {
          status: 410,
        }),
      );
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
      baseUrl: 'https://x.test/v1',
      apiKey: 'nvapi-ok',
      fetchImpl,
    });
    let caught: unknown;
    try {
      for await (const _ of provider.stream(
        {
          model: 'z-ai/glm-5.2',
          system: 's',
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
        },
        new AbortController().signal,
      ))
        void _;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderHttpError);
    expect((caught as ProviderHttpError).code).toBe('provider_error');
    expect((caught as Error).message).toMatch(/end of life/);
    expect((caught as Error).message).toMatch(/\/model/);
  });
});
