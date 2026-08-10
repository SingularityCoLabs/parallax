import { z } from 'zod';
import { ErrorCode, fail, ok, truncateMiddle, type ToolDefinition } from '../core/index.ts';
import type { Executor } from '../../executor/index.ts';

export interface ShellDeps {
  executor: Executor;
  defaultTimeoutMs: number;
  maxOutputBytes: number;
  maxModelChars: number;
}

const inputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  command: string;
  exitCode: number | null;
  signal: string | null;
  reason: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * `shell` (blueprint §14). The escape hatch that lets the agent use the existing
 * software ecosystem (git, node, python, pnpm, …). Risk is `write` so the policy
 * engine gates it behind approval in workspace mode and blocks it in read-only.
 * Execution constraints (timeout, output cap, cancellation, process-group kill)
 * live in the injected Executor, not here.
 */
export function createShellTool(deps: ShellDeps): ToolDefinition<Input, Output> {
  return {
    name: 'shell',
    description:
      'Run a shell command in the workspace (git, node, python, package managers, tests, etc.). Streams stdout/stderr. Prefer native file tools for reading/editing files.',
    inputSchema,
    // Marked write-risk: many commands mutate. Read-only mode blocks it; the
    // command-risk classifier escalates the approval warning for destructive ones.
    risk: 'write',
    resourceClass: 'shell',
    describe(_ctx, input) {
      return Promise.resolve({
        title: `Run \`${input.command}\``,
        command: input.command,
        // The workspace root is enforced as cwd at execution; a relative cwd
        // stays inside it. No path escape surface here.
        outsideWorkspace: false,
      });
    },
    async execute(ctx, input) {
      const result = await deps.executor.run({
        command: input.command,
        cwd: input.cwd ? input.cwd : ctx.workspaceRoot,
        timeoutMs: input.timeoutMs ?? deps.defaultTimeoutMs,
        maxOutputBytes: deps.maxOutputBytes,
        signal: ctx.signal,
        onStdout: (chunk) => ctx.emitStdout(chunk),
        onStderr: (chunk) => ctx.emitStderr(chunk),
      });

      const output: Output = {
        command: input.command,
        exitCode: result.exitCode,
        signal: result.signal,
        reason: result.reason,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };

      const combined = [
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const modelContent = truncateMiddle(
        `exit=${result.exitCode ?? 'null'} (${result.reason})\n${combined}`,
        { maxChars: deps.maxModelChars },
      ).text;

      if (result.reason === 'cancelled') {
        return fail(ctx.callId, ErrorCode.Cancelled, 'Command cancelled', {
          durationMs: result.durationMs,
        });
      }
      if (result.reason === 'timeout') {
        return fail(ctx.callId, ErrorCode.CommandTimeout, `Command timed out: ${input.command}`, {
          durationMs: result.durationMs,
        });
      }
      if (result.exitCode !== 0) {
        return {
          ...fail(
            ctx.callId,
            ErrorCode.CommandFailed,
            `exit ${result.exitCode ?? 'null'}: ${input.command}`,
            { durationMs: result.durationMs },
          ),
          data: output,
          modelContent,
        };
      }
      return ok(ctx.callId, `ran \`${input.command}\` (exit 0)`, output, {
        durationMs: result.durationMs,
        truncated: result.stdoutTruncated || result.stderrTruncated,
        modelContent,
      });
    },
  };
}

export interface ShellToolDeps {
  executor: Executor;
  defaultTimeoutMs: number;
  maxOutputBytes: number;
  maxModelChars: number;
}

/** Build the shell tool set (blueprint §14). */
export function createShellTools(deps: ShellToolDeps): ToolDefinition<never, unknown>[] {
  return [createShellTool(deps)] as unknown as ToolDefinition<never, unknown>[];
}
