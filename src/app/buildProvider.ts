import {
  effectiveModel,
  effectiveBaseUrl,
  getProvider,
  resolveApiKey,
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

  const apiKey = options.apiKey ?? resolveApiKey(config.provider);
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
