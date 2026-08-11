# Releasing Parallax

Parallax uses two release paths in
[`publish.yml`](../.github/workflows/publish.yml):

| Branch        | Trigger                    | npm dist-tag | Purpose               |
| ------------- | -------------------------- | ------------ | --------------------- |
| `main`        | Push a new package version | `next`       | Public beta releases  |
| `development` | Manually run `publish.yml` | `dev`        | Development snapshots |

Daily development belongs on `development`. Promote tested work to `main` with a
pull request. The workflow creates release tags and GitHub Releases; do not use
GitHub's **New release** page.

## Repository setup

The npm trusted publisher is bound to this repository, the `publish.yml`
workflow, and the `npm` GitHub Environment. The environment allows deployments
from `main`, `development`, and release tags matching `v*`. Trusted publishing
uses GitHub OIDC, so no `NPM_TOKEN` secret is required.

## Automatically publishing from `main`

npm versions are immutable, so a normal commit whose `package.json` version is
already published cannot produce another package. The workflow safely skips
those commits. A commit containing a new version is automatically verified,
tagged, published, and represented by a GitHub Release.

### 1. Synchronize `development`

Before preparing a release, bring the most recent published version from `main`
into `development`:

```bash
git switch development
git pull --ff-only origin development
git merge origin/main
```

Resolve and test any merge conflicts before continuing.

### 2. Confirm the current beta version

```bash
node -p "require('./package.json').version"
npm view @singularitycolabs/parallax@next version
```

Both commands should print the same version. If they differ, synchronize with
`main` before bumping the version.

### 3. Bump and verify the next beta

```bash
pnpm version:beta
node -p "require('./package.json').version"
pnpm verify:release
git diff --check
```

For example, `0.1.0-beta.7` becomes `0.1.0-beta.8`. Do not create a tag locally.

### 4. Commit and promote the release

```bash
release_version="$(node -p "require('./package.json').version")"
git add package.json
git commit -m "release: v${release_version}"
git push origin development
```

Open a pull request from `development` to `main`. After it is reviewed and
merged, the `Publish package` workflow automatically:

1. Checks whether the exact npm version is new.
2. Runs `pnpm verify:release` against the `main` commit.
3. Creates the matching `v<version>` tag.
4. Publishes prereleases to npm `next` or stable versions to npm `latest`.
5. Creates the matching GitHub Release and generated release notes.

Verify the completed release with:

```bash
npm dist-tag ls @singularitycolabs/parallax
npm view @singularitycolabs/parallax@next version
gh release list --repo SingularityCoLabs/parallax --limit 5
npx --yes @singularitycolabs/parallax@next --version
```

## Manually publishing `development`

The development path publishes a unique version such as
`0.1.0-dev.<run-number>.<attempt>` under the npm `dev` dist-tag. It does not
change `package.json`, create a Git tag, or create a GitHub Release.

Push the branch and make sure its CI run passes:

```bash
git switch development
git pull --ff-only origin development
git push origin development
```

Then open **Actions → Publish package → Run workflow**, choose the
`development` branch, and run it. Alternatively:

```bash
gh workflow run publish.yml \
  --repo SingularityCoLabs/parallax \
  --ref development
```

The workflow rejects manual runs from every other branch. After it succeeds:

```bash
npm dist-tag ls @singularitycolabs/parallax
npm view @singularitycolabs/parallax@dev version
npx --yes @singularitycolabs/parallax@dev --version
```

## Publishing a stable version

When the beta is ready, set a stable SemVer version without a hyphen on
`development`, run `pnpm verify:release`, and promote it to `main` through a pull
request. Stable versions are published to npm `latest` and create a normal
GitHub Release instead of a prerelease.

## Failure handling

### A main commit is skipped

The version in `package.json` is already on npm and belongs to an earlier commit.
Bump to a new unused version on `development`, verify it, and promote it to
`main`.

### A tag exists but npm publication failed

Rerun the failed workflow. If the tag points to the same commit, the workflow
reuses it and retries verification and publication.

### npm publication succeeds but GitHub Release creation fails

Rerun the failed workflow. It recognizes the npm version and tag from the same
commit, skips duplicate publication, and creates the missing GitHub Release.

### The GitHub Environment rejects a deployment

In **Settings → Environments → npm → Deployment branches and tags**, confirm
that `main` and `development` are branch rules and `v*` is a tag rule.

### npm authentication fails

Confirm that npm trusted publishing names `publish.yml` exactly and uses the
`npm` environment. The publish jobs require `id-token: write`, Node.js 24, npm
11.5.1 or newer, and a GitHub-hosted runner.
