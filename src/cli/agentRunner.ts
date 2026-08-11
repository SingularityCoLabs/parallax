import { createInterface, type Interface } from 'node:readline/promises';
import {
  createAgent,
  providerSupportsChat,
  applyModelSelection,
  apiKeyEnvHint,
  MissingApiKeyError,
  type Agent,
} from '../app/index.ts';
import {
  loadConfig,
  databasePath,
  effectiveModel,
  getProvider,
  type Config,
} from '../config/index.ts';
import type { ApprovalDecision, PermissionMode } from '../protocol/index.ts';
import { CliRenderer } from './renderer.ts';
import {
  parseCommand,
  parseModelSelector,
  formatProviders,
  formatModels,
  formatHelp,
} from './replCommands.ts';
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
  provider?: string;
}

function buildConfig(options: AgentCliOptions): Config {
  const overrides: Partial<Config> = {};
  if (options.provider) overrides.provider = options.provider;
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
      throw new SetupRequiredError(
        missingKeyMessage(config.provider, apiKeyEnvHint(config.provider)),
      );
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

  // Tracks the live provider/model so switches rebuild config from a known base.
  const state = { provider: config.provider, model: effectiveModel(config) };

  // `session.started` already renders provider/model/mode/cwd; just add the keys.
  const session = await agent.facade.createSession({ cwd: options.cwd, permissionMode: mode });
  process.stderr.write(
    'Type a goal and press enter. "/help" lists commands; Ctrl-C cancels a turn ' +
      '(or quits at the prompt); "exit" or Ctrl-D quits.\n',
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

      // Slash commands are handled locally and never start a turn. A failed
      // switch (e.g. missing key) is reported and the loop continues on the
      // current provider — the REPL never crashes on a command.
      if (line.startsWith('/')) {
        await handleReplCommand(line, agent, options, session.id, state);
        continue;
      }

      await agent.facade.startTurn(session.id, line);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    unsubscribe();
    agent.facade.close();
    rl.close();
  }
}

interface ChatState {
  provider: string;
  model: string;
}

/**
 * Handle one `/…` command against the live agent. Prints results to stderr and,
 * for `/model`/`/provider`, performs a history-preserving switch. On a missing
 * API key it prints actionable guidance and leaves the current provider active.
 */
async function handleReplCommand(
  line: string,
  agent: Agent,
  options: AgentCliOptions,
  sessionId: string,
  state: ChatState,
): Promise<void> {
  const command = parseCommand(line);
  switch (command.kind) {
    case 'help':
      process.stderr.write(`${formatHelp()}\n`);
      return;
    case 'providers':
      process.stderr.write(`${formatProviders(state.provider)}\n`);
      return;
    case 'models':
      process.stderr.write(`${formatModels(command.arg ?? state.provider, state.model)}\n`);
      return;
    case 'provider': {
      if (!command.arg) {
        process.stderr.write(`current provider: ${state.provider}\n`);
        return;
      }
      await switchModel(agent, options, sessionId, state, { provider: command.arg });
      return;
    }
    case 'model': {
      if (!command.arg) {
        process.stderr.write(`current model: ${state.provider}:${state.model}\n`);
        return;
      }
      const sel = parseModelSelector(command.arg, state.provider);
      await switchModel(agent, options, sessionId, state, sel);
      return;
    }
    case 'unknown':
      process.stderr.write(`Unknown command "/${command.name}". Try /help.\n`);
      return;
    case 'none':
      return;
  }
}

/**
 * Rebuild config for the requested provider/model and apply it to the running
 * agent. `model` empty means "use the provider's default". Failures (unknown
 * provider, missing key) are reported without disturbing the active provider.
 */
async function switchModel(
  agent: Agent,
  options: AgentCliOptions,
  sessionId: string,
  state: ChatState,
  selection: { provider: string; model?: string },
): Promise<void> {
  // Reject an unknown provider id up front, so it never reaches config
  // validation (which would throw a raw ZodError and break the command).
  if (!getProvider(selection.provider)) {
    process.stderr.write(`Unknown provider "${selection.provider}". Try /providers.\n`);
    return;
  }

  // Undefined model → catalog default for the new provider (omit the override).
  const base: AgentCliOptions = { ...options, provider: selection.provider };
  if (selection.model) base.model = selection.model;
  else delete base.model;

  try {
    const applied = await applyModelSelection(agent, buildConfig(base), sessionId);
    state.provider = applied.provider;
    state.model = applied.model;
    process.stderr.write(`switched → ${applied.provider}:${applied.model}\n`);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      process.stderr.write(
        `\n${missingKeyMessage(selection.provider, apiKeyEnvHint(selection.provider))}\n` +
          `Staying on ${state.provider}:${state.model}.\n`,
      );
      return;
    }
    // Any other failure (bad config, provider construction) is reported without
    // tearing down the REPL — the current provider stays active.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `Could not switch to ${selection.provider}: ${message}\n` +
        `Staying on ${state.provider}:${state.model}.\n`,
    );
  }
}
