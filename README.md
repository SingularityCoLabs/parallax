# Parallax

[![CI](https://github.com/SingularityCoLabs/parallax/actions/workflows/ci.yml/badge.svg)](https://github.com/SingularityCoLabs/parallax/actions/workflows/ci.yml)
[![Release](https://github.com/SingularityCoLabs/parallax/actions/workflows/publish.yml/badge.svg)](https://github.com/SingularityCoLabs/parallax/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/%40singularitycolabs%2Fparallax?label=npm%20next)](https://www.npmjs.com/package/@singularitycolabs/parallax)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A secure, extensible **agent runtime** with a CLI as its first interface. The model
proposes actions; deterministic code validates, authorizes, and executes them.

> Status: **v0.1 beta** — a working single-agent loop with typed tools,
> deterministic permissions, native file editing, shell execution, durable
> sessions, and fake plus OpenAI-compatible model providers.

## Requirements

- **Node.js ≥ 22.18** (uses the built-in `node:sqlite`).
- **pnpm** is required only when developing Parallax from source.

## Install

Install the beta CLI globally:

```bash
npm install --global @singularitycolabs/parallax@next
parallax --help
```

Or run it without a global installation:

```bash
npx --yes @singularitycolabs/parallax@next --help
```

Install the SDK in a Node.js project:

```bash
npm install @singularitycolabs/parallax@next
```

## Uninstall

Parallax keeps its state in `~/.parallax` (sessions database). The CLI can clean
that up and tell you how to remove the binary:

```bash
parallax uninstall --dry-run   # list exactly what would be deleted, delete nothing
parallax uninstall             # prompts before deleting; prints the removal command
parallax uninstall -y          # non-interactive
parallax uninstall --keep-data # keep your sessions; just print the removal command
```

Removing the package itself is left to the package manager you installed it with,
since the CLI can't know which one that was:

```bash
npm uninstall --global @singularitycolabs/parallax
```

`PARALLAX_HOME` and `PARALLAX_DB` are honored, so a relocated database is found
and removed too. Deletion refuses to touch your home directory, the current
directory, or a filesystem root regardless of how those variables are set.

## Try it

The fake provider ships scripted **demo** scenarios that drive the runtime through
real tools against a real workspace. Run the flagship "fix the failing test" flow
against a throwaway project:

```bash
demo_workspace="$(mktemp -d)"
printf 'export const sum = (a, b) => a - b;\n' > "$demo_workspace/sum.mjs"
printf "import assert from 'node:assert/strict';\nimport { sum } from './sum.mjs';\nassert.equal(sum(2, 3), 5);\n" > "$demo_workspace/test.mjs"
parallax demo edit-fix --cwd "$demo_workspace"

# non-interactive (auto-approve every side effect):
parallax demo edit-fix --cwd "$demo_workspace" -y

# read-only mode — the runtime technically blocks the edit/shell:
parallax demo edit-fix --cwd "$demo_workspace" --read-only

# list scenarios / sessions / replay a saved session:
parallax demo --list
parallax sessions
parallax resume <sessionId>
```

You approve each side effect (shell command, file edit) at the prompt; edits show a
diff first. Sessions persist to `~/.parallax/sessions.sqlite` unless `--no-persist`.

## Use a real model (NVIDIA NIM)

NVIDIA NIM exposes an **OpenAI-compatible** API, so Parallax drives it through a
generic OpenAI-compatible adapter (configurable base URL). Get a key at
[build.nvidia.com](https://build.nvidia.com) (it starts with `nvapi-`), then:

```bash
export PARALLAX_PROVIDER=nvidia
export NVIDIA_API_KEY=nvapi-...

# one-shot goal (approvals prompted; -y to auto-approve, --read-only to sandbox):
parallax run "Inspect this repo, run its tests, fix the failing one, and verify."

# interactive REPL (Ctrl-C cancels the in-flight turn; empty line / "exit" quits):
parallax chat

# pick a different tool-calling model:
parallax run "summarize package.json" -m nvidia/llama-3.1-nemotron-70b-instruct
```

Config resolves as `CLI flag > env > built-in default`:

| Variable                              | Purpose                    | Default                               |
| ------------------------------------- | -------------------------- | ------------------------------------- |
| `PARALLAX_PROVIDER`                   | `fake` or `nvidia`         | `fake`                                |
| `NVIDIA_API_KEY` / `PARALLAX_API_KEY` | API key                    | —                                     |
| `PARALLAX_MODEL` (or `-m`)            | model id                   | `meta/llama-3.3-70b-instruct`         |
| `PARALLAX_API_BASE_URL`               | OpenAI-compatible endpoint | `https://integrate.api.nvidia.com/v1` |

The provider is a drop-in `ModelProvider` — the runtime, tools, policy, and CLI are
unchanged whether the model is fake or real. Any other OpenAI-compatible endpoint
(vLLM, Ollama's `/v1`, etc.) works by pointing `PARALLAX_API_BASE_URL` at it.

## Develop

```bash
pnpm install
pnpm typecheck   # tsc --noEmit (strict)
pnpm lint        # eslint incl. architectural import-boundary rules
pnpm test        # vitest — no live APIs, temp dirs only
pnpm build       # emit the publishable ESM package to dist/
pnpm test:package # pack, install, and test the CLI + SDK as a consumer
pnpm format      # prettier
```

## What's here (v0.1)

- Event-driven runtime with a strict turn loop: `model → validate → policy →
approval → execute → persist → model`.
- Typed tool registry + Zod-validated inputs; unknown/invalid calls never execute.
- Native filesystem tools (`read_file`, `list_directory`, `search_files`,
  `write_file`, `edit_file`) with workspace-scoping, symlink-escape denial, and
  read-before-write stale checks.
- `shell` tool over a `HostExecutor` with timeout, output caps, cancellation, and
  process-group cleanup.
- Deterministic `ALLOW / ASK / DENY` policy with `read-only` and `workspace` modes.
- SQLite session persistence + resume.
- A fake, scriptable model provider for deterministic tests and demos, plus an
  OpenAI-compatible provider (NVIDIA NIM) for real inference.

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## Not in v0.1 (designed-for extension points)

Context compaction, TUI, MCP / skills / hooks, browser & web tools,
checkpoints/undo, subagents, and sandboxed executor backends.
The interfaces (`ModelProvider`, `Executor`, `ToolRegistry`, `SessionStore`) are
shaped so these slot in without reworking the runtime.

## Community

- Read [CONTRIBUTING.md](CONTRIBUTING.md) to set up a development environment and
  submit a change.
- Follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md) in project spaces.
- Use the [support guide](.github/SUPPORT.md) for questions and ordinary bugs.
- Report vulnerabilities privately by following the
  [security policy](.github/SECURITY.md). Do not open a public security issue.

## License

Parallax is available under the [MIT License](LICENSE).
