import { effectiveModel, resolveApiKey, type Config } from '../config/index.ts';
import {
  FakeModelProvider,
  OpenAiCompatibleProvider,
  type ModelProvider,
} from '../providers/index.ts';

export class MissingApiKeyError extends Error {
  constructor(provider: string, envHint: string) {
    super(
      `No API key for provider "${provider}". Set ${envHint} (e.g. export ${envHint}=nvapi-...) ` +
        `or use the fake provider (PARALLAX_PROVIDER=fake).`,
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Select and construct the model provider from config (blueprint §11.4, §29).
 * The API key is resolved from the environment here — never from persisted
 * config — so it can't leak into the session store or logs. This is the single
 * place provider choice is made; everything downstream sees only `ModelProvider`.
 */
export function buildProvider(config: Config, options: { apiKey?: string } = {}): ModelProvider {
  if (config.provider === 'fake') {
    return new FakeModelProvider();
  }

  const apiKey = options.apiKey ?? resolveApiKey(config.provider);
  if (!apiKey) {
    const envHint = config.provider === 'nvidia' ? 'NVIDIA_API_KEY' : 'PARALLAX_API_KEY';
    throw new MissingApiKeyError(config.provider, envHint);
  }

  return new OpenAiCompatibleProvider({
    name: config.provider,
    baseUrl: config.apiBaseUrl,
    apiKey,
  });
}

/** True if the configured provider can act on free-form goals (not the fake). */
export function providerSupportsChat(config: Config): boolean {
  return config.provider !== 'fake';
}

/** The model that will actually be used, for display. */
export function displayModel(config: Config): string {
  return effectiveModel(config);
}
