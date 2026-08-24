import { z } from 'zod';
import { permissionModeSchema } from '../protocol/index.ts';
import { getProvider } from './providers.ts';

/**
 * Model provider id. Historically a `z.enum` of the static catalog, but the
 * catalog is now *dynamic* (models.dev + `parallax.json` add providers at
 * runtime), so the id is validated as a free string here. An unknown provider is
 * caught later — gracefully — at provider-build time (`buildProvider`) and by the
 * `/provider` command, which report a friendly error instead of a raw ZodError.
 */
export const providerNameSchema = z.string();
export type ProviderName = z.infer<typeof providerNameSchema>;

/** Per-provider default model when none is specified (read from the live catalog). */
export function providerDefaultModel(id: string): string {
  return getProvider(id)?.defaultModel ?? '';
}

/**
 * Runtime configuration (blueprint §28). v0.1 exposes the knobs the runtime and
 * tools actually read; layered user/project config files are an extension point.
 * Defaults are conservative (workspace mode, bounded output).
 */
export const configSchema = z.object({
  provider: providerNameSchema.default('fake'),
  /** Empty string means "use the provider's default model" (see effectiveModel). */
  defaultModel: z.string().default(''),
  /**
   * Base URL override. Empty string means "use the selected provider's catalog
   * base URL" (see effectiveBaseUrl). Set via PARALLAX_API_BASE_URL to point at
   * a custom OpenAI-compatible endpoint (local vLLM/Ollama, a proxy, …).
   */
  apiBaseUrl: z.union([z.literal(''), z.string().url()]).default(''),
  /** Upper bound on model output tokens per response (required by Anthropic). */
  maxOutputTokens: z.number().int().positive().default(16_000),
  permissionMode: permissionModeSchema.default('workspace'),
  maxSteps: z.number().int().positive().default(24),
  systemPrompt: z
    .string()
    .default(
      'You are Parallax, a careful general-purpose agent. Use the provided tools to inspect and act on ' +
        'the workspace. Prefer native file tools over shell for reading and editing. ' +
        'For any multi-step task, maintain a task list with `update_todos` (send the full list each time, ' +
        'keep exactly one task in_progress, and mark tasks completed as you finish them). ' +
        'When in plan mode, research read-only (read/list/search, and web tools if needed), then call ' +
        '`present_plan` with a concrete Markdown plan; approving it exits plan mode so you can execute. ' +
        'Use `web_search` for current information beyond your knowledge and `web_fetch` to read a specific ' +
        'URL. Explain what you did concisely.',
    ),
  maxToolResultChars: z.number().int().positive().default(16_000),
  maxMessages: z.number().int().nonnegative().default(0),
  // Tool limits (blueprint §13, §14, §15).
  maxFileReadBytes: z.number().int().positive().default(1_000_000),
  maxDirEntries: z.number().int().positive().default(1_000),
  maxSearchResults: z.number().int().positive().default(200),
  shellTimeoutMs: z.number().int().positive().default(120_000),
  shellMaxOutputBytes: z.number().int().positive().default(1_000_000),
  // Web tool limits (network tools: web_fetch, web_search).
  webRequestTimeoutMs: z.number().int().positive().default(15_000),
  webFetchMaxBytes: z.number().int().positive().default(2_000_000),
  webSearchMaxResults: z.number().int().positive().max(10).default(5),
});

export type Config = z.infer<typeof configSchema>;

export function defaultConfig(): Config {
  return configSchema.parse({});
}

/** Resolve the effective model: explicit value wins, else the provider default. */
export function effectiveModel(config: Config): string {
  if (config.defaultModel !== '') return config.defaultModel;
  return getProvider(config.provider)?.defaultModel ?? '';
}

/**
 * Resolve the effective base URL: an explicit override wins, else the selected
 * provider's catalog base URL. Empty (the default) means "ask the catalog", so
 * switching providers picks up the right endpoint without an env change.
 */
export function effectiveBaseUrl(config: Config): string {
  if (config.apiBaseUrl !== '') return config.apiBaseUrl;
  return getProvider(config.provider)?.baseUrl ?? '';
}
