import { childLogger } from '../observability/index.ts';
import {
  BASE_PROVIDERS,
  setCatalog,
  type ModelInfo,
  type ProviderInfo,
  type ProviderWire,
} from './providers.ts';
import {
  normalizeModel,
  refreshFromNetwork,
  type ModelsDevCatalog,
  type ModelsDevProvider,
} from './modelsDev.ts';
import { MODELS_DEV_SNAPSHOT } from './snapshot.ts';
import { loadLocalConfig, type LocalConfig, type ProviderOverride } from './localConfig.ts';

/**
 * The catalog builder — the single place the layered provider registry is
 * assembled (blueprint §28.3 precedence):
 *
 *   BASE_PROVIDERS  (authoritative identity: wire, base URL, default model, key)
 *     ⊕ models.dev  (rich per-model metadata, extra models, extra providers)
 *     ⊕ parallax.json (user overrides / custom providers — highest precedence)
 *
 * The result is installed via `setCatalog`, which the synchronous
 * `getProvider`/`listProviders` accessors read. models.dev data comes from the
 * bundled snapshot until a live fetch replaces it (`applyLiveModelsDev`), so the
 * catalog is always rich and offline-capable.
 */

const log = childLogger({ mod: 'catalog' });

/** npm packages models.dev associates with OpenAI-wire providers. */
const OPENAI_COMPAT_NPM = new Set([
  '@ai-sdk/openai',
  '@ai-sdk/openai-compatible',
  '@openrouter/ai-sdk-provider',
]);

/** Once a live models.dev catalog is fetched, it's remembered here so later
 * rebuilds (e.g. a local-config change) keep the richer data. */
let liveModelsDev: ModelsDevCatalog | undefined;
let inited = false;

/** Infer the wire format for a models.dev provider we don't already curate. */
function inferWire(p: ModelsDevProvider): ProviderWire {
  if (p.npm === '@ai-sdk/anthropic' || p.id === 'anthropic') return 'anthropic';
  return 'openai';
}

/**
 * Whether Parallax can actually drive a models.dev provider with its two
 * hand-rolled adapters. Anthropic-native and any OpenAI-compatible endpoint with
 * a base URL are supported; providers needing a vendor SDK we don't ship
 * (Google, Bedrock, Vertex, …) are listed but unsupported.
 */
function inferSupported(p: ModelsDevProvider, wire: ProviderWire): boolean {
  if (wire === 'anthropic') return p.npm === '@ai-sdk/anthropic' || p.id === 'anthropic';
  return Boolean(p.api) || (p.npm !== undefined && OPENAI_COMPAT_NPM.has(p.npm));
}

/** Build the `modelInfo` map + suggested-id list for a models.dev provider. */
function modelsFrom(p: ModelsDevProvider): {
  models: string[];
  modelInfo: Record<string, ModelInfo>;
} {
  const modelInfo: Record<string, ModelInfo> = {};
  for (const [id, m] of Object.entries(p.models)) modelInfo[id] = normalizeModel(m);
  return { models: Object.keys(p.models), modelInfo };
}

/** Merge models.dev metadata onto a curated base provider (identity unchanged). */
function enrichBase(base: ProviderInfo, p: ModelsDevProvider): ProviderInfo {
  const { models: mdModels, modelInfo } = modelsFrom(p);
  // Curated ids first (they're the suggested ones), then any models.dev extras.
  const models = [...base.models, ...mdModels.filter((id) => !base.models.includes(id))];
  return { ...base, models, modelInfo };
}

/** Build a brand-new provider entry from a models.dev provider. */
function providerFromModelsDev(p: ModelsDevProvider): ProviderInfo {
  const wire = inferWire(p);
  const { models, modelInfo } = modelsFrom(p);
  return {
    id: p.id,
    label: p.name ?? p.id,
    wire,
    supported: inferSupported(p, wire),
    baseUrl: p.api ?? '',
    apiKeyEnv: p.env ?? [],
    defaultModel: models[0] ?? 'default',
    models,
    modelInfo,
  };
}

