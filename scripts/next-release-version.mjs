import { Buffer } from 'node:buffer';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const releaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+)\.(0|[1-9]\d*))?$/;

function parseReleaseVersion(version) {
  const match = releaseVersionPattern.exec(version);
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    prereleaseNumber: match[5] === undefined ? undefined : Number(match[5]),
  };
}

function formatVersion({ major, minor, patch, prerelease, prereleaseNumber }) {
  const stable = `${major}.${minor}.${patch}`;
  if (prerelease === undefined) return stable;
  return `${stable}-${prerelease}.${prereleaseNumber}`;
}

/**
 * Return the next version for the release line declared in package.json.
 *
 * An explicitly selected, unpublished version is preserved. Once that version
 * exists on npm, prereleases increment their numeric suffix and stable releases
 * increment the patch number. Versions from other release lines are ignored.
 */
export function nextReleaseVersion(currentVersion, publishedVersions) {
  const current = parseReleaseVersion(currentVersion);
  if (!current) {
    throw new Error(
      `Unsupported package version "${currentVersion}". Use x.y.z or x.y.z-label.number.`,
    );
  }

  const published = new Set(publishedVersions);
  if (!published.has(currentVersion)) return currentVersion;

  if (current.prerelease !== undefined) {
    let highest = current.prereleaseNumber;

    for (const version of published) {
      const candidate = parseReleaseVersion(version);
      if (
        candidate?.major === current.major &&
        candidate.minor === current.minor &&
        candidate.patch === current.patch &&
        candidate.prerelease === current.prerelease &&
        candidate.prereleaseNumber !== undefined
      ) {
        highest = Math.max(highest, candidate.prereleaseNumber);
      }
    }

    return formatVersion({
      ...current,
      prereleaseNumber: highest + 1,
    });
  }

  let highestPatch = current.patch;
  for (const version of published) {
    const candidate = parseReleaseVersion(version);
    if (
      candidate?.major === current.major &&
      candidate.minor === current.minor &&
      candidate.prerelease === undefined
    ) {
      highestPatch = Math.max(highestPatch, candidate.patch);
    }
  }

  return formatVersion({
    ...current,
    patch: highestPatch + 1,
  });
}

async function readStandardInput() {
  if (process.stdin.isTTY) return '';

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const currentVersion = process.argv[2];
  if (!currentVersion) {
    throw new Error('Usage: next-release-version.mjs <current-version> < published-versions.json');
  }

  const input = (await readStandardInput()).trim();
  const parsed = input.length === 0 ? [] : JSON.parse(input);
  const publishedVersions = Array.isArray(parsed) ? parsed : [parsed];

  if (!publishedVersions.every((version) => typeof version === 'string')) {
    throw new Error('Published versions must be a JSON string or array of strings.');
  }

  process.stdout.write(`${nextReleaseVersion(currentVersion, publishedVersions)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
