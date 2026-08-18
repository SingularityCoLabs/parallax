#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { runDemo, listScenarios, listPersistedSessions, replaySession } from '../app/index.ts';
import { loadConfig, databasePath } from '../config/index.ts';
import type { ApprovalDecision } from '../protocol/index.ts';
import { VERSION } from '../version.ts';
import { CliRenderer } from './renderer.ts';
import { runGoal, chatLoop, resumeChat, type AgentCliOptions } from './agentRunner.ts';
import { runUninstall } from './uninstallRunner.ts';
import { SetupRequiredError } from './setupGuidance.ts';

// Convenience: load ./.env (e.g. NVIDIA_API_KEY) if present. Node 20.6+ built-in.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

const program = new Command();

program
  .name('parallax')
  .description('A secure, extensible agent runtime with a CLI as its first interface.')
  .version(VERSION);

program
  .command('demo')
  .argument('[scenario]', 'scenario name (see `demo --list`)', 'edit-fix')
  .option('-C, --cwd <dir>', 'workspace directory', process.cwd())
  .option('--read-only', 'run in read-only permission mode', false)
  .option('-y, --yes', 'auto-approve all side effects (non-interactive)', false)
  .option('--no-persist', 'do not persist the session to SQLite')
  .option('--list', 'list available scenarios', false)
  .description('Run a scripted agent workflow (fake provider) end-to-end.')
  .action(
    async (
      scenario: string,
      opts: {
        cwd: string;
        readOnly: boolean;
        yes: boolean;
        persist: boolean;
        list: boolean;
      },
    ) => {
      if (opts.list) {
        for (const s of listScenarios()) {
          process.stdout.write(`  ${s.name.padEnd(12)} ${s.description}\n`);
        }
        return;
      }

      const config = loadConfig();
      const renderer = new CliRenderer();
      const rl = opts.yes
        ? undefined
        : createInterface({ input: process.stdin, output: process.stderr, terminal: false });

      const onApproval = async (request: {
        id: string;
        title: string;
      }): Promise<ApprovalDecision> => {
        if (opts.yes) return 'allow_once';
        const answer = (await rl!.question(`    Allow "${request.title}"? [y/N] `))
          .trim()
          .toLowerCase();
        return answer === 'y' || answer === 'yes' ? 'allow_once' : 'deny';
      };

      try {
        const { sessionId } = await runDemo({
          scenario,
          cwd: opts.cwd,
          config,
          ...(opts.persist ? { dbPath: databasePath() } : {}),
          permissionMode: opts.readOnly ? 'read-only' : 'workspace',
          onEvent: (event) => renderer.handle(event),
          onApproval,
        });
        if (opts.persist) {
          process.stdout.write(
            `\nSession ${sessionId} saved. Replay: parallax resume ${sessionId}\n`,
          );
        }
      } finally {
        rl?.close();
      }
    },
  );

const withAgentOptions = (cmd: Command): Command =>
  cmd
    .option('-C, --cwd <dir>', 'workspace directory', process.cwd())
    .option('-p, --provider <id>', 'provider id (see `parallax` /providers)')
    .option('-m, --model <model>', 'model id (overrides provider default)')
    .option('--read-only', 'run in read-only permission mode', false)
    .option('-y, --yes', 'auto-approve all side effects (non-interactive)', false)
    .option('--no-persist', 'do not persist the session to SQLite');

interface RawAgentOpts {
  cwd: string;
  provider?: string;
  model?: string;
  readOnly: boolean;
  yes: boolean;
  persist: boolean;
}

const toAgentOptions = (o: RawAgentOpts): AgentCliOptions => ({
  cwd: o.cwd,
  readOnly: o.readOnly,
  yes: o.yes,
  persist: o.persist,
  ...(o.provider !== undefined ? { provider: o.provider } : {}),
  ...(o.model !== undefined ? { model: o.model } : {}),
});

withAgentOptions(
  program
    .command('run')
    .argument('<goal...>', 'the goal for the agent to accomplish')
    .description('Run a single goal to completion using the configured model provider.'),
).action(async (goalParts: string[], opts: RawAgentOpts) => {
  await runGoal(goalParts.join(' '), toAgentOptions(opts));
});

withAgentOptions(
  program
    .command('chat', { isDefault: true })
    .description('Interactive REPL against the configured model provider (default command).'),
).action(async (opts: RawAgentOpts) => {
  await chatLoop(toAgentOptions(opts));
});

program
  .command('uninstall')
  .description("Remove Parallax's stored data and print how to remove the CLI.")
  .option('--dry-run', 'list what would be removed, delete nothing', false)
  .option('-y, --yes', 'skip the confirmation prompt (non-interactive)', false)
  .option('--keep-data', 'keep sessions/state; only print how to remove the CLI', false)
  .action(async (opts: { dryRun: boolean; yes: boolean; keepData: boolean }) => {
    await runUninstall(opts);
  });

program
  .command('sessions')
  .description('List persisted sessions.')
  .action(async () => {
    const sessions = await listPersistedSessions(databasePath());
    if (sessions.length === 0) {
      process.stdout.write('No sessions yet. Run `parallax demo` first.\n');
      return;
    }
    for (const s of sessions) {
      const when = new Date(s.updatedAt).toISOString();
      process.stdout.write(
        `${s.id.slice(0, 8)}  ${when}  ${s.permissionMode.padEnd(10)} ${s.cwd}\n`,
      );
    }
  });

program
  .command('resume')
  .argument('<sessionId>', 'session id (or its 8-char prefix)')
  .option('-C, --cwd <dir>', 'workspace directory', process.cwd())
  .option('--print', 'replay the transcript to stdout instead of reopening it interactively', false)
  .description('Reopen a persisted session in the interactive UI (or --print to replay it).')
  .action(async (sessionId: string, opts: { cwd: string; print: boolean }) => {
    // On a real terminal, reopen the session in the TUI seeded with its
    // transcript so the conversation can continue. `--print` (or a non-TTY)
    // keeps the line-oriented replay.
    if (!opts.print && process.stdin.isTTY && process.stdout.isTTY) {
      const resumed = await resumeChat(sessionId, {
        cwd: opts.cwd,
        readOnly: false,
        yes: false,
        persist: true,
      });
      if (!resumed) {
        process.stderr.write(`Session not found: ${sessionId}\n`);
        process.exitCode = 1;
      }
      return;
    }

    const renderer = new CliRenderer();
    // Allow an 8-char prefix for convenience.
    let id = sessionId;
    if (sessionId.length < 36) {
      const match = (await listPersistedSessions(databasePath())).find((s) =>
        s.id.startsWith(sessionId),
      );
      if (match) id = match.id;
    }
    const found = await replaySession(databasePath(), id, (event) => renderer.handle(event));
    if (!found) {
      process.stderr.write(`Session not found: ${sessionId}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // Setup problems are the user's to fix, not bugs — print the instructions
  // plainly, with no "Error:" prefix and no stack trace.
  if (err instanceof SetupRequiredError) {
    process.stderr.write(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
