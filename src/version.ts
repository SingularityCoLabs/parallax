import { readFileSync } from 'node:fs';

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
  throw new Error('Parallax package metadata does not contain a valid version.');
}
if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  throw new Error('Parallax package metadata does not contain a valid name.');
}

/** The package version from the single authoritative package.json manifest. */
export const VERSION = manifest.version;

/** The published package name — used by `parallax uninstall` to print the right command. */
export const PACKAGE_NAME = manifest.name;
