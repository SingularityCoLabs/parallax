import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(import.meta.dirname, '../scripts/next-release-version.mjs');

function nextReleaseVersion(currentVersion: string, publishedVersions: string[]) {
  const result = spawnSync(process.execPath, [scriptPath, currentVersion], {
    encoding: 'utf8',
    input: JSON.stringify(publishedVersions),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim();
}

describe('nextReleaseVersion', () => {
  it('keeps an explicitly selected unpublished beta', () => {
    expect(nextReleaseVersion('0.2.0-beta.0', ['0.1.0-beta.8'])).toBe('0.2.0-beta.0');
  });

  it('increments the highest published beta in the current release line', () => {
    expect(
      nextReleaseVersion('0.1.0-beta.8', [
        '0.1.0-beta.7',
        '0.1.0-beta.8',
        '0.1.0-beta.10',
        '0.1.0-dev.99',
        '0.2.0-beta.20',
      ]),
    ).toBe('0.1.0-beta.11');
  });

  it('increments a published stable version as a patch release', () => {
    expect(nextReleaseVersion('1.4.2', ['1.4.2', '1.4.4', '2.0.0'])).toBe('1.4.5');
  });

  it('rejects versions that cannot be advanced safely', () => {
    const result = spawnSync(process.execPath, [scriptPath, '0.1.0-beta'], {
      encoding: 'utf8',
      input: '[]',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unsupported package version/);
  });
});
