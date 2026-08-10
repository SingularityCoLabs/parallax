import type { Config } from '../config/index.ts';
import type { PermissionMode } from '../protocol/index.ts';
import { SqliteSessionStore, InMemorySessionStore, type SessionStore } from '../sessions/index.ts';
import { createRuntime } from './createRuntime.ts';
import { defaultToolset } from './toolset.ts';
import { buildProvider } from './buildProvider.ts';
import type { RuntimeFacade } from '../runtime/index.ts';

export interface CreateAgentOptions {
  config: Config;
  /** Persist to this SQLite path; omit for an in-memory (ephemeral) session. */
  dbPath?: string;
  /** Explicit API key; otherwise resolved from the environment. */
  apiKey?: string;
}

export interface Agent {
  facade: RuntimeFacade;
  store: SessionStore;
}

/**
 * Build a runtime driven by the *configured* provider (real or fake) with the
 * full default toolset (blueprint §7.1 `app` composition root). Used by the CLI
 * `run`/`chat` commands. The CLI supplies only rendering + approval callbacks; it
 * never sees the provider, store, tools, or executor.
 */
export function createAgent(options: CreateAgentOptions): Agent {
  const provider = buildProvider(options.config, {
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  });
  const store: SessionStore = options.dbPath
    ? new SqliteSessionStore(options.dbPath)
    : new InMemorySessionStore();
  const { registerTools } = defaultToolset(options.config);
  const facade = createRuntime({ config: options.config, provider, store, registerTools });
  return { facade, store };
}

export type { PermissionMode };
