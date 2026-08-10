/**
 * Process execution interfaces (blueprint §15, §30.2). The shell tool depends
 * only on `Executor`, so the host backend can later be swapped for a sandboxed
 * one (bubblewrap/seatbelt/container/remote) without touching tools.
 */

export interface EnvironmentPolicy {
  /** Produce the environment for a spawned process (blueprint §15.3). v0.1 may
   * inherit most of the parent env; this seam lets us restrict secrets later. */
  buildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}

export interface ProcessRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export type ProcessExitReason = 'exited' | 'timeout' | 'cancelled' | 'output_limit';

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason: ProcessExitReason;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
}

export interface Executor {
  run(request: ProcessRequest): Promise<ProcessResult>;
}
