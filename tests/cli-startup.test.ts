import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli', 'index.ts');

/**
 * Run the CLI as a real child process. Startup behaviour (argument routing,
 * default command, exit codes, .env loading) only exists at the process
 * boundary, so these assertions cannot be made against an imported function.
 */
function runCli(
  args: string[],
  options: { env?: Record<string, string>; input?: string; cwd?: string } = {},
): { stdout: string; stderr: string; status: number | null } {
  const env: Record<string, string> = { ...process.env, ...options.env } as Record<string, string>;
  // Never touch the developer's real state directory or inherit their key.
  delete env.NVIDIA_API_KEY;
  delete env.PARALLAX_API_KEY;
  delete env.PARALLAX_PROVIDER;
  delete env.PARALLAX_API_BASE_URL;
  for (const [k, v] of Object.entries(options.env ?? {})) env[k] = v;

  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: 'utf8',
    input: options.input ?? '',
    env,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

/**
 * Provide an isolated HOME (state dir) and a `.env`-free working directory, so
 * startup tests are deterministic regardless of any `.env` a developer keeps in
 * the repo root (the CLI auto-loads `./.env`, which would otherwise leak a real
 * provider/key into these assertions).
 */
function withTempHome<T>(fn: (ctx: { home: string; cwd: string }) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-cli-'));
  try {
    return fn({ home: join(dir, 'state'), cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('CLI startup', () => {
  it('runs the agent by default instead of printing help', () => {
    // The bare command must not fall back to the usage screen — that was the
    // reported failure: `parallax` printed help and exited 1.
    const { stdout, stderr, status } = withTempHome(({ home, cwd }) =>
      runCli([], { env: { PARALLAX_HOME: home }, cwd }),
    );
    const output = stdout + stderr;
    expect(output).not.toMatch(/Usage: parallax \[options\] \[command\]/);
    expect(output).toContain('no model configured');
    expect(status).toBe(1);
  });

  it('explains how to configure a model when none is set', () => {
    const { stdout, stderr } = withTempHome(({ home, cwd }) =>
      runCli([], { env: { PARALLAX_HOME: home }, cwd }),
    );
    const output = stdout + stderr;
    expect(output).toContain('build.nvidia.com');
    expect(output).toContain('PARALLAX_PROVIDER=nvidia');
    expect(output).toContain('NVIDIA_API_KEY');
    // Offers the offline path for users without a key.
    expect(output).toContain('parallax demo');
    // Actionable guidance, not an exception dump.
    expect(output).not.toMatch(/SetupRequiredError|at .*\.ts:\d+/);
  });

  it('names the missing variable when a provider is selected without a key', () => {
    const { stdout, stderr, status } = withTempHome(({ home, cwd }) =>
      runCli([], { env: { PARALLAX_HOME: home, PARALLAX_PROVIDER: 'nvidia' }, cwd }),
    );
    const output = stdout + stderr;
    expect(output).toContain('NVIDIA_API_KEY is not set');
    expect(output).not.toMatch(/MissingApiKeyError/);
    expect(status).toBe(1);
  });

  it('still routes explicit subcommands', () => {
    const { stdout } = withTempHome(({ home, cwd }) =>
      runCli(['demo', '--list'], { env: { PARALLAX_HOME: home }, cwd }),
    );
    expect(stdout).toContain('edit-fix');
    expect(stdout).toContain('inspect');
  });

  it('still prints help and version on request', () => {
    const help = withTempHome(({ home, cwd }) =>
      runCli(['--help'], { env: { PARALLAX_HOME: home }, cwd }),
    );
    expect(help.stdout).toMatch(/Usage: parallax/);
    // The default command is discoverable from the help output.
    expect(help.stdout).toMatch(/chat/);
    expect(help.status).toBe(0);

    const version = withTempHome(({ home, cwd }) =>
      runCli(['--version'], { env: { PARALLAX_HOME: home }, cwd }),
    );
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads provider settings from a .env file in the working directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parallax-dotenv-'));
    try {
      // Provider from .env, but no key -> the key-specific message proves the
      // .env was actually loaded (otherwise we'd get "no model configured").
      writeFileSync(join(dir, '.env'), 'PARALLAX_PROVIDER=nvidia\n');
      mkdirSync(join(dir, 'state'), { recursive: true });
      const { stdout, stderr } = runCli([], {
        cwd: dir,
        env: { PARALLAX_HOME: join(dir, 'state') },
      });
      expect(stdout + stderr).toContain('NVIDIA_API_KEY is not set');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
