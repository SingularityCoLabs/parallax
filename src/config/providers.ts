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
 *
 * The catalog is *layered* (blueprint §28.3): a static `BASE_PROVIDERS` map is
 * the authoritative source for each curated provider's identity (wire, base URL,
 * default model, key env). On top of that, a bundled models.dev snapshot and a
 * live models.dev fetch *enrich* it (rich per-model cost/limit metadata, longer
 * model lists, extra providers), and a user's `parallax.json` *overrides* it.
 * The merged result is installed via `setCatalog`; `getProvider`/`listProviders`
 * read that live view and stay synchronous so nothing downstream must await.
 */

/** How the runtime talks to a provider. Picks the adapter in `buildProvider`. */
export type ProviderWire = 'fake' | 'openai' | 'anthropic';

/**
 * Rich per-model metadata, sourced from models.dev (or a user override). Every
 * field is optional: a bare model id (just `{ id }`) is always valid, so a
 * provider that only lists model *names* still works. Costs are USD per 1M
 * tokens; limits are token counts — matching the models.dev convention.
 */
export interface ModelInfo {
  /** Model id used on the wire and in `/model <id>`. */
  readonly id: string;
  /** Human label for menus (falls back to `id`). */
  readonly name?: string;
  /** Price per 1M tokens, USD. */
  readonly cost?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  /** Max context window (tokens). */
  readonly limitContext?: number;
  /** Max output tokens. */
  readonly limitOutput?: number;
  /** Whether the model supports tool/function calling. */
  readonly toolCall?: boolean;
  /** Whether the model exposes a reasoning/thinking mode. */
  readonly reasoning?: boolean;
  /** Whether the model accepts non-text attachments (images/pdf). */
  readonly attachment?: boolean;
  /** ISO date the model was released, for sorting/labels. */
  readonly releaseDate?: string;
  /** Lifecycle marker from the catalog (e.g. `alpha`/`beta`/`deprecated`). */
  readonly status?: string;
}

export interface ProviderInfo {
  /** Stable id used in config, env (`PARALLAX_PROVIDER`), and `/provider <id>`. */
  readonly id: string;
  /** Human label for menus. */
  readonly label: string;
  /** Wire format → which adapter drives it. */
  readonly wire: ProviderWire;
  /**
   * Whether Parallax can actually drive this provider. Curated providers and any
   * OpenAI-/Anthropic-wire provider are supported; models.dev providers that need
   * a vendor SDK we don't ship (Google, Bedrock, Vertex, …) are listed but flagged
   * unsupported so `/providers` can show them and `buildProvider` can refuse
   * clearly rather than fail obscurely.
   */
  readonly supported: boolean;
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
   * Kept as a plain id list for back-compat; rich metadata lives in `modelInfo`.
   */
  readonly models: readonly string[];
  /** Rich metadata keyed by model id, when known (from models.dev / overrides). */
  readonly modelInfo?: Readonly<Record<string, ModelInfo>>;
}

/**
 * The authoritative base registry. Keyed by provider id. These entries own each
 * curated provider's *identity* (wire, base URL, default model, key env) — the
 * models.dev layer only enriches metadata and adds providers; it never changes
 * these. Adding an OpenAI-compatible provider here is all that is required to
 * make it selectable with no new code at all.
 */
export const BASE_PROVIDERS: Record<string, ProviderInfo> = {
  fake: {
    id: 'fake',
    label: 'Fake (offline, scripted)',
    wire: 'fake',
    supported: true,
    baseUrl: '',
    apiKeyEnv: [],
    defaultModel: 'fake-1',
    models: ['fake-1'],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    wire: 'anthropic',
    supported: true,
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
    supported: true,
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
    supported: true,
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
    supported: true,
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
    supported: true,
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
    supported: true,
    // Placeholder — the real endpoint comes from PARALLAX_API_BASE_URL.
    baseUrl: 'http://localhost:8000/v1',
    apiKeyEnv: [],
    defaultModel: 'default',
    models: [],
  },
};

/**
 * The live catalog. Starts as a copy of `BASE_PROVIDERS` and is replaced by
 * `setCatalog` once the snapshot / models.dev / local config have been merged in
 * (see `catalog.ts`). Reads go through the accessors below so callers never see
 * the mutable binding directly.
 */
let liveCatalog: Record<string, ProviderInfo> = { ...BASE_PROVIDERS };

/** Install a freshly-merged catalog as the live view (see `catalog.ts`). */
export function setCatalog(next: Record<string, ProviderInfo>): void {
  liveCatalog = next;
}

/** The current live catalog (already merged). */
export function getCatalog(): Record<string, ProviderInfo> {
  return liveCatalog;
}

/**
 * The static base registry (identity source of truth). Kept as `PROVIDERS` for
 * back-compat; prefer `getCatalog()` for the merged live view.
 */
export const PROVIDERS = BASE_PROVIDERS;

/** Look up a provider by id in the live catalog, or `undefined` if unknown. */
export function getProvider(id: string): ProviderInfo | undefined {
  return liveCatalog[id];
}

/** All provider ids in the live catalog, in registry (insertion) order. */
export function providerIds(): string[] {
  return Object.keys(liveCatalog);
}

/** All providers in the live catalog, in registry order. */
export function listProviders(): ProviderInfo[] {
  return Object.values(liveCatalog);
}
