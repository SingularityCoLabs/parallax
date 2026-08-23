# Releasing Parallax

Parallax uses two release paths in
[`publish.yml`](../.github/workflows/publish.yml):

| Branch        | Trigger                  | npm dist-tag | Purpose               |
| ------------- | ------------------------ | ------------ | --------------------- |
| `main`        | Every push or PR merge   | `next`       | Public beta releases  |
| `development` | Manual workflow dispatch | `dev`        | Development snapshots |

Daily work belongs on `development`. Promote tested work to `main` with a pull
request. Do not create npm versions, Git tags, or GitHub Releases for normal beta
releases; the workflow owns those operations.

## Repository setup

The npm trusted publisher is bound to this repository, the `publish.yml`
workflow, and the `npm` GitHub Environment. The environment allows deployments
from `main`, `development`, and release tags matching `v*`. Trusted publishing
uses GitHub OIDC, so no `NPM_TOKEN` secret is required.

The main publish job has `contents: write` permission so it can record the
selected version and push its matching tag. If branch protection is added later,
GitHub Actions must be allowed to create the generated release commit.

## Automatic releases from `main`

Every new `main` push must either complete a release or fail visibly. A main run
no longer succeeds by silently skipping an already-published version.

The version in `package.json` selects the release line:

- If that exact version has not been published, the workflow uses it.
- If `x.y.z-beta.n` is already published, the workflow selects one higher than
  the highest published `beta` number for the same `x.y.z` release line.
- If a stable `x.y.z` is already published, the workflow selects the next unused
  patch version in the same `x.y` release line.
- `dev` snapshots and versions from other release lines do not affect this
  calculation.

After choosing the version, the workflow:

1. Updates `package.json` in the runner.
2. Runs `pnpm verify:release`, including a clean packed-package consumer test.
3. Creates a generated `chore(release): v<version> [skip ci]` commit when the
   manifest version changed.
4. Atomically pushes the release commit and matching `v<version>` tag.
5. Publishes prereleases to npm `next`, or stable versions to npm `latest`, with
   provenance through trusted publishing.
6. Creates the matching GitHub Release and generated release notes.

The atomic Git push prevents npm publication if another main update races with
the release. A rerun recognizes a tag or generated release commit belonging to
the original main push and resumes the same version instead of incrementing it
again.

## Normal development-to-release flow

Work and run the full local verification on `development`:

```bash
git switch development
git pull --ff-only origin development

# Make the code changes, then:
pnpm verify:release
git diff --check
git add -A
git commit -m "feat: describe the change"
git push origin development
```

Open a pull request from `development` to `main`, wait for CI, review it, and
merge it. The resulting main push automatically creates the next npm release.
No manual version-bump commit is needed for a normal beta.

Follow the release live:

```bash
gh run list \
  --repo SingularityCoLabs/parallax \
  --workflow publish.yml \
  --limit 5
```

Verify the completed release:

```bash
npm dist-tag ls @singularitycolabs/parallax
npm view @singularitycolabs/parallax@next version gitHead
gh release list --repo SingularityCoLabs/parallax --limit 5
npx --yes @singularitycolabs/parallax@next --version
```

## Starting a new release line

The workflow automatically increments within the line declared in
`package.json`; it does not guess when the project should change minor, major, or
prerelease labels. Select a new line deliberately on `development`, for example:

```bash
git switch development
git pull --ff-only origin development
npm version 0.2.0-beta.0 --no-git-tag-version
pnpm verify:release
git add package.json
git commit -m "release: start v0.2.0 beta"
git push origin development
```

After that change reaches `main`, `0.2.0-beta.0` is published first and later
main merges automatically advance to `0.2.0-beta.1`, `0.2.0-beta.2`, and so on.

To publish a stable release, deliberately set an unpublished stable version such
as `0.2.0` on `development`, verify it, and promote it through the same pull
request flow. Stable releases use npm `latest` and create a normal GitHub Release.

## Manually publishing `development`

The development path publishes a unique version such as
`0.1.0-dev.<run-number>.<attempt>` under the npm `dev` dist-tag. It does not
change `package.json`, create a Git tag, or create a GitHub Release.

Push `development` and make sure CI passes, then open **Actions → Publish
package → Run workflow**, choose `development`, and run it. Alternatively:

```bash
gh workflow run publish.yml \
  --repo SingularityCoLabs/parallax \
  --ref development
```

The workflow rejects manual runs from every other branch. Verify a successful
snapshot with:

```bash
npm view @singularitycolabs/parallax@dev version
npx --yes @singularitycolabs/parallax@dev --version
```

## Failure handling

### Verification fails

No tag or npm package is created. Fix the source on `development`, promote it to
`main`, and let the new main run publish it.

### The release commit or tag push fails

Nothing is published to npm because the atomic Git update happens first. Rerun
the failed job after resolving a competing main update or branch rule.

### A tag exists but npm publication failed

Rerun the failed workflow. It reuses the version associated with that main push,
re-verifies the artifact, and retries publication.

### npm succeeds but GitHub Release creation fails

Rerun the failed workflow. It recognizes that the exact npm version already
exists and creates only the missing GitHub Release.

### The GitHub Environment rejects a deployment

In **Settings → Environments → npm → Deployment branches and tags**, confirm
that `main` and `development` are branch rules and `v*` is a tag rule.

### npm authentication fails

Confirm that npm trusted publishing names `publish.yml` exactly and uses the
`npm` environment. The publish jobs require `id-token: write`, Node.js 24, npm
11.5.1 or newer, and a GitHub-hosted runner.
