import { spawn } from 'node:child_process';
import type {
  Executor,
  EnvironmentPolicy,
  ProcessRequest,
  ProcessResult,
  ProcessExitReason,
} from './Executor.ts';
import { InheritedEnvironmentPolicy } from './EnvironmentPolicy.ts';

const KILL_GRACE_MS = 2000;

/**
 * Runs a command on the host machine (blueprint §15, §30.1). This is NOT a
 * security sandbox — it provides process lifetime control only: streamed
 * output, byte caps, timeout (SIGTERM then SIGKILL), cancellation, and
 * process-group cleanup so no orphaned children survive a cancelled turn.
 */
export class HostExecutor implements Executor {
  private readonly env: EnvironmentPolicy;

  constructor(env: EnvironmentPolicy = new InheritedEnvironmentPolicy()) {
    this.env = env;
  }

  run(req: ProcessRequest): Promise<ProcessResult> {
    const start = Date.now();
    return new Promise<ProcessResult>((resolve) => {
      // detached: true → child becomes a process-group leader, so we can signal
      // the whole tree via the negative pid and avoid orphaned grandchildren.
      const child = spawn(req.command, {
        cwd: req.cwd,
        env: this.env.buildEnv(process.env),
        shell: true,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let reason: ProcessExitReason = 'exited';
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const killTree = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          // Group may already be gone; fall back to the direct child.
          try {
            child.kill(signal);
          } catch {
            /* already exited */
          }
        }
      };

      const terminate = (why: ProcessExitReason) => {
        if (reason === 'exited') reason = why;
        killTree('SIGTERM');
        // Escalate to SIGKILL if it ignores the graceful signal.
        killTimer = setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS);
        killTimer.unref();
      };

      const append = (which: 'out' | 'err', chunk: Buffer) => {
        const isOut = which === 'out';
        const used = isOut ? stdoutBytes : stderrBytes;
        const remaining = req.maxOutputBytes - used;
        if (remaining <= 0) return;
        let text: string;
        if (chunk.length > remaining) {
          text = chunk.subarray(0, remaining).toString('utf8');
          if (isOut) stdoutTruncated = true;
          else stderrTruncated = true;
        } else {
          text = chunk.toString('utf8');
        }
        if (isOut) {
          stdout += text;
          stdoutBytes += Buffer.byteLength(text);
          req.onStdout?.(text);
        } else {
          stderr += text;
          stderrBytes += Buffer.byteLength(text);
          req.onStderr?.(text);
        }
        // If either stream overflowed its cap, stop the process (blueprint §15).
        if (chunk.length > remaining) terminate('output_limit');
      };

      child.stdout.on('data', (c: Buffer) => append('out', c));
      child.stderr.on('data', (c: Buffer) => append('err', c));

      const onAbort = () => terminate('cancelled');
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener('abort', onAbort, { once: true });

      if (req.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => terminate('timeout'), req.timeoutMs);
        timeoutTimer.unref();
      }

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        req.signal.removeEventListener('abort', onAbort);
        resolve({
          exitCode,
          signal,
          reason,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          durationMs: Date.now() - start,
        });
      };

      child.on('error', (err) => {
        stderr += (stderr ? '\n' : '') + `spawn error: ${err.message}`;
        finish(null, null);
      });
      child.on('close', (code, signal) => finish(code, signal));
    });
  }
}
