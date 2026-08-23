import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { childLogger } from '../observability/index.ts';
import { credentialsPath } from './paths.ts';

/**
 * The optional on-disk API-key store (`~/.parallax/credentials.json`). Parallax
 * resolves keys from the environment first (blueprint §29); this file is a
 * convenience layer so a key entered in the `/model` dialog can persist across
 * launches without re-exporting an env var. It is the *only* place Parallax
 * writes a secret to disk, and it does so deliberately and narrowly:
 *
 * - written with mode `0600` (owner read/write only), under the git-ignored
 *   `.parallax/` config home;
 * - a flat `{ providerId: key }` map — no other config lives here;
 * - never logged (the observability layer redacts `*key*`/`token`/`secret`), and
 *   never placed into `Config` or the session store.
 *
 * Env vars always win over this file (see `resolveApiKey`), so a key here can be
 * transparently overridden and CI/test runs that set no env stay isolated via
 * `PARALLAX_HOME`.
 */

const log = childLogger({ mod: 'credentials' });

/** A flat provider-id → API-key map. Anything else is rejected as malformed. */
const credentialsSchema = z.record(z.string(), z.string());

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * Load the credentials map, or `{}` if the file is missing or malformed. Never
 * throws — a corrupt file must not brick the CLI, exactly like `parallax.json`.
 */
export function loadCredentials(): Credentials {
  let text: string;
  try {
    text = readFileSync(credentialsPath(), 'utf8');
  } catch {
    return {}; // no file yet — the common case
  }
  try {
    return credentialsSchema.parse(JSON.parse(text));
  } catch (err) {
    log.warn({ err }, 'ignoring malformed credentials.json');
    return {};
  }
}

/** The stored key for a provider, or `undefined`. */
export function getCredential(provider: string): string | undefined {
  return loadCredentials()[provider];
}

/**
 * Persist a provider's key, merging into any existing entries. Writes atomically
 * (temp + rename) with mode `0600` so the secret is never world-readable and a
 * crash mid-write can't truncate the file. Best-effort: a write failure is
 * logged and swallowed (the key still works for the current session).
 */
export function saveCredential(provider: string, key: string): void {
  const next: Credentials = { ...loadCredentials(), [provider]: key };
  const path = credentialsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    log.warn({ err }, 'could not persist credentials.json');
  }
}
