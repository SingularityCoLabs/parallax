import { describe, it, expect } from 'vitest';
import { HostExecutor } from '../src/executor/index.ts';
import { createShellTool } from '../src/tools/shell/index.ts';
import type { ToolExecutionContext } from '../src/tools/core/index.ts';
import { getLogger } from '../src/observability/index.ts';

const executor = new HostExecutor();

function req(command: string, over: Partial<Parameters<HostExecutor['run']>[0]> = {}) {
  return {
    command,
    cwd: process.cwd(),
    timeoutMs: 10_000,
    maxOutputBytes: 1_000_000,
    signal: new AbortController().signal,
    ...over,
  };
}

describe('HostExecutor', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await executor.run(req('echo hello'));
    expect(result.exitCode).toBe(0);
    expect(result.reason).toBe('exited');
    expect(result.stdout.trim()).toBe('hello');
  });

  it('captures a non-zero exit code and stderr', async () => {
    const result = await executor.run(req('echo oops 1>&2; exit 3'));
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('oops');
  });

  it('streams output via callbacks', async () => {
    const chunks: string[] = [];
    await executor.run(req('printf "a\\nb\\n"', { onStdout: (c) => chunks.push(c) }));
    expect(chunks.join('')).toContain('a');
  });

  it('kills a process that exceeds the timeout', async () => {
    const start = Date.now();
    const result = await executor.run(req('sleep 5', { timeoutMs: 300 }));
    expect(result.reason).toBe('timeout');
    // Should return well before the 5s sleep would have finished.
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('terminates the whole process tree on cancel (no orphans)', async () => {
    const ac = new AbortController();
    // A child that spawns a grandchild sleeper.
    const p = executor.run(req('sh -c "sleep 5 & wait"', { signal: ac.signal, timeoutMs: 10_000 }));
    setTimeout(() => ac.abort(), 150);
    const start = Date.now();
    const result = await p;
    expect(result.reason).toBe('cancelled');
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('caps output and truncates', async () => {
    const result = await executor.run(
      req('for i in $(seq 1 100000); do echo aaaaaaaaaa; done', { maxOutputBytes: 500 }),
    );
    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(500);
  });
});

function ctx(): ToolExecutionContext {
  return {
    callId: 'c1',
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
    emitStdout: () => {},
    emitStderr: () => {},
    logger: getLogger(),
  };
}

describe('shell tool', () => {
  const tool = createShellTool({
    executor,
    defaultTimeoutMs: 10_000,
    maxOutputBytes: 1_000_000,
    maxModelChars: 16_000,
  });

  it('is write-risk and shell resource class (policy gates it)', () => {
    expect(tool.risk).toBe('write');
    expect(tool.resourceClass).toBe('shell');
  });

  it('describes the command for approval without escaping the workspace', async () => {
    const desc = await tool.describe!(ctx(), { command: 'pnpm test' });
    expect(desc.command).toBe('pnpm test');
    expect(desc.outsideWorkspace).toBe(false);
    expect(desc.title).toContain('pnpm test');
  });

  it('returns ok on a successful command', async () => {
    const result = await tool.execute(ctx(), { command: 'echo hi' });
    expect(result.ok).toBe(true);
    expect(result.modelContent).toContain('exit=0');
  });

  it('returns command_failed on a non-zero exit but keeps output', async () => {
    const result = await tool.execute(ctx(), { command: 'exit 2' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('command_failed');
  });

  it('reports a timeout as command_timeout', async () => {
    const result = await tool.execute(ctx(), { command: 'sleep 5', timeoutMs: 200 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('command_timeout');
  });
});
