import { readFileSync } from 'node:fs';

interface PackageManifest {
  version?: unknown;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
  throw new Error('Parallax package metadata does not contain a valid version.');
}

/** The package version from the single authoritative package.json manifest. */
export const VERSION = manifest.version;
