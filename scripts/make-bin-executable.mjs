import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * `tsc` emits every file as 0644, so the CLI entry lands without its execute
 * bit even though it carries a `#!/usr/bin/env node` shebang. Running it — via
 * `npm link`, a direct path, or a symlink on PATH — then fails with
 * "permission denied". npm chmods bin entries when installing from a tarball,
 * which masks this, so it only shows up for linked/local installs.
 *
 * This makes the emitted binary executable as part of the build.
 */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

const binEntries = Object.values(manifest.bin ?? {});
if (binEntries.length === 0) {
  throw new Error('package.json declares no "bin" entries to make executable.');
}

for (const relativePath of binEntries) {
  const binPath = resolve(projectRoot, relativePath);
  if (!binPath.startsWith(projectRoot)) {
    throw new Error(`Refusing to chmod outside the project: ${binPath}`);
  }
  if (!existsSync(binPath)) {
    throw new Error(`Declared bin is missing from the build output: ${relativePath}`);
  }

  const source = readFileSync(binPath, 'utf8');
  if (!source.startsWith('#!')) {
    throw new Error(`Declared bin has no shebang and cannot be executed: ${relativePath}`);
  }

  chmodSync(binPath, 0o755);
  process.stdout.write(`chmod 755 ${relativePath}\n`);
}
