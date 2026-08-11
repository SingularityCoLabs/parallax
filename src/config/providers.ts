/**
 * The provider catalog (opencode-style registry). This is *data* — the config
 * layer owns it so the CLI, app, and tests can all read provider metadata
 * without importing the provider classes (which live in the `providers` layer
 * and are subject to the architectural import boundaries in eslint.config.js).
 *
 * Every provider declares a wire format. All the OpenAI-compatible endpoints
 * (OpenAI, OpenRouter, Moonshot/Kimi, NVIDIA NIM, a local vLLM/Ollama, …) share
 * one adapter and differ only by base URL + key. Anthropic speaks its own
 * `/v1/messages` wire format and gets a dedicated adapter. The `fake` provider
 * is the offline, scripted one used by demos and tests.
 */

/** How the runtime talks to a provider. Picks the adapter in `buildProvider`. */
export type ProviderWire = 'fake' | 'openai' | 'anthropic';

export interface ProviderInfo {
  /** Stable id used in config, env (`PARALLAX_PROVIDER`), and `/provider <id>`. */
  readonly id: string;
  /** Human label for menus. */
  readonly label: string;
  /** Wire format → which adapter drives it. */
  readonly wire: ProviderWire;
  /**
   * Default base URL for the provider's API. Empty for `fake`. For `custom`,
   * this is a placeholder — the real value comes from `PARALLAX_API_BASE_URL`
   * (see `effectiveBaseUrl`).
   */
  readonly baseUrl: string;
  /**
   * Environment variables that may hold this provider's API key, in priority
   * order. `PARALLAX_API_KEY` is always consulted first (see `resolveApiKey`),
   * so it is a provider-agnostic override and is not repeated here.
   */
  readonly apiKeyEnv: readonly string[];
  /** Model used when none is specified. */
  readonly defaultModel: string;
  /** Where to obtain an API key, shown in setup guidance. Empty for `fake`/`custom`. */
  readonly keyUrl?: string;
  /**
   * Curated model ids for menus (`/models`). Suggestions only — for any
   * OpenAI-compatible provider an arbitrary model string is also accepted.
   */
  readonly models: readonly string[];
}

/**
 * The registry. Keyed by provider id. Adding a provider here is all that is
 * required to make it selectable from the CLI and the `/provider` command —
 * OpenAI-compatible ones need no new code at all.
 */
export const PROVIDERS: Record<string, ProviderInfo> = {
  fake: {
    id: 'fake',
    label: 'Fake (offline, scripted)',
    wire: 'fake',
    baseUrl: '',
    apiKeyEnv: [],
    defaultModel: 'fake-1',
    models: ['fake-1'],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    defaultModel: 'claude-opus-4-8',
    keyUrl: 'https://console.anthropic.com',
    models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    wire: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: ['NVIDIA_API_KEY'],
    defaultModel: 'meta/llama-3.3-70b-instruct',
    keyUrl: 'https://build.nvidia.com',
    models: [
      'meta/llama-3.3-70b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'qwen/qwen2.5-coder-32b-instruct',
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    wire: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: ['OPENROUTER_API_KEY'],
    defaultModel: 'anthropic/claude-sonnet-4.5',
    keyUrl: 'https://openrouter.ai/keys',
    models: [
      'anthropic/claude-sonnet-4.5',
      'openai/gpt-4o',
      'moonshotai/kimi-k2',
      'deepseek/deepseek-chat',
    ],
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    wire: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyEnv: ['MOONSHOT_API_KEY'],
    defaultModel: 'kimi-k2-0711-preview',
    keyUrl: 'https://platform.moonshot.ai',
    models: ['kimi-k2-0711-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    wire: 'openai',
    // Placeholder — the real endpoint comes from PARALLAX_API_BASE_URL.
    baseUrl: 'http://localhost:8000/v1',
    apiKeyEnv: [],
    defaultModel: 'default',
    models: [],
  },
};

/** Look up a provider by id, or `undefined` if unknown. */
export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS[id];
}

/** All provider ids, in registry (insertion) order. */
export function providerIds(): string[] {
  return Object.keys(PROVIDERS);
}

/** All providers, in registry order. */
export function listProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS);
}
