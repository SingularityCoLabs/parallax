import {
  getProvider,
  listProviders,
  resolveApiKey,
  type ModelInfo,
  type ProviderInfo,
} from '../config/index.ts';

/** A parsed REPL slash command. `none` means the line is an ordinary message. */
export type ReplCommand =
  | { kind: 'none' }
  | { kind: 'help' }
  | { kind: 'providers' }
  | { kind: 'models'; arg?: string }
  | { kind: 'provider'; arg?: string }
  | { kind: 'model'; arg?: string }
  | { kind: 'unknown'; name: string };

/**
 * Classify an input line. Only lines beginning with `/` are commands; anything
 * else is a `none` (ordinary user turn). Pure — no I/O — so it is trivially
 * testable and the REPL stays a thin dispatcher.
 */
export function parseCommand(line: string): ReplCommand {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return { kind: 'none' };

  const spaceIdx = trimmed.indexOf(' ');
  const name = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1).toLowerCase();
  const arg = spaceIdx === -1 ? undefined : trimmed.slice(spaceIdx + 1).trim() || undefined;

  switch (name) {
    case 'help':
    case '?':
      return { kind: 'help' };
    case 'providers':
      return { kind: 'providers' };
    case 'models':
      return { kind: 'models', ...(arg !== undefined ? { arg } : {}) };
    case 'provider':
      return { kind: 'provider', ...(arg !== undefined ? { arg } : {}) };
    case 'model':
      return { kind: 'model', ...(arg !== undefined ? { arg } : {}) };
    default:
      return { kind: 'unknown', name };
  }
}

export interface ModelSelector {
  provider: string;
  model: string;
}

/**
 * Resolve a `/model` argument to a provider + model. A leading `provider/`
 * prefix switches provider only when the prefix is a *known* provider id — so
 * `anthropic/claude-sonnet-4-6` switches to Anthropic, while `meta/llama-3.3`
 * (an NVIDIA model id that happens to contain a slash) stays on the current
 * provider and is used verbatim as the model.
 */
export function parseModelSelector(arg: string, currentProvider: string): ModelSelector {
  const slash = arg.indexOf('/');
  if (slash > 0) {
    const maybeProvider = arg.slice(0, slash);
    if (getProvider(maybeProvider)) {
      return { provider: maybeProvider, model: arg.slice(slash + 1) };
    }
  }
  return { provider: currentProvider, model: arg };
}

/** One-line status marker for whether a provider's API key is resolvable. */
function keyStatus(info: ProviderInfo): string {
  if (info.wire === 'fake') return '';
  const key = resolveApiKey(info.id) ? ' [key ✓]' : ' [no key]';
  return info.supported ? key : ' [unsupported]';
}

/** Render the provider list for `/providers`, marking the current one. */
export function formatProviders(currentProvider: string): string {
  const lines = listProviders().map((info) => {
    const marker = info.id === currentProvider ? '*' : ' ';
    return `  ${marker} ${info.id.padEnd(12)} ${info.label}${keyStatus(info)}`;
  });
  return ['providers (* = current):', ...lines].join('\n');
}

/** Compact "$in/$out per 1M" price tag, or '' when unknown/free. */
function priceTag(info: ModelInfo): string {
  if (!info.cost || (info.cost.input === 0 && info.cost.output === 0)) return '';
  return ` $${info.cost.input}/${info.cost.output}`;
}

/** Compact context-window tag like "200k" / "1M", or '' when unknown. */
function contextTag(info: ModelInfo): string {
  const c = info.limitContext;
  if (!c) return '';
  if (c >= 1_000_000) return ` ${c / 1_000_000}M ctx`;
  if (c >= 1_000) return ` ${Math.round(c / 1_000)}k ctx`;
  return ` ${c} ctx`;
}

/** Render the curated model list for a provider (`/models [provider]`). */
export function formatModels(providerId: string, currentModel?: string): string {
  const info = getProvider(providerId);
  if (!info) return `Unknown provider "${providerId}". Try /providers.`;
  if (info.models.length === 0) {
    return `${info.id}: any model id is accepted (no curated list).`;
  }
  const lines = info.models.map((m) => {
    const marker = m === currentModel ? '*' : ' ';
    const meta = info.modelInfo?.[m];
    const detail = meta ? `${priceTag(meta)}${contextTag(meta)}` : '';
    return `  ${marker} ${m.padEnd(34)}${detail}`;
  });
  return [`${info.id} models (* = current):`, ...lines].join('\n');
}

/** The `/help` text listing every command. */
export function formatHelp(): string {
  return [
    'commands:',
    '  /model [id]            switch model, or open the picker (e.g. /model claude-sonnet-4-6)',
    '  /model <prov>/<id>     switch provider + model (e.g. /model openai/gpt-4o)',
    '  /provider <id>         switch provider, using its default model',
    '  /models [provider]     list models for the current (or named) provider',
    '  /providers             list providers and key status',
    '  /tools                 list the available agent tools',
    '  /theme [dark|light]    switch the color theme (toggles if no arg)',
    '  /mode <mode>           set permission mode (workspace|plan|read-only|bypass)',
    '  /workspace /plan /read-only /bypass   shortcuts for each permission mode',
    '  /help                  show this help',
    '  /exit | /quit          leave Parallax',
    '  exit | quit            leave the REPL',
  ].join('\n');
}
