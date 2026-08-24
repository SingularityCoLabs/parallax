# Parallax

[![CI](https://github.com/SingularityCoLabs/parallax/actions/workflows/ci.yml/badge.svg)](https://github.com/SingularityCoLabs/parallax/actions/workflows/ci.yml)
[![Release](https://github.com/SingularityCoLabs/parallax/actions/workflows/publish.yml/badge.svg)](https://github.com/SingularityCoLabs/parallax/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/%40singularitycolabs%2Fparallax?label=npm%20next)](https://www.npmjs.com/package/@singularitycolabs/parallax)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A secure, extensible **agent runtime** with a CLI as its first interface. The model
proposes actions; deterministic code validates, authorizes, and executes them.

> Status: **v0.1 beta** — a working single-agent loop with typed tools,
> deterministic permissions, native file editing, shell execution, durable
> sessions, a **Claude Code-like terminal UI** (React + Ink), and an
> **OpenCode-style model catalog** (models.dev) across fake, Anthropic, and
> OpenAI-compatible providers.

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

## Use a real model

Parallax talks to many providers through a small provider registry. Pick one with
`PARALLAX_PROVIDER`, set that provider's API key, and go:

| Provider      | `PARALLAX_PROVIDER` | API key env          | Default model                 |
| ------------- | ------------------- | -------------------- | ----------------------------- |
| Anthropic     | `anthropic`         | `ANTHROPIC_API_KEY`  | `claude-opus-4-8`             |
| OpenAI        | `openai`            | `OPENAI_API_KEY`     | `gpt-4o`                      |
| NVIDIA NIM    | `nvidia`            | `NVIDIA_API_KEY`     | `meta/llama-3.3-70b-instruct` |
| OpenRouter    | `openrouter`        | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.5` |
| Moonshot/Kimi | `moonshot`          | `MOONSHOT_API_KEY`   | `kimi-k2-0711-preview`        |
| Custom        | `custom`            | `PARALLAX_API_KEY`   | (set `PARALLAX_API_BASE_URL`) |

Every provider except Anthropic speaks the OpenAI wire format, so any
OpenAI-compatible endpoint (a local vLLM, Ollama's `/v1`, a proxy) works via
`PARALLAX_PROVIDER=custom` + `PARALLAX_API_BASE_URL`. Anthropic uses its native
`/v1/messages` API. Either way the runtime, tools, policy, and CLI are unchanged —
the provider is a drop-in `ModelProvider`.

```bash
export PARALLAX_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# start the agent (interactive; this is what bare `parallax` does):
parallax

# one-shot goal (approvals prompted; -y to auto-approve, --read-only to sandbox):
parallax run "Inspect this repo, run its tests, fix the failing one, and verify."

# pick a provider and model up front:
parallax run "summarize package.json" -p openai -m gpt-4o
parallax run "summarize package.json" -p nvidia -m meta/llama-3.1-nemotron-70b-instruct
```

### Switch models mid-chat

On a real terminal, `parallax` opens a **Claude Code-like TUI** (React + Ink): a
scrolling transcript with streaming responses and tool blocks, an interactive
approval menu, a bordered prompt with slash-command autocomplete, and a status
footer. (Piped/non-TTY input and `parallax run` use a plain line renderer; force
it anywhere with `PARALLAX_NO_TUI=1`.)

Slash commands change the model or provider **without losing the conversation** —
the history carries over to the new model:

```
> /providers                       list providers and which have a key
> /models                          list models for the current provider (with price/context)
> /provider openai                 switch provider (uses its default model)
> /model anthropic/claude-sonnet-4-6   switch provider + model in one step
> /model gpt-4o                    switch model on the current provider
> /mode plan                       switch permission mode (or Shift+Tab to cycle)
> /sessions                        list persisted sessions
> /help                            show all commands
```

Keys: **Shift+Tab** cycles the permission mode (`workspace → plan → read-only`),
**Esc**/**Ctrl-C** cancels the in-flight turn (or quits when idle), **↑/↓** walk
input history, **Tab** completes a slash command. At an approval prompt, choose
**Yes**, **Yes and don't ask again** (remembers the tool for the session), or **No**.

Resume a past session straight into the UI, transcript and all:

```bash
parallax resume <sessionId>        # reopens interactively; continue the conversation
parallax resume <sessionId> --print   # just replay the transcript to stdout
```

A switch to a provider whose key is missing prints setup guidance and keeps the
current model — the session keeps working.

Prefer not to export variables? Put them in a `.env` file in your working
directory — Parallax loads it automatically, and `.env` is git-ignored:

```bash
cp .env.example .env   # then fill in your key
```

Config resolves as `CLI flag > env > parallax.json > built-in default`:

| Variable                                  | Purpose                                 | Default                       |
| ----------------------------------------- | --------------------------------------- | ----------------------------- |
| `PARALLAX_PROVIDER` (or `-p`)             | provider id (see table above)           | `fake`                        |
| `<PROVIDER>_API_KEY` / `PARALLAX_API_KEY` | API key for the provider                | —                             |
| `TAVILY_API_KEY`                          | API key for the `web_search` tool       | —                             |
| `PARALLAX_MODEL` (or `-m`)                | model id                                | provider's default            |
| `PARALLAX_API_BASE_URL`                   | override the OpenAI-compatible endpoint | provider's default            |
| `PARALLAX_MODELS_URL`                     | models.dev catalog endpoint             | `https://models.dev/api.json` |
| `PARALLAX_DISABLE_MODELS_FETCH`           | use only the bundled catalog snapshot   | (fetch enabled)               |
| `PARALLAX_NO_TUI`                         | force the plain renderer on a TTY       | (TUI on a TTY)                |

### Model catalog & custom providers (OpenCode-style)

Parallax's provider list is enriched from [models.dev](https://models.dev):
per-model **cost**, **context/output limits**, and **capabilities**, fetched once
and cached under `~/.parallax/models.json` (with a background refresh). It works
fully offline from a **bundled snapshot** — the network only augments it.

Define your own provider or override models in a `parallax.json` (in the current
directory or `~/.parallax/`):

```json
{
  "provider": "myvllm",
  "providers": {
    "myvllm": {
      "name": "My local vLLM",
      "baseURL": "http://localhost:8000/v1",
      "env": ["MYVLLM_API_KEY"],
      "wire": "openai",
      "defaultModel": "llama-3-8b",
      "models": { "llama-3-8b": { "name": "Llama 3 8B", "limitContext": 8192 } }
    }
  }
}
```

Precedence is `parallax.json` > models.dev cache > bundled snapshot for metadata,
and `CLI flag > env > parallax.json` for the active provider/model.

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

Development snapshots are published manually from the `development` branch and
can be installed with `npm install @singularitycolabs/parallax@dev`. Public beta
releases are automated from `main`; see the [release guide](docs/releasing.md).

## What's here (v0.1)

- Event-driven runtime with a strict turn loop: `model → validate → policy →
approval → execute → persist → model`.
- Typed tool registry + Zod-validated inputs; unknown/invalid calls never execute.
- Native filesystem tools (`read_file`, `list_directory`, `search_files`,
  `write_file`, `edit_file`) with workspace-scoping, symlink-escape denial, and
  read-before-write stale checks.
- `shell` tool over a `HostExecutor` with timeout, output caps, cancellation, and
  process-group cleanup.
- Planning + task tools: `update_todos` (a live task checklist) and `present_plan`
  (a Claude Code-style plan gate — approving it exits plan mode straight into
  workspace mode so execution continues in the same turn).
- Web tools: `web_search` (via Tavily) and `web_fetch` (URL → readable text),
  classified as `network` risk with SSRF guards (localhost / private / link-local
  and cloud-metadata targets are refused, redirects re-validated).
- Deterministic `ALLOW / ASK / DENY` policy with `read-only`, `workspace`, and
  `plan` modes; approvals support "allow once" and "allow always" (remembered
  per session).
- SQLite session persistence + resume (interactive or `--print`).
- A **Claude Code-like terminal UI** (React + Ink): streaming transcript, tool
  blocks with live output + diffs, an interactive approval menu, a bordered
  prompt with slash-command autocomplete, permission-mode cycling, and a status
  footer. Non-TTY falls back to a plain line renderer.
- An **OpenCode-style model catalog** enriched from [models.dev](https://models.dev)
  (cost/limits/capabilities) with a bundled offline snapshot and a `parallax.json`
  for custom providers/overrides.
- A fake, scriptable model provider for deterministic tests and demos, plus real
  providers via the registry: a native Anthropic (Claude) adapter and an
  OpenAI-compatible adapter (OpenAI, NVIDIA NIM, OpenRouter, Moonshot/Kimi, or any
  compatible endpoint), switchable at runtime with `/model` and `/provider`.

See [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md),
and the maintainer [release guide](docs/releasing.md).

## Not in v0.1 (designed-for extension points)

Context compaction, MCP / skills / hooks, browser automation,
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
