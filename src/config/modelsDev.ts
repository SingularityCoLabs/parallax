import { readFile, writeFile, stat, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { childLogger } from '../observability/index.ts';
import type { ModelInfo } from './providers.ts';
import { modelsCachePath } from './paths.ts';

/**
 * models.dev integration (opencode-style). models.dev publishes a rich catalog
 * of providers and models — cost, context/output limits, tool/reasoning flags —
 * at `https://models.dev/api.json`. We fetch it as *data only* (no vendor SDK),
 * normalize a subset into `ModelInfo`, and cache it to disk so the network is
 * hit at most once per TTL. A bundled snapshot (see `snapshot.ts`) means the
 * catalog always works offline; models.dev only augments it.
 *
 * Mirrors the schema in opencode's `packages/core/src/models-dev.ts`, trimmed to
 * the fields Parallax renders. Unknown fields are ignored (`.passthrough()` is
 * unnecessary — we only read what we name).
 */

const log = childLogger({ mod: 'models-dev' });

const MODELS_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 10_000;

/** models.dev cost block (USD per 1M tokens). */
const costSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  })
  .partial();

/** A single models.dev model entry (subset). */
const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  cost: costSchema.optional(),
  limit: z
    .object({ context: z.number().optional(), output: z.number().optional() })
    .partial()
    .optional(),
  tool_call: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  attachment: z.boolean().optional(),
  release_date: z.string().optional(),
  status: z.string().optional(),
});

/** A single models.dev provider entry (subset). */
const providerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  env: z.array(z.string()).optional(),
  /** OpenAI-compatible base URL, when the provider exposes one. */
  api: z.string().optional(),
  /** The AI SDK npm package models.dev associates with the provider (used only
   * to infer wire format — we never import it). */
  npm: z.string().optional(),
  models: z.record(z.string(), modelSchema),
});

/** The whole api.json: providerId → provider. */
export const modelsDevSchema = z.record(z.string(), providerSchema);

export type ModelsDevProvider = z.infer<typeof providerSchema>;
export type ModelsDevCatalog = z.infer<typeof modelsDevSchema>;

/** Normalize a models.dev model entry to Parallax's `ModelInfo`. */
export function normalizeModel(m: z.infer<typeof modelSchema>): ModelInfo {
  const info: {
    -readonly [K in keyof ModelInfo]: ModelInfo[K];
  } = { id: m.id };
  if (m.name !== undefined) info.name = m.name;
  if (m.cost?.input !== undefined && m.cost.output !== undefined) {
    info.cost = { input: m.cost.input, output: m.cost.output };
    if (m.cost.cache_read !== undefined) info.cost = { ...info.cost, cacheRead: m.cost.cache_read };
    if (m.cost.cache_write !== undefined)
      info.cost = { ...info.cost, cacheWrite: m.cost.cache_write };
  }
  if (m.limit?.context !== undefined) info.limitContext = m.limit.context;
  if (m.limit?.output !== undefined) info.limitOutput = m.limit.output;
  if (m.tool_call !== undefined) info.toolCall = m.tool_call;
  if (m.reasoning !== undefined) info.reasoning = m.reasoning;
  if (m.attachment !== undefined) info.attachment = m.attachment;
  if (m.release_date !== undefined) info.releaseDate = m.release_date;
  if (m.status !== undefined) info.status = m.status;
  return info;
}

/** Whether the models.dev fetch is disabled (offline / tests / opt-out). */
export function fetchDisabled(): boolean {
  return process.env.PARALLAX_DISABLE_MODELS_FETCH === '1';
}

function sourceUrl(): string {
  return process.env.PARALLAX_MODELS_URL || MODELS_URL;
}

/** Parse raw api.json text into a validated catalog, or throw. */
export function parseModelsDev(text: string): ModelsDevCatalog {
  return modelsDevSchema.parse(JSON.parse(text));
}

/** Read the on-disk cache if present and fresh (mtime within TTL). */
export async function readCache(): Promise<ModelsDevCatalog | undefined> {
  const path = modelsCachePath();
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > CACHE_TTL_MS) return undefined;
    return parseModelsDev(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Fetch api.json from models.dev with a timeout. Returns raw text. */
async function fetchApi(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${sourceUrl()}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'parallax' },
    });
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Atomically write the cache file (temp + rename), creating its dir. */
async function writeCache(text: string): Promise<void> {
  const path = modelsCachePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

/**
 * Refresh the on-disk cache from models.dev if the fetch is enabled and the
 * cache is stale. Returns the parsed catalog on success, `undefined` on any
 * failure (offline, timeout, bad payload) — callers fall back to the snapshot.
 * Never throws: catalog augmentation is best-effort.
 */
export async function refreshFromNetwork(force = false): Promise<ModelsDevCatalog | undefined> {
  if (fetchDisabled()) return undefined;
  try {
    if (!force) {
      const cached = await readCache();
      if (cached) return cached;
    }
    const text = await fetchApi();
    const parsed = parseModelsDev(text);
    await writeCache(text);
    return parsed;
  } catch (err) {
    log.debug({ err }, 'models.dev refresh failed; using snapshot/cache');
    return undefined;
  }
}
