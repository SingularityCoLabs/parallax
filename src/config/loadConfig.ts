import { configSchema, defaultConfig, providerNameSchema, type Config } from './schema.ts';
import { getProvider } from './providers.ts';

/**
 * Load configuration. v0.1 uses defaults plus a small set of env overrides
 * (blueprint §28.3 precedence: defaults < env < explicit overrides). File-based
 * user/project config is a documented extension point.
 *
 * The API key itself is never part of `Config` — it is resolved at provider
 * construction time from the environment (blueprint §29), so it can't be
 * persisted to the session store or logged with config.
 */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env: Partial<Config> = {};
  const provider = providerNameSchema.safeParse(process.env.PARALLAX_PROVIDER);
  if (provider.success) env.provider = provider.data;
  if (process.env.PARALLAX_MODEL) env.defaultModel = process.env.PARALLAX_MODEL;
  if (process.env.PARALLAX_API_BASE_URL) env.apiBaseUrl = process.env.PARALLAX_API_BASE_URL;
  if (process.env.PARALLAX_MAX_STEPS) {
    const n = Number(process.env.PARALLAX_MAX_STEPS);
    if (Number.isFinite(n)) env.maxSteps = n;
  }
  return configSchema.parse({ ...defaultConfig(), ...env, ...overrides });
}

/**
 * Resolve the API key for a provider from the environment (blueprint §29).
 * `PARALLAX_API_KEY` is a provider-agnostic override checked first; otherwise
 * each of the provider's catalog `apiKeyEnv` vars is tried in order (e.g.
 * `NVIDIA_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Keys are read here,
 * never persisted to config, so they can't leak into the session store or logs.
 */
export function resolveApiKey(provider: string): string | undefined {
  if (process.env.PARALLAX_API_KEY) return process.env.PARALLAX_API_KEY;
  for (const envVar of getProvider(provider)?.apiKeyEnv ?? []) {
    const value = process.env[envVar];
    if (value) return value;
  }
  return undefined;
}
