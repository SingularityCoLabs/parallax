import React, { useCallback, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ApprovalDecision, PermissionMode, RuntimeEvent } from '../../protocol/index.ts';
import {
  applyModelSelection,
  apiKeyEnvHint,
  MissingApiKeyError,
  type Agent,
} from '../../app/index.ts';
import { getProvider, type Config } from '../../config/index.ts';
import {
  parseCommand,
  parseModelSelector,
  formatProviders,
  formatModels,
  formatHelp,
} from '../replCommands.ts';
import { missingKeyMessage } from '../setupGuidance.ts';
import { getTheme, type ThemeName } from './theme.ts';
import { useRuntimeEvents } from './useRuntimeEvents.ts';
import { Timeline } from './components/Timeline.tsx';
import { Footer } from './components/Footer.tsx';
import { PromptInput } from './components/PromptInput.tsx';

/** Permission-mode cycle order for Shift+Tab (Claude Code style). */
const MODE_CYCLE: PermissionMode[] = ['workspace', 'plan', 'read-only'];

export interface AppProps {
  agent: Agent;
  sessionId: string;
  /** Rebuild a Config for a provider/model switch (from the CLI wiring). */
  buildConfig: (over: { provider?: string; model?: string }) => Config;
  initialProvider: string;
  initialModel: string;
  initialMode: PermissionMode;
  cwd: string;
  themeName?: ThemeName;
  /** Prior events to seed the timeline with (resuming a persisted session). */
  seedEvents?: RuntimeEvent[];
}

/**
 * The Parallax TUI root. Composes the scrolling timeline, a live status line,
 * the bordered prompt, and the footer, and owns keyboard chords (Shift+Tab mode
 * cycle, Esc/Ctrl-C cancel-or-quit) plus slash-command dispatch. It is a pure
 * consumer of the runtime event stream via `useRuntimeEvents` — it issues
 * commands to the facade and renders what comes back.
 */