/** Apply a `parallax.json` provider override on top of an existing entry. */
function applyOverride(
  existing: ProviderInfo | undefined,
  id: string,
  o: ProviderOverride,
): ProviderInfo {
  const base: ProviderInfo = existing ?? {
    id,
    label: id,
    wire: 'openai',
    supported: true,
    baseUrl: '',
    apiKeyEnv: [],
    defaultModel: 'default',
    models: [],
  };
  const modelInfo: Record<string, ModelInfo> = { ...base.modelInfo };
  const extraModels: string[] = [];
  for (const [mid, m] of Object.entries(o.models ?? {})) {
    const info: { -readonly [K in keyof ModelInfo]: ModelInfo[K] } = { id: mid, ...modelInfo[mid] };
    if (m.name !== undefined) info.name = m.name;
    if (m.cost?.input !== undefined && m.cost.output !== undefined) {
      info.cost = { input: m.cost.input, output: m.cost.output };
      if (m.cost.cacheRead !== undefined) info.cost = { ...info.cost, cacheRead: m.cost.cacheRead };
      if (m.cost.cacheWrite !== undefined)
        info.cost = { ...info.cost, cacheWrite: m.cost.cacheWrite };
    }
    if (m.limitContext !== undefined) info.limitContext = m.limitContext;
    if (m.limitOutput !== undefined) info.limitOutput = m.limitOutput;
    if (m.toolCall !== undefined) info.toolCall = m.toolCall;
    if (m.reasoning !== undefined) info.reasoning = m.reasoning;
    if (m.attachment !== undefined) info.attachment = m.attachment;
    modelInfo[mid] = info;
    if (!base.models.includes(mid)) extraModels.push(mid);
  }
  const models = [...base.models, ...extraModels];
  return {
    ...base,
    ...(o.name !== undefined ? { label: o.name } : {}),
    ...(o.wire !== undefined ? { wire: o.wire } : {}),
    ...(o.baseURL !== undefined ? { baseUrl: o.baseURL } : {}),
    ...(o.env !== undefined ? { apiKeyEnv: o.env } : {}),
    ...(o.defaultModel !== undefined ? { defaultModel: o.defaultModel } : {}),
    // A user-defined provider is one they intend to use → supported.
    supported: true,
    models,
    ...(Object.keys(modelInfo).length > 0 ? { modelInfo } : {}),
  };
}

/** Assemble the merged catalog from the three layers. */
function build(md: ModelsDevCatalog, local: LocalConfig): Record<string, ProviderInfo> {
  const result: Record<string, ProviderInfo> = {};
  // 1. Base providers (authoritative identity).
  for (const [id, info] of Object.entries(BASE_PROVIDERS)) result[id] = { ...info };
  // 2. models.dev: enrich curated providers, add the rest.
  for (const [id, p] of Object.entries(md)) {
    const base = result[id];
    result[id] = base ? enrichBase(base, p) : providerFromModelsDev(p);
  }
  // 3. Local overrides (highest precedence).
  for (const [id, o] of Object.entries(local.providers ?? {})) {
    result[id] = applyOverride(result[id], id, o);
  }
  return result;
}

/** Rebuild and install the live catalog from current inputs. */
export function initCatalog(): void {
  const md = liveModelsDev ?? MODELS_DEV_SNAPSHOT;
  setCatalog(build(md, loadLocalConfig()));
  inited = true;
}

/** Build the catalog once if it hasn't been built yet (called by `loadConfig`). */
export function ensureCatalog(): void {
  if (!inited) initCatalog();
}

/** Read the user's default provider/model from `parallax.json`, for `loadConfig`. */
export function localDefaults(): { provider?: string; model?: string } {
  const local = loadLocalConfig();
  return {
    ...(local.provider !== undefined ? { provider: local.provider } : {}),
    ...(local.model !== undefined ? { model: local.model } : {}),
  };
}

/**
 * Kick off a best-effort models.dev refresh in the background and, on success,
 * rebuild the catalog with the richer live data. Never throws — offline just
 * keeps the snapshot. Call once at startup (from the app composition root).
 */
export async function refreshCatalog(force = false): Promise<void> {
  const data = await refreshFromNetwork(force);
  if (!data) return;
  liveModelsDev = data;
  initCatalog();
  log.debug({ providers: Object.keys(data).length }, 'catalog enriched from models.dev');
}

/** Reset all catalog state to the base providers — for test isolation. */
export function resetCatalog(): void {
  liveModelsDev = undefined;
  inited = false;
  setCatalog({ ...BASE_PROVIDERS });
}
