# Architecture

Parallax is an agent **runtime** that happens to have a CLI. The runtime is
independent of the terminal, and tool authorization/execution is deterministic
code that lives outside the model. That single rule (blueprint §53) is what lets
the model, UI, database, and executor all change without a rewrite.

## The one invariant

> The model **proposes**; deterministic code **decides and executes**.

The model may propose a tool, arguments, a plan, an edit, a command. It never
decides whether it is authorized. The runtime owns validation, path/command
normalization, permissions, timeouts, output limits, persistence, and cancellation.

## Layers

Code is one package with modular directories under `src/`. Boundaries are enforced
by ESLint import rules (`eslint.config.js`), so the seams are real even without a
multi-package split. Each layer may only import the layers below it:

```
cli            → app, protocol, config              (a thin client; executes no tools)
app            → everything                          (the ONLY composition root)
runtime        → providers, tools, policy, executor, context, sessions (via interfaces)
context        → tools(core), providers
policy         → tools(core)
tools/*        → executor, config, protocol, observability
sessions       → protocol, observability, config
executor       → protocol, observability, config
providers      → protocol, observability
protocol, observability → (leaves)
```

- **protocol** — wire vocabulary: ids, `ToolCall`/`ToolResult`, risk enums,
  permission mode, approval types, and the `RuntimeEvent` discriminated union
  (each event has a Zod schema; the union is the product contract).
- **providers** — the `ModelProvider` interface, normalized `ModelEvent` stream,
  and the deterministic `FakeModelProvider`. A real adapter implements the same
  interface; the runtime never branches on vendor specifics.
- **tools/core** — `ToolDefinition` (name, Zod `inputSchema`, `risk`,
  `resourceClass`, optional `describe`, `execute`), the `ToolRegistry`, error
  codes, and bounded-text truncation.
- **tools/fs** — native file tools + the workspace path resolver + the
  read-before-write file-state cache.
- **tools/shell** — the `shell` tool, delegating process control to `executor`.
- **policy** — the `ALLOW/ASK/DENY` engine + command-risk classifier.
- **executor** — the `Executor` interface and `HostExecutor` (process lifetime
  control; **not** a security sandbox).
- **context** — builds the bounded, model-visible request from durable history.
- **sessions** — the `SessionStore` interface with in-memory and SQLite backends.
- **runtime** — the turn loop and everything that coordinates the above.
- **app** — the composition root; wires concrete instances and exposes
  `createRuntime`, `defaultToolset`, and the demo/sessions helpers.
- **cli** — renders events, prompts for approvals. No provider/tool/DB logic.

## The turn loop (`runtime/TurnController`)

Ordering is the contract (blueprint §9.2). For each step, bounded by `maxSteps`:

```
build bounded context  →  stream from model  →  emit assistant deltas
for each proposed tool call:
  registry.has?            → unknown_tool (no execution)
  inputSchema.safeParse    → validation_error (no execution)
  tool.describe()          → resolve paths / build diff preview / detect escape
  policy.evaluate()        → allow | ask | deny
    deny                   → failed result, no execution
    ask                    → emit approval.requested, AWAIT resolution (barrier)
                             deny → failed result; allow → continue
  scheduler.execute()      → run the tool (sequential in v0.1)
  persist result + feed the tool output back to the model
no tool calls              → turn.completed
```

Cancellation is checked between every step and honored inside the model stream and
the executor. The approval waiter is registered **before** the request event is
emitted, so a synchronous responder cannot race ahead of the barrier.

## Events (`protocol/events.ts`)

The runtime emits typed events instead of calling UI code:
`session.started`, `turn.started`, `model.started`, `assistant.delta`,
`model.completed`, `tool.proposed`, `approval.requested`, `approval.resolved`,
`tool.started`, `tool.stdout`, `tool.stderr`, `tool.completed`, `tool.failed`,
`turn.completed`, `turn.cancelled`, `turn.failed`.

The `EventBus` stamps `v`/`seq`/`timestamp`, persists the event, then fans out to
subscribers. `seq` is a per-session monotonic counter — the authoritative order for
persistence and replay. The CLI renderer, the approval prompt, tests, and (later) a
TUI or headless JSON client all consume this one stream.

## State vs. context

Durable history (all messages, tool calls, events, approvals) lives in the
`SessionStore`. The **context** the model sees is a _bounded projection_ built each
step: fixed system prompt + recent messages + tool schemas + truncated tool results.
Compaction never destroys persisted history — it only changes the model-visible view.

## Extension seams

Swap or add without touching the loop: a real `ModelProvider`; a sandboxed
`Executor` (bubblewrap/seatbelt/container/remote); more `ToolDefinition`s
(MCP adapters, web, a dedicated `python` tool); an alternate `SessionStore`; and a
second UI client (TUI, desktop, IDE, headless) subscribing to the same events.
