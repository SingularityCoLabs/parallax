import { configSchema, defaultConfig, providerNameSchema, type Config } from './schema.ts';
import { getProvider } from './providers.ts';
import { ensureCatalog, localDefaults } from './catalog.ts';
import { getCredential } from './credentials.ts';

/**
 * Load configuration. Precedence (blueprint §28.3): defaults < `parallax.json` <
 * env < explicit overrides. The provider/model catalog is built first
 * (`ensureCatalog`) so provider lookups below see the merged registry.
 *
 * The API key itself is never part of `Config` — it is resolved at provider
 * construction time from the environment (blueprint §29), so it can't be
 * persisted to the session store or logged with config.
 */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  ensureCatalog();

  // `parallax.json` defaults (lowest precedence above the built-in defaults).
  const local: Partial<Config> = {};
  const defaults = localDefaults();
  if (defaults.provider !== undefined) local.provider = defaults.provider;
  if (defaults.model !== undefined) local.defaultModel = defaults.model;

  const env: Partial<Config> = {};
  const provider = providerNameSchema.safeParse(process.env.PARALLAX_PROVIDER);
  if (provider.success && process.env.PARALLAX_PROVIDER) env.provider = provider.data;
  if (process.env.PARALLAX_MODEL) env.defaultModel = process.env.PARALLAX_MODEL;
  if (process.env.PARALLAX_API_BASE_URL) env.apiBaseUrl = process.env.PARALLAX_API_BASE_URL;
  if (process.env.PARALLAX_MAX_STEPS) {
    const n = Number(process.env.PARALLAX_MAX_STEPS);
    if (Number.isFinite(n)) env.maxSteps = n;
  }
  return configSchema.parse({ ...defaultConfig(), ...local, ...env, ...overrides });
}

/**
 * Resolve the API key for a provider from the environment (blueprint §29).
 * `PARALLAX_API_KEY` is a provider-agnostic override checked first; otherwise
 * each of the provider's catalog `apiKeyEnv` vars is tried in order (e.g.
 * `NVIDIA_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). As a last resort the
 * optional on-disk credentials store (`credentials.json`, written by the
 * `/model` dialog) is consulted — so the environment always wins and a stored
 * key only fills the gap. Keys are read here, never persisted to `Config`, so
 * they can't leak into the session store or logs.
 */
export function resolveApiKey(provider: string): string | undefined {
  if (process.env.PARALLAX_API_KEY) return process.env.PARALLAX_API_KEY;
  for (const envVar of getProvider(provider)?.apiKeyEnv ?? []) {
    const value = process.env[envVar];
    if (value) return value;
  }
  return getCredential(provider);
}
