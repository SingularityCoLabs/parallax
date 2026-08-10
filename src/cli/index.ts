#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { runDemo, listScenarios, listPersistedSessions, replaySession } from '../app/index.ts';
import { loadConfig, databasePath } from '../config/index.ts';
import type { ApprovalDecision } from '../protocol/index.ts';
import { CliRenderer } from './renderer.ts';

const program = new Command();

program
  .name('parallax')
  .description('A secure, extensible agent runtime with a CLI as its first interface.')
  .version('0.1.0');

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
  .description('Replay a persisted session transcript.')
  .action(async (sessionId: string) => {
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
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
