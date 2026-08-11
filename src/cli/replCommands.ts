import { getProvider, listProviders, resolveApiKey, type ProviderInfo } from '../config/index.ts';

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
  return resolveApiKey(info.id) ? ' [key ✓]' : ' [no key]';
}

/** Render the provider list for `/providers`, marking the current one. */
export function formatProviders(currentProvider: string): string {
  const lines = listProviders().map((info) => {
    const marker = info.id === currentProvider ? '*' : ' ';
    return `  ${marker} ${info.id.padEnd(12)} ${info.label}${keyStatus(info)}`;
  });
  return ['providers (* = current):', ...lines].join('\n');
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
    return `  ${marker} ${m}`;
  });
  return [`${info.id} models (* = current):`, ...lines].join('\n');
}

/** The `/help` text listing every command. */
export function formatHelp(): string {
  return [
    'commands:',
    '  /model <id>            switch model (e.g. /model claude-sonnet-4-6)',
    '  /model <prov>/<id>     switch provider + model (e.g. /model openai/gpt-4o)',
    '  /provider <id>         switch provider, using its default model',
    '  /models [provider]     list models for the current (or named) provider',
    '  /providers             list providers and key status',
    '  /help                  show this help',
    '  exit | quit            leave the REPL',
  ].join('\n');
}
