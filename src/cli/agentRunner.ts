import { createInterface, type Interface } from 'node:readline/promises';
import { createAgent, providerSupportsChat, MissingApiKeyError, type Agent } from '../app/index.ts';
import { loadConfig, databasePath, type Config } from '../config/index.ts';
import type { ApprovalDecision, PermissionMode } from '../protocol/index.ts';
import { CliRenderer } from './renderer.ts';
import {
  SetupRequiredError,
  noProviderConfiguredMessage,
  missingKeyMessage,
} from './setupGuidance.ts';

export interface AgentCliOptions {
  cwd: string;
  readOnly: boolean;
  yes: boolean;
  persist: boolean;
  model?: string;
}

function buildConfig(options: AgentCliOptions): Config {
  const overrides: Partial<Config> = {};
  if (options.model) overrides.defaultModel = options.model;
  return loadConfig(overrides);
}

function makeApprovalHandler(
  yes: boolean,
  rl: Interface | undefined,
): (request: { title: string }) => Promise<ApprovalDecision> {
  return async (request) => {
    if (yes || !rl) return yes ? 'allow_once' : 'deny';
    const answer = (await rl.question(`    Allow "${request.title}"? [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes' ? 'allow_once' : 'deny';
  };
}

/** Wire renderer + approval routing onto a facade. Returns an unsubscribe fn. */
function wire(
  agent: Agent,
  renderer: CliRenderer,
  approval: (request: { title: string }) => Promise<ApprovalDecision>,
  onTurn: (turnId: string | undefined) => void,
): () => void {
  return agent.facade.subscribe((event) => {
    renderer.handle(event);
    if (event.type === 'turn.started') onTurn(event.turnId);
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'turn.cancelled'
    ) {
      onTurn(undefined);
    }
    if (event.type === 'approval.requested') {
      const id = event.request.id;
      void approval(event.request).then((decision) => agent.facade.resolveApproval(id, decision));
    }
  });
}

function ensureChatCapable(config: Config): void {
  if (!providerSupportsChat(config)) {
    throw new SetupRequiredError(noProviderConfiguredMessage());
  }
}

/**
 * Build the agent, converting a missing API key into actionable setup guidance.
 * `createAgent` resolves the key from the environment, so this is the first point
 * where a misconfigured install is detected.
 */
function buildAgent(config: Config, options: AgentCliOptions): Agent {
  try {
    return createAgent({ config, ...(options.persist ? { dbPath: databasePath() } : {}) });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      const envVar = config.provider === 'nvidia' ? 'NVIDIA_API_KEY' : 'PARALLAX_API_KEY';
      throw new SetupRequiredError(missingKeyMessage(config.provider, envVar));
    }
    throw err;
  }
}

/** One-shot: run a single goal to completion, then exit. */
export async function runGoal(goal: string, options: AgentCliOptions): Promise<void> {
  const config = buildConfig(options);
  ensureChatCapable(config);
  const mode: PermissionMode = options.readOnly ? 'read-only' : 'workspace';

  const renderer = new CliRenderer();
  const rl = options.yes
    ? undefined
    : createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  const agent = buildAgent(config, options);
  const unsubscribe = wire(agent, renderer, makeApprovalHandler(options.yes, rl), () => {});

  try {
    const session = await agent.facade.createSession({ cwd: options.cwd, permissionMode: mode });
    await agent.facade.startTurn(session.id, goal);
    if (options.persist) {
      process.stdout.write(
        `\nSession ${session.id} saved. Replay: parallax resume ${session.id}\n`,
      );
    }
  } finally {
    unsubscribe();
    agent.facade.close();
    rl?.close();
  }
}

/** Interactive REPL against the configured real provider. */
export async function chatLoop(options: AgentCliOptions): Promise<void> {
  const config = buildConfig(options);
  ensureChatCapable(config);
  const mode: PermissionMode = options.readOnly ? 'read-only' : 'workspace';

  const renderer = new CliRenderer();
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const agent = buildAgent(config, options);

  let activeTurn: string | undefined;
  const unsubscribe = wire(agent, renderer, makeApprovalHandler(options.yes, rl), (t) => {
    activeTurn = t;
  });

  // `session.started` already renders provider/model/mode/cwd; just add the keys.
  const session = await agent.facade.createSession({ cwd: options.cwd, permissionMode: mode });
  process.stderr.write(
    'Type a goal and press enter. Ctrl-C cancels a turn (or quits at the prompt); ' +
      '"exit" or Ctrl-D quits.\n',
  );

  const onSigint = (): void => {
    if (activeTurn) {
      process.stderr.write('\n[cancelling…]\n');
      agent.facade.cancelTurn(session.id, activeTurn);
      return;
    }
    // Nothing in flight: Ctrl-C at the prompt should quit, as the shell default
    // would. Closing the readline rejects the pending question, ending the loop.
    process.stderr.write('\n');
    rl.close();
  };
  process.on('SIGINT', onSigint);

  try {
    for (;;) {
      // A closed stdin (Ctrl-D, Ctrl-C at the prompt, or piped input running
      // out) rejects the pending question — that is a clean exit, not an error.
      const answer = await rl.question('\n> ').catch(() => undefined);
      if (answer === undefined) break;
      const line = answer.trim();
      if (line === '' || line === 'exit' || line === 'quit') break;
      await agent.facade.startTurn(session.id, line);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    unsubscribe();
    agent.facade.close();
    rl.close();
  }
}