export function App(props: AppProps): React.ReactElement {
  const { agent, sessionId } = props;
  const { exit } = useApp();
  const theme = getTheme(props.themeName);
  const state = useRuntimeEvents(agent, props.seedEvents);

  const [provider, setProvider] = useState(props.initialProvider);
  const [model, setModel] = useState(props.initialModel);
  const [mode, setMode] = useState<PermissionMode>(props.initialMode);
  const [systemLines, setSystemLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const pushSystem = useCallback((text: string) => {
    setSystemLines((prev) => [...prev.slice(-40), ...text.split('\n')]);
  }, []);

  const resolveApproval = useCallback(
    (id: string, decision: ApprovalDecision) => {
      agent.facade.resolveApproval(id, decision);
    },
    [agent],
  );

  const submitTurn = useCallback(
    async (line: string) => {
      setBusy(true);
      try {
        await agent.facade.startTurn(sessionId, line);
      } finally {
        setBusy(false);
      }
    },
    [agent, sessionId],
  );

  const switchTo = useCallback(
    async (sel: { provider: string; model?: string }) => {
      if (!getProvider(sel.provider)) {
        pushSystem(`Unknown provider "${sel.provider}". Try /providers.`);
        return;
      }
      const over: { provider: string; model?: string } = { provider: sel.provider };
      if (sel.model) over.model = sel.model;
      try {
        const applied = await applyModelSelection(agent, props.buildConfig(over), sessionId);
        setProvider(applied.provider);
        setModel(applied.model);
        pushSystem(`switched → ${applied.provider}:${applied.model}`);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          pushSystem(
            `${missingKeyMessage(sel.provider, apiKeyEnvHint(sel.provider))}\nStaying on ${provider}:${model}.`,
          );
          return;
        }
        pushSystem(`Could not switch: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [agent, model, props, provider, pushSystem, sessionId],
  );

  const runCommand = useCallback(
    async (line: string) => {
      const command = parseCommand(line);
      switch (command.kind) {
        case 'help':
          pushSystem(formatHelp());
          return;
        case 'providers':
          pushSystem(formatProviders(provider));
          return;
        case 'models':
          pushSystem(formatModels(command.arg ?? provider, model));
          return;
        case 'provider':
          if (!command.arg) return pushSystem(`current provider: ${provider}`);
          await switchTo({ provider: command.arg });
          return;
        case 'model': {
          if (!command.arg) return pushSystem(`current model: ${provider}:${model}`);
          await switchTo(parseModelSelector(command.arg, provider));
          return;
        }
        case 'unknown':
          if (command.name === 'clear') {
            setSystemLines([]);
            return;
          }
          if (command.name === 'mode') {
            const arg = line.split(/\s+/)[1] as PermissionMode | undefined;
            const next = arg && MODE_CYCLE.includes(arg) ? arg : undefined;
            if (!next) return pushSystem('usage: /mode workspace|plan|read-only');
            await agent.facade.setPermissionMode(sessionId, next);
            setMode(next);
            pushSystem(`permission mode → ${next}`);
            return;
          }
          if (command.name === 'sessions') {
            const sessions = await agent.store.listSessions();
            if (sessions.length === 0) return pushSystem('No persisted sessions yet.');
            pushSystem(
              [
                'sessions (newest first):',
                ...sessions
                  .slice(0, 10)
                  .map(
                    (s) =>
                      `  ${s.id.slice(0, 8)}  ${new Date(s.updatedAt).toISOString().slice(0, 16)}  ` +
                      `${s.provider}:${s.model}  ${s.cwd}`,
                  ),
                'Resume one with: parallax resume <id>',
              ].join('\n'),
            );
            return;
          }
          if (command.name === 'init') {
            // Kick off a turn that summarizes the project (Claude Code's /init).
            void submitTurn(
              'Inspect this project (README, package manifest, source layout) and write a concise ' +
                'summary of what it is, how to build/test it, and its key entry points.',
            );
            return;
          }
          if (command.name === 'resume') {
            pushSystem(
              'To resume a past session, exit and run `parallax resume <id>` — it reopens this ' +
                'interface with that transcript. Use /sessions to find an id.',
            );
            return;
          }
          pushSystem(`Unknown command "/${command.name}". Try /help.`);
          return;
        case 'none':
          return;
      }
    },
    [agent, model, provider, pushSystem, sessionId, submitTurn, switchTo],
  );

  const submit = useCallback(
    async (line: string) => {
      if (line.startsWith('/')) {
        await runCommand(line);
        return;
      }
      await submitTurn(line);
    },
    [runCommand, submitTurn],
  );

  // Global chords: Shift+Tab cycles mode; Esc/Ctrl-C cancels a turn or quits.
  useInput((input, key) => {
    if (key.tab && key.shift) {
      const next = MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length]!;
      setMode(next);
      void agent.facade.setPermissionMode(sessionId, next);
      return;
    }
    if (key.escape || (key.ctrl && input === 'c')) {
      if (state.active) {
        agent.facade.cancelActiveTurn(sessionId);
      } else {
        exit();
      }
    }
  });

  const disabled = busy || state.active || state.pendingApproval !== undefined;
  const placeholder = state.pendingApproval
    ? 'Answer the prompt above…'
    : 'Type a goal, or /help for commands';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Timeline
        items={state.items}
        theme={theme}
        onDecision={resolveApproval}
        header={
          <Box marginBottom={1}>
            <Text color={theme.accent} bold>
              Parallax
            </Text>
            <Text color={theme.subtle}> · {props.cwd}</Text>
          </Box>
        }
      />

      {/* System / command output (not part of the durable timeline). */}
      {systemLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {systemLines.slice(-12).map((l, i) => (
            <Text key={`${i}-${l}`} color={theme.subtle}>
              {l}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <PromptInput
          theme={theme}
          disabled={disabled}
          placeholder={placeholder}
          onSubmit={submit}
        />
        <Footer
          theme={theme}
          provider={provider}
          model={model}
          mode={mode}
          usage={state.usage}
          active={state.active}
        />
      </Box>
    </Box>
  );
}
