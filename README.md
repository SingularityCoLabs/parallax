# Parallax

A secure, extensible **agent runtime** with a CLI as its first interface. The model
proposes actions; deterministic code validates, authorizes, and executes them.

> Status: **v0.1** — a working single-agent loop with typed tools, deterministic
> permissions, native file editing, shell execution, and durable sessions. Driven
> by a deterministic **fake** model provider (no vendor SDK / API key required).
> A real provider slots into the `ModelProvider` seam without touching the loop.

## Requirements

- **Node.js ≥ 22.6** (uses native TypeScript type-stripping to run `.ts` directly,
  and the built-in `node:sqlite`). Developed on Node 26.
- **pnpm**.

## Install

```bash
pnpm install
```

## Try it

The fake provider ships scripted **demo** scenarios that drive the runtime through
real tools against a real workspace. Run the flagship "fix the failing test" flow
against a throwaway copy of the fixture:

```bash
# copy the fixture somewhere writable
cp -r tests/fixtures/sum-project /tmp/sum && \
  pnpm agent demo edit-fix --cwd /tmp/sum

# non-interactive (auto-approve every side effect):
pnpm agent demo edit-fix --cwd /tmp/sum -y

# read-only mode — the runtime technically blocks the edit/shell:
pnpm agent demo edit-fix --cwd /tmp/sum --read-only

# list scenarios / sessions / replay a saved session:
pnpm agent demo --list
pnpm agent sessions
pnpm agent resume <sessionId>
```

You approve each side effect (shell command, file edit) at the prompt; edits show a
diff first. Sessions persist to `~/.parallax/sessions.sqlite` unless `--no-persist`.

## Develop

```bash
pnpm typecheck   # tsc --noEmit (strict)
pnpm lint        # eslint incl. architectural import-boundary rules
pnpm test        # vitest — no live APIs, temp dirs only
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
- A fake, scriptable model provider for deterministic tests and demos.

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## Not in v0.1 (designed-for extension points)

Real vendor provider adapter, context compaction, TUI, MCP / skills / hooks,
browser & web tools, checkpoints/undo, subagents, and sandboxed executor backends.
The interfaces (`ModelProvider`, `Executor`, `ToolRegistry`, `SessionStore`) are
shaped so these slot in without reworking the runtime.
