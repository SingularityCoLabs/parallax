import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { childLogger } from '../observability/index.ts';
import { configHome, localConfigPaths } from './paths.ts';

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

/** The user-scoped `parallax.json` (`~/.parallax/parallax.json`), which persists
 * across projects — where saved defaults live (a project file still overrides). */
export function userConfigPath(): string {
  return `${configHome()}/parallax.json`;
}

/** The subset of settings the app persists automatically (provider/model/theme). */
export type PersistablePrefs = Pick<LocalConfig, 'provider' | 'model' | 'theme'>;

/**
 * Persist chosen defaults to the **user** `parallax.json`, so the next launch
 * opens on the same provider/model/theme without reconfiguration (blueprint
 * §28.3 — this is the write side of `localDefaults`). Reads the existing file
 * raw and shallow-merges the patch, so unrelated keys (e.g. custom `providers`)
 * and hand-written comments-as-values are preserved. Written atomically
 * (temp+rename) with mode `0644` — this holds no secrets (API keys live in the
 * separate 0600 `credentials.json`). Best-effort: a failure is logged and
 * swallowed, exactly like the credentials store, so a read-only home can't brick
 * a switch.
 */
export function saveLocalConfig(patch: PersistablePrefs): void {
  const path = userConfigPath();

  // Start from whatever is already there (raw, to keep unknown keys), tolerating
  // a missing or malformed file — we overwrite only the keys in `patch`.
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object') current = parsed as Record<string, unknown>;
  } catch {
    /* missing or invalid — start fresh */
  }

  const next = { ...current };
  if (patch.provider !== undefined) next.provider = patch.provider;
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.theme !== undefined) next.theme = patch.theme;

  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, path);
  } catch (err) {
    log.warn({ err }, 'could not persist parallax.json');
  }
}
