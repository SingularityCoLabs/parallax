import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
};
const binPath = join(projectRoot, manifest.bin.parallax!);

/**
 * `npm link` and direct execution use the build output as-is, so the emitted
 * binary must carry its own execute bit. (Installing from a tarball masks this:
 * npm chmods bin entries itself, which is why a packaging test cannot catch it.)
 *
 * Skipped when dist/ is absent so `pnpm test` works on a clean checkout.
 */
describe.skipIf(!existsSync(binPath))('build output', () => {
  it('emits an executable CLI with a shebang', () => {
    expect(readFileSync(binPath, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    // tsc emits 0644; the build must chmod it or `parallax` is "permission denied".
    expect(statSync(binPath).mode & 0o111).toBeTruthy();
  });

  it('can be executed directly by path', () => {
    const result = spawnSync(binPath, ['--version'], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
