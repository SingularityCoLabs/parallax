# Contributing to Parallax

Thank you for helping improve Parallax. Contributions of code, tests,
documentation, bug reports, and design feedback are welcome.

## Before you start

- Follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).
- Search existing issues before opening a new one.
- Use the issue forms for bugs, feature requests, and questions.
- Discuss substantial behavior or architecture changes in an issue before doing
  extensive implementation work.
- Report vulnerabilities through the [security policy](.github/SECURITY.md), not
  through a public issue or pull request.

## Development setup

You need Node.js 22.18 or newer and pnpm 10.

```bash
git clone https://github.com/SingularityCoLabs/parallax.git
cd parallax
corepack enable
pnpm install --frozen-lockfile
```

Create a focused branch from the latest `development` branch:

```bash
git switch development
git pull --ff-only origin development
git switch -c fix/short-description
```

No API key is needed for the test suite; tests use the deterministic fake model
provider and temporary directories.

## Making changes

- Keep each change focused and avoid unrelated refactors.
- Add or update tests for observable behavior changes and bug fixes.
- Update the README or relevant document when behavior, configuration, or safety
  guarantees change.
- Preserve the dependency boundaries described in
  [docs/architecture.md](docs/architecture.md).
- Treat policy evaluation, approvals, workspace containment, shell execution,
  secret redaction, and session persistence as security-sensitive surfaces.
- Never commit credentials, local session databases, generated coverage, or
  machine-specific configuration.

Format the repository and run the complete local validation suite before opening
a pull request:

```bash
pnpm format
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
```

## Commits and pull requests

- Write a concise, imperative commit subject. Conventional prefixes such as
  `feat:`, `fix:`, `docs:`, and `test:` are welcome but not required.
- Explain why the change is needed, not only what files changed.
- Link the relevant issue with `Closes #123` when applicable.
- Complete the pull request template, including the security-impact section and
  exact validation evidence.
- Target ordinary feature and fix pull requests at `development`. Maintainers
  promote tested changes from `development` to `main` for release preparation.
- Keep pull requests reviewable; split unrelated work into separate changes.
- Respond to review feedback with follow-up commits. Maintainers may squash the
  final history when merging.

## Releases

Maintainers should follow the [release guide](docs/releasing.md). After a merge
to `main` passes the complete main CI matrix, it automatically selects the next
package version, verifies and publishes the artifact, and creates the matching
tag and GitHub Release. Do not bump normal beta versions or create GitHub
Releases manually.

## Licensing

By submitting a contribution, you agree that it may be distributed under the
project's [MIT License](LICENSE). No separate contributor license agreement is
required.
