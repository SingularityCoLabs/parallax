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

/**
 * Scrub an API key so it is always a legal HTTP header value. API keys are
 * visible-ASCII tokens (`[!-~]`); anything else — a trailing newline from
 * `.env`/`credentials.json`, a line break from a wrapped paste, a stray space,
 * or a smart-quote — is removed. This matters because undici *throws* on a
 * header value containing a control character (e.g. an embedded `\n`) and its
 * error message echoes the key verbatim, so an unsanitized key both breaks the
 * request and risks leaking the secret into logs. Removing (not rejecting) the
 * junk means a wrapped paste "just works". Returns `undefined` if nothing is
 * left (the key was only whitespace).
 */
export function sanitizeApiKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[^\x21-\x7e]/g, '');
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Resolve the web-search (Tavily) API key: the `TAVILY_API_KEY` environment
 * variable first, then the on-disk credentials store under the `tavily` key
 * (so a key can be saved once and reused, like a provider key). Read lazily by
 * the `web_search` tool so a key added mid-session is picked up. Never persisted
 * to `Config`, so it can't leak into the store or logs.
 */
export function resolveSearchApiKey(): string | undefined {
  return process.env.TAVILY_API_KEY ?? getCredential('tavily');
}
