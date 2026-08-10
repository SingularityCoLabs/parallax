import { homedir } from 'node:os';
import { join } from 'node:path';

/** Standard on-disk locations (blueprint §28.1). Overridable via env for tests. */
export function configHome(): string {
  return process.env.PARALLAX_HOME ?? join(homedir(), '.parallax');
}

export function databasePath(): string {
  return process.env.PARALLAX_DB ?? join(configHome(), 'sessions.sqlite');
}
