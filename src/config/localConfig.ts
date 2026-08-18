import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { childLogger } from '../observability/index.ts';
import { localConfigPaths } from './paths.ts';

/**
 * User/project config file (`parallax.json`), opencode-style. This is the layer
 * where users add **custom providers**, override a provider's base URL / key
 * env, or add/rename models — without touching the shipped catalog. It is merged
 * on top of the models.dev data at the highest precedence (see `catalog.ts`).
 *
 * Loaded from `~/.parallax/parallax.json` then `./parallax.json` (project wins).
 * Everything is optional and unknown keys are ignored, so a partial file — even
 * `{ "model": "gpt-4o" }` — is valid. Parsing never throws: a malformed file is
 * logged and skipped, so a typo can't brick the CLI.
 */

const log = childLogger({ mod: 'local-config' });

/** A per-model override in `parallax.json` (mirrors the rich `ModelInfo`). */
const modelOverrideSchema = z
  .object({
    name: z.string(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
      })
      .partial(),
    limitContext: z.number(),
    limitOutput: z.number(),
    toolCall: z.boolean(),
    reasoning: z.boolean(),
    attachment: z.boolean(),
  })
  .partial();

/** A provider entry in `parallax.json`. All fields optional → pure override. */
const providerOverrideSchema = z
  .object({
    /** Human label. */
    name: z.string(),
    /** OpenAI-compatible base URL (implies `wire: 'openai'` for a new provider). */
    baseURL: z.string(),
    /** Env vars that may hold the key, in priority order. */
    env: z.array(z.string()),
    /** Force the wire format for a brand-new custom provider. */
    wire: z.enum(['openai', 'anthropic']),
    /** Default model id for this provider. */
    defaultModel: z.string(),
    /** Model id → override/definition. */
    models: z.record(z.string(), modelOverrideSchema),
  })
  .partial();

export const localConfigSchema = z
  .object({
    /** Default provider id (same as `PARALLAX_PROVIDER`). */
    provider: z.string(),
    /** Default model id (same as `PARALLAX_MODEL`). */
    model: z.string(),
    /** TUI theme name. */
    theme: z.string(),
    /** Provider definitions / overrides, keyed by provider id. */
    providers: z.record(z.string(), providerOverrideSchema),
  })
  .partial();

export type LocalConfig = z.infer<typeof localConfigSchema>;
export type ProviderOverride = z.infer<typeof providerOverrideSchema>;

/** Parse one config file's text, or return `undefined` if invalid (logged). */
export function parseLocalConfig(text: string, source: string): LocalConfig | undefined {
  try {
    return localConfigSchema.parse(JSON.parse(text));
  } catch (err) {
    log.warn({ err, source }, 'ignoring malformed parallax.json');
    return undefined;
  }
}

/**
 * Load and shallow-merge every `parallax.json` on disk, later paths winning.
 * `providers` maps are merged per-id (a project file can override just one
 * provider without redefining the rest). Missing files are silently skipped.
 */
export function loadLocalConfig(): LocalConfig {
  const merged: LocalConfig = {};
  for (const path of localConfigPaths()) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue; // no file here — fine
    }
    const parsed = parseLocalConfig(text, path);
    if (!parsed) continue;
    const providers = { ...merged.providers, ...parsed.providers };
    Object.assign(merged, parsed);
    if (Object.keys(providers).length > 0) merged.providers = providers;
  }
  return merged;
}
