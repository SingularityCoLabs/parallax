# Security model (v0.1)

Parallax runs a model that proposes side effects. The security posture is: the
model can _ask_, but deterministic code _decides_, and dangerous operations are
gated behind explicit human approval. This documents what is and isn't protected
in v0.1, and the threat model behind it.

## What protects you today

### Deterministic permissions (`policy/`)

Every tool call passes through `PolicyEngine.evaluate()` before execution. It
returns `allow`, `ask`, or `deny` from tool metadata (`risk`) and the normalized
action — the model has no say. Modes:

- **read-only** — reads are allowed; every mutating/side-effecting tool is
  **denied** (technically, not by asking the model nicely).
- **workspace** (default) — reads allowed; writes, edits, and shell commands
  require approval; anything escaping the workspace is denied.

A prompt is not a permission system. Untrusted file/web content is data, never
authority (blueprint §19.2, §31).

### Workspace path safety (`tools/fs/paths.ts`)

Paths are never checked by string prefix. Each path is resolved to an absolute
path, then **realpath-resolved** (following symlinks) and compared, segment-aware,
against the canonical workspace root. For files that don't exist yet (new writes),
the nearest existing ancestor is realpath-resolved so a symlinked parent that
points outside the workspace is caught. Result: `../` traversal, absolute-path
escapes, and symlink escapes are all denied — verified in `tests/fs.test.ts`.

### Read-before-write (`tools/fs/fileState.ts`)

`write_file` (overwrite) and `edit_file` require the file to have been read in the
session and to be **unchanged on disk** since. If an external editor/process
modified it, the operation fails with `stale_file` and the model must re-read. This
prevents clobbering concurrent human/IDE edits with stale model context.

### Approval barrier (`runtime/`)

When policy says `ask`, the runtime emits `approval.requested` and **blocks** until
the UI resolves it. No write or command runs before the decision. The waiter is
registered before the event is emitted, so no resolution can be lost to a race.

**Fail closed:** on cancellation or teardown, all pending approvals resolve to
`deny`. In non-interactive contexts an unanswered `ask` denies (optionally after
`approvalAutoDenyMs`) — the runtime never silently auto-approves because no UI is
present (blueprint §24).

### Process control (`executor/HostExecutor.ts`)

Shell commands run with:

- a **timeout** (SIGTERM, then SIGKILL after a grace period),
- **stdout/stderr byte caps** (truncate + terminate on overflow),
- **cancellation** via `AbortSignal`,
- **process-group cleanup** — the child is a detached group leader, so the whole
  tree is signalled and no orphaned grandchildren survive a cancelled turn
  (verified in `tests/shell.test.ts`).

### Bounded output & redaction

Tool results are truncated before entering the model context (§20.1, §25.2). Logs
go to **stderr** (stdout stays a clean protocol channel) and pass through secret
redaction (`observability/`). Full stack traces / raw secrets are not fed back to
the model.

## What is NOT protected in v0.1 (be explicit)

- **The shell tool is not a sandbox.** `HostExecutor` provides process _lifetime_
  control, not an OS security boundary. An approved command runs with your user's
  privileges and a mostly-inherited environment. Approve commands as if you were
  typing them yourself. Sandboxed backends (bubblewrap/seatbelt/container/remote)
  are a designed extension point behind the `Executor` interface, not yet built.
- **Environment/secrets.** `InheritedEnvironmentPolicy` strips a few known
  provider keys but otherwise forwards the parent environment. Treat any secret in
  your environment as reachable by an approved shell command.
- **No network tools** ship in v0.1, which limits exfiltration surface — but an
  approved shell command can still reach the network.

## Threat model summary

| Threat                                | Mitigation (v0.1)                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Prompt injection via file/web content | Content is data; deterministic policy; approval for side effects; no ambient secrets in tools |
| Path traversal / symlink escape       | Canonicalize + realpath + segment-aware root check; new-file parent resolution                |
| Destructive shell command             | Default ASK + command-risk warning; never unattended; **sandbox is future work**              |
| Overwriting external edits            | Read-before-write stale check                                                                 |
| Runaway / huge output                 | Timeout, byte caps, process-group kill, cancellation                                          |
| Secret exfiltration                   | No network tools; stripped provider keys; redacted logs (shell remains a residual risk)       |

## Reporting

This is a v0.1 research/education codebase. Do not run it against untrusted inputs
with `--yes` (auto-approve) or in read-write mode on a directory you can't afford
to lose.

To report a vulnerability, follow the repository's
[security policy](../.github/SECURITY.md). Do not disclose security issues in a
public GitHub issue.
