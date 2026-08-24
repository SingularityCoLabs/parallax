import {
  effectiveModel,
  effectiveBaseUrl,
  getProvider,
  resolveApiKey,
  sanitizeApiKey,
  type Config,
} from '../config/index.ts';
import {
  AnthropicProvider,
  FakeModelProvider,
  OpenAiCompatibleProvider,
  type ModelProvider,
} from '../providers/index.ts';

export class MissingApiKeyError extends Error {
  constructor(provider: string, envHint: string) {
    super(
      `No API key for provider "${provider}". Set ${envHint} (e.g. export ${envHint}=...) ` +
        `or use the fake provider (PARALLAX_PROVIDER=fake).`,
    );
    this.name = 'MissingApiKeyError';
  }
}

/** A provider that is in the catalog but Parallax cannot drive (needs a vendor SDK). */
export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(
      `Provider "${provider}" is listed in the catalog but not supported by Parallax ` +
        `(it needs a vendor SDK Parallax does not ship). Pick an OpenAI-compatible or ` +
        `Anthropic provider, or define a custom one in parallax.json.`,
    );
    this.name = 'UnsupportedProviderError';
  }
}

/** The env var to name in setup guidance for a provider (catalog-driven). */
export function apiKeyEnvHint(provider: string): string {
  return getProvider(provider)?.apiKeyEnv[0] ?? 'PARALLAX_API_KEY';
}

/**
 * Select and construct the model provider from config (blueprint §11.4, §29).
 * Dispatches on the catalog `wire` format: `fake` is offline; every
 * OpenAI-compatible endpoint (OpenAI, OpenRouter, Moonshot, NVIDIA, custom)
 * shares one adapter; Anthropic has its own. The API key is resolved from the
 * environment here — never from persisted config — so it can't leak into the
 * session store or logs. This is the single place provider choice is made;
 * everything downstream sees only `ModelProvider`.
 */
export function buildProvider(config: Config, options: { apiKey?: string } = {}): ModelProvider {
  const info = getProvider(config.provider);
  if (!info || info.wire === 'fake') {
    return new FakeModelProvider();
  }

  if (!info.supported) {
    throw new UnsupportedProviderError(config.provider);
  }

  // Sanitize whether the key came from the env, the credentials store, or the
  // `/model` dialog — all can carry a stray newline/space that would make the
  // auth header illegal (and leak the key via undici's error).
  const apiKey = sanitizeApiKey(options.apiKey ?? resolveApiKey(config.provider));
  if (!apiKey) {
    throw new MissingApiKeyError(config.provider, apiKeyEnvHint(config.provider));
  }

  const baseUrl = effectiveBaseUrl(config);
  if (info.wire === 'anthropic') {
    return new AnthropicProvider({
      name: config.provider,
      baseUrl,
      apiKey,
      maxTokens: config.maxOutputTokens,
    });
  }

  return new OpenAiCompatibleProvider({
    name: config.provider,
    baseUrl,
    apiKey,
    maxTokens: config.maxOutputTokens,
  });
}

/** True if the configured provider can act on free-form goals (not the fake). */
export function providerSupportsChat(config: Config): boolean {
  const info = getProvider(config.provider);
  return info !== undefined && info.wire !== 'fake';
}

/** The model that will actually be used, for display. */
export function displayModel(config: Config): string {
  return effectiveModel(config);
}
