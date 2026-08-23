import { homedir } from 'node:os';
import { join } from 'node:path';

/** Standard on-disk locations (blueprint §28.1). Overridable via env for tests. */
export function configHome(): string {
  return process.env.PARALLAX_HOME ?? join(homedir(), '.parallax');
}

export function databasePath(): string {
  return process.env.PARALLAX_DB ?? join(configHome(), 'sessions.sqlite');
}

/** Where the models.dev catalog is cached on disk (overridable via env). */
export function modelsCachePath(): string {
  return process.env.PARALLAX_MODELS_CACHE ?? join(configHome(), 'models.json');
}

/**
 * Where the optional API-key store lives (overridable via env). Derived from
 * `configHome()` so a redirected `PARALLAX_HOME` (as tests use) also isolates
 * credentials — no real key can leak into a test run. See `credentials.ts`.
 */
export function credentialsPath(): string {
  return process.env.PARALLAX_CREDENTIALS ?? join(configHome(), 'credentials.json');
}

/**
 * Candidate `parallax.json` config paths, in *increasing* precedence: the user
 * config in `~/.parallax`, then a project-local file in the current directory.
 * A project file overrides the user file (blueprint §28.3).
 */
export function localConfigPaths(): string[] {
  return [join(configHome(), 'parallax.json'), join(process.cwd(), 'parallax.json')];
}
