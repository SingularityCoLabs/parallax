# Releasing Parallax

Parallax releases are published from version tags by
[`publish.yml`](../.github/workflows/publish.yml). Pushing a tag publishes the
package to npm with provenance and creates the matching GitHub Release. Do not
create the GitHub Release manually.

## Release channels

The version in `package.json` and the Git tag must match exactly, with `v` added
to the tag.

| Package version | Git tag         | npm dist-tag | GitHub release |
| --------------- | --------------- | ------------ | -------------- |
| `0.1.0-beta.8`  | `v0.1.0-beta.8` | `next`       | Pre-release    |
| `0.1.0`         | `v0.1.0`        | `latest`     | Stable release |

Never reuse a version that npm has already published, and never move a published
release tag. Skipped prerelease numbers are harmless.

## Prerequisites

- You have permission to push to `main` and create tags.
- The change being released is committed and pushed to `main`.
- The `main` CI workflow is successful.
- The npm trusted publisher is configured for this repository,
  `.github/workflows/publish.yml`, and the `npm` GitHub Environment.
- The `npm` Environment allows tags matching `v*`. It must be a tag rule, not a
  branch rule.

Trusted publishing uses GitHub OIDC. No `NPM_TOKEN` repository or environment
secret is required.

## Release procedure

### 1. Start from a clean, current `main`

```bash
git switch main
git pull --ff-only origin main
git status --short
```

`git status --short` must print nothing. Confirm that the latest `main` CI run is
successful before continuing.

### 2. Choose the next unused version

List the versions already published to npm:

```bash
npm view @singularitycolabs/parallax versions --json
npm dist-tag ls @singularitycolabs/parallax
```

Set the version you intend to publish. Replace the example value with the next
unused version:

```bash
release_version="0.1.0-beta.8"
npm version "$release_version" --no-git-tag-version
node -p "require('./package.json').version"
```

`--no-git-tag-version` is required. It changes the manifest without creating a
commit or tag prematurely.

### 3. Verify the exact package artifact

```bash
pnpm verify:release
git diff --check
git diff -- package.json
```

The release verification formats, typechecks, lints, tests, builds, packs,
installs, and exercises the CLI and SDK from the generated tarball. Do not
continue if any check fails.

### 4. Commit and push the version bump

```bash
release_version="$(node -p "require('./package.json').version")"
git add package.json
git commit -m "release: v${release_version}"
git push origin main
```

Wait for the new `main` CI run to complete successfully. The release tag must
point to this version-bump commit, not the preceding feature commit.

You can find the run from the terminal:

```bash
gh run list \
  --repo SingularityCoLabs/parallax \
  --workflow CI \
  --branch main \
  --limit 1
```

### 5. Create and push the tag

After CI succeeds, synchronize and derive the tag from the committed manifest:

```bash
git switch main
git pull --ff-only origin main
git fetch --tags origin

release_version="$(node -p "require('./package.json').version")"
release_tag="v${release_version}"

git status --short
git tag --list "$release_tag"
```

The working tree must be clean, and `git tag --list` must print nothing. Then:

```bash
git tag -a "$release_tag" -m "Release ${release_tag}"
git push origin "$release_tag"
```

Do not change the version after tagging. The publish workflow reads
`package.json` from the tagged commit and rejects any mismatch.

### 6. Monitor and verify publication

The tag push triggers the `Publish package` workflow. It will:

1. Install dependencies from the lockfile.
2. Run `pnpm verify:release` against the tagged commit.
3. Verify that `v${package.version}` equals the Git tag.
4. Publish prereleases to npm `next` or stable versions to npm `latest`.
5. Create the corresponding GitHub Release and generated release notes.

After the workflow succeeds, verify both destinations:

```bash
release_version="$(node -p "require('./package.json').version")"
release_tag="v${release_version}"

npm view "@singularitycolabs/parallax@${release_version}" version
npm dist-tag ls @singularitycolabs/parallax
gh release view "$release_tag" --repo SingularityCoLabs/parallax
```

For a prerelease, verify the public CLI through the `next` channel:

```bash
npx --yes @singularitycolabs/parallax@next --version
```

## If a release fails

### Tag and package version do not match

The tag was created before the version-bump commit or used a different version.
Rerunning the workflow will not help because a tag always points to the same
commit.

Inspect the version stored in the tagged commit:

```bash
git show v0.1.0-beta.8:package.json | node -e \
  "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => console.log(JSON.parse(input).version));"
```

The safest recovery is to increment to the next unused prerelease version,
repeat the release procedure, and leave the failed tag as historical evidence.
Never move a tag after its package or GitHub Release has been published.

### npm reports that the version already exists

npm versions are immutable. Increment the package version, commit it, wait for
CI, and create a new matching tag.

### The GitHub Environment rejects the tag

In repository settings, open **Environments → npm → Deployment branches and
tags**. Confirm that `v*` appears as an allowed **tag** pattern. No environment
secret is needed for trusted publishing.

### The GitHub Release already exists

Do not use GitHub's manual **New release** page. The workflow creates the release
only after npm publishing succeeds. If someone manually created a release for an
unpublished version, remove that manual release before retrying with a new,
unused version.
