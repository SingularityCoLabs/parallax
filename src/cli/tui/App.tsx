import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ApprovalDecision, PermissionMode, RuntimeEvent } from '../../protocol/index.ts';
import { applyModelSelection, MissingApiKeyError, type Agent } from '../../app/index.ts';
import {
  getProvider,
  listProviders,
  readUpdateCache,
  refreshUpdateInfo,
  resolveApiKey,
  sanitizeApiKey,
  saveCredential,
  saveLocalConfig,
  upgradeCommand,
  type Config,
  type ProviderInfo,
  type UpdateInfo,
} from '../../config/index.ts';
import { VERSION } from '../../version.ts';
import {
  parseCommand,
  parseModelSelector,
  formatProviders,
  formatModels,
  formatHelp,
} from '../replCommands.ts';
import { getTheme, type ThemeName } from './theme.ts';
import { useRuntimeEvents } from './useRuntimeEvents.ts';
import { Timeline } from './components/Timeline.tsx';
import { Footer } from './components/Footer.tsx';
import { PromptInput } from './components/PromptInput.tsx';
import { WelcomeBanner, AnimatedWelcome } from './components/WelcomeBanner.tsx';
import { ModelDialog, type ModelSelection } from './components/ModelDialog.tsx';

/** Permission-mode cycle order for Shift+Tab (Claude Code style). */
const MODE_CYCLE: PermissionMode[] = ['workspace', 'plan', 'read-only', 'bypass'];

/** The permission modes settable by name (the `/workspace`, `/bypass`, … shortcuts). */
const MODE_NAMES: readonly PermissionMode[] = ['workspace', 'plan', 'read-only', 'bypass'];

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
  /**
   * Play the launch-splash intro animation (fresh interactive start). Defaults
   * to false so resumed sessions and tests render the banner already frozen.
   */
  animateIntro?: boolean;
  /**
   * Open with no working model configured: auto-show the `/model` dialog and
   * block turns (with guidance) until a provider is chosen. See
   * `buildAgentOrFallback` in the CLI wiring.
   */
  needsSetup?: boolean;
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
  const [themeName, setThemeName] = useState<ThemeName>(props.themeName ?? 'dark');
  const theme = getTheme(themeName);
  const state = useRuntimeEvents(agent, props.seedEvents);

  const [provider, setProvider] = useState(props.initialProvider);
  const [model, setModel] = useState(props.initialModel);
  const [mode, setMode] = useState<PermissionMode>(props.initialMode);
  const [systemLines, setSystemLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The launch splash animates only on a fresh interactive start; once the
  // intro finishes (or immediately, when not animating) it freezes into the
  // timeline's static header. `introDone` gates that transition.
  const [introDone, setIntroDone] = useState(!props.animateIntro);
  const finishIntro = useCallback(() => setIntroDone(true), []);

  // `/model` configuration overlay. `needsSetup` means no usable model is
  // configured yet (launched on the fake fallback); it gates turns and
  // auto-opens the dialog once the intro finishes. `sessionKeys` holds API keys
  // typed in the dialog for this run only — passed to the provider in memory,
  // never written to `Config`/the store (the on-disk store is opt-in, separate).
  const [needsSetup, setNeedsSetup] = useState(Boolean(props.needsSetup));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogProviders, setDialogProviders] = useState<ProviderInfo[]>([]);
  const [dialogInitialProvider, setDialogInitialProvider] = useState<string | undefined>(undefined);
  const [dialogInitialModel, setDialogInitialModel] = useState<string | undefined>(undefined);
  const [dialogInitialStep, setDialogInitialStep] = useState<'provider' | 'model' | undefined>(
    undefined,
  );
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});
  // "Update available" banner data: read the local cache immediately, then do a
  // best-effort network refresh. Both are non-blocking and never throw.
  const [update, setUpdate] = useState<UpdateInfo | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void readUpdateCache().then((u) => {
      if (live && u) setUpdate(u);
    });
    void refreshUpdateInfo().then((u) => {
      if (live && u) setUpdate(u);
    });
    return () => {
      live = false;
    };
  }, []);

  /** True when a provider already has a usable key (env, on-disk, or session). */
  const hasKey = useCallback(
    (id: string): boolean => {
      const info = getProvider(id);
      if (!info) return false;
      if (info.wire === 'fake') return true; // the fake provider needs no key
      return Boolean(sanitizeApiKey(sessionKeys[id] ?? resolveApiKey(id)));
    },
    [sessionKeys],
  );

  /**
   * Open the `/model` overlay, snapshotting the catalog so it can't shift. The
   * bare command starts at the provider list with the active provider selected;
   * recovery from a direct switch can still jump to that provider/model/key. A
   * `fake`/empty provider is treated as "no preset" so it never shortcuts into
   * the offline stub's model step.
   */
  const openDialog = useCallback(
    (
      initial: {
        provider?: string;
        model?: string;
        step?: 'provider' | 'model';
      } = {},
    ) => {
      setDialogProviders(listProviders());
      setDialogInitialProvider(
        initial.provider && initial.provider !== 'fake' ? initial.provider : undefined,
      );
      setDialogInitialModel(initial.model);
      setDialogInitialStep(initial.step);
      setDialogOpen(true);
    },
    [],
  );

  const pushSystem = useCallback((text: string) => {
    setSystemLines((prev) => [...prev.slice(-40), ...text.split('\n')]);
  }, []);

  /** Set the permission mode for subsequent turns (used by /mode, the mode
   * shortcuts, and Shift+Tab). Updates the local indicator and the session. */
  const applyMode = useCallback(
    async (next: PermissionMode) => {
      setMode(next);
      await agent.facade.setPermissionMode(sessionId, next);
      pushSystem(`permission mode → ${next}`);
    },
    [agent, pushSystem, sessionId],
  );

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
    async (sel: { provider: string; model?: string; apiKey?: string }) => {
      if (!getProvider(sel.provider)) {
        pushSystem(`Unknown provider "${sel.provider}". Try /providers.`);
        return;
      }
      const over: { provider: string; model?: string } = { provider: sel.provider };
      if (sel.model) over.model = sel.model;
      // Prefer an explicit key (just typed), else any key entered earlier this
      // session; env/on-disk keys are resolved inside `buildProvider`.
      const key = sel.apiKey ?? sessionKeys[sel.provider];
      try {
        const applied = await applyModelSelection(
          agent,
          props.buildConfig(over),
          sessionId,
          key !== undefined ? { apiKey: key } : {},
        );
        setProvider(applied.provider);
        setModel(applied.model);
        setNeedsSetup(false);
        // Remember the choice so the next launch opens on it (env still wins).
        saveLocalConfig({ provider: applied.provider, model: applied.model });
        pushSystem(`switched → ${applied.provider}:${applied.model}`);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          // No key on this path — offer the dialog to enter one, preset to the
          // provider the user asked for.
          pushSystem(`${sel.provider} needs an API key. Opening /model to configure it…`);
          openDialog({
            provider: sel.provider,
            ...(sel.model !== undefined ? { model: sel.model } : {}),
          });
          return;
        }
        pushSystem(`Could not switch: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [agent, openDialog, props, pushSystem, sessionId, sessionKeys],
  );

  /** Apply a dialog selection: hold the key in memory (+ optionally on disk). */
  const onDialogSubmit = useCallback(
    async (sel: ModelSelection) => {
      if (sel.apiKey) {
        const key = sel.apiKey;
        setSessionKeys((prev) => ({ ...prev, [sel.provider]: key }));
        if (sel.remember) saveCredential(sel.provider, key);
      }
      setDialogOpen(false);
      const req: { provider: string; model?: string; apiKey?: string } = {
        provider: sel.provider,
        model: sel.model,
      };
      if (sel.apiKey) req.apiKey = sel.apiKey;
      await switchTo(req);
    },
    [switchTo],
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
          if (!command.arg) {
            // Bare `/model` and `/m` expose the complete provider → model path,
            // with the current provider highlighted rather than skipped.
            openDialog({ provider, model, step: 'provider' });
            return;
          }
          await switchTo(parseModelSelector(command.arg, provider));
          return;
        }
        case 'unknown':
          if (command.name === 'clear') {
            setSystemLines([]);
            return;
          }
          if (command.name === 'exit' || command.name === 'quit') {
            exit();
            return;
          }
          // Permission-mode shortcuts: `/workspace`, `/plan`, `/read-only`, `/bypass`.
          if ((MODE_NAMES as readonly string[]).includes(command.name)) {
            await applyMode(command.name as PermissionMode);
            return;
          }
          if (command.name === 'mode') {
            const arg = line.split(/\s+/)[1] as PermissionMode | undefined;
            const next = arg && MODE_NAMES.includes(arg) ? arg : undefined;
            if (!next) return pushSystem('usage: /mode workspace|plan|read-only|bypass');
            await applyMode(next);
            return;
          }
          if (command.name === 'theme') {
            const arg = line.split(/\s+/)[1];
            const next: ThemeName =
              arg === 'dark' || arg === 'light' ? arg : themeName === 'dark' ? 'light' : 'dark';
            setThemeName(next);
            saveLocalConfig({ theme: next });
            pushSystem(`theme → ${next}`);
            return;
          }
          if (command.name === 'tools') {
            const tools = agent.facade.listTools();
            pushSystem(
              [
                'available tools:',
                ...tools.map((t) => `  ${t.name.padEnd(16)} ${t.description}`),
              ].join('\n'),
            );
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
    [agent, applyMode, model, openDialog, provider, pushSystem, submitTurn, switchTo, themeName],
  );

  const submit = useCallback(
    async (line: string) => {
      if (line.startsWith('/')) {
        await runCommand(line);
        return;
      }
      // No usable model yet — send them to the picker instead of a dead turn.
      if (needsSetup) {
        pushSystem('Choose a model first — opening /model.');
        openDialog({ provider });
        return;
      }
      await submitTurn(line);
    },
    [needsSetup, openDialog, provider, pushSystem, runCommand, submitTurn],
  );

  // Auto-open the picker once, after the intro, when launched unconfigured.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (needsSetup && introDone && !autoOpened && !dialogOpen) {
      setAutoOpened(true);
      openDialog({ provider });
    }
  }, [needsSetup, introDone, autoOpened, dialogOpen, openDialog, provider]);

  // The runtime can change permission mode mid-turn: approving the `present_plan`
  // gate emits `mode.changed`, which the reducer folds into
  // `session.permissionMode`. Mirror that into local `mode` so the footer and the
  // next Shift+Tab start from the new mode. Only the auto-switch updates the
  // session mode in the reducer, so this never fights the manual Shift+Tab path.
  const sessionMode = state.session?.permissionMode;
  useEffect(() => {
    // Keyed on sessionMode only (by design): a manual Shift+Tab updates local
    // `mode` without changing `sessionMode`, so it must not re-run this and get
    // reverted. Only the runtime's `mode.changed` moves `sessionMode`.
    if (sessionMode && sessionMode !== mode) setMode(sessionMode as PermissionMode);
  }, [sessionMode]);

  // Global chords: Shift+Tab cycles mode; Esc/Ctrl-C cancels a turn or quits.
  // While the dialog is open it owns the keyboard, so these must not fire.
  useInput((input, key) => {
    if (dialogOpen) return;
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

  // Input is locked while the intro plays, the model dialog is open, a turn is
  // in flight, work is being submitted, or an approval is pending.
  const disabled =
    !introDone || dialogOpen || busy || state.active || state.pendingApproval !== undefined;
  const placeholder = state.pendingApproval
    ? 'Answer the prompt above…'
    : 'Type a goal, or /help for commands';

  // The launch splash. While the intro animates it lives in the dynamic frame
  // (so the ✻ mark can pulse); once frozen it becomes the timeline's static
  // header, printed once at the top and scrolling up as the conversation grows.
  const updateProps =
    update && update.latest !== update.current
      ? {
          updateNotice: `update available ${update.current} → ${update.latest}`,
          upgradeCmd: upgradeCommand(update),
        }
      : {};
  const banner = (
    <WelcomeBanner
      theme={theme}
      version={VERSION}
      provider={provider}
      model={model}
      mode={mode}
      cwd={props.cwd}
      needsSetup={needsSetup}
      {...updateProps}
    />
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      {!introDone && (
        <AnimatedWelcome
          theme={theme}
          version={VERSION}
          provider={provider}
          model={model}
          mode={mode}
          cwd={props.cwd}
          needsSetup={needsSetup}
          onDone={finishIntro}
        />
      )}
      <Timeline
        items={state.items}
        theme={theme}
        onDecision={resolveApproval}
        {...(introDone ? { header: banner } : {})}
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

      {dialogOpen ? (
        // The picker takes over the live region below the transcript (the
        // transcript's <Static> output stays put, avoiding a reprint on close).
        <Box marginTop={1}>
          <ModelDialog
            theme={theme}
            providers={dialogProviders}
            {...(dialogInitialProvider ? { initialProviderId: dialogInitialProvider } : {})}
            {...(dialogInitialModel ? { initialModelId: dialogInitialModel } : {})}
            {...(dialogInitialStep ? { initialStep: dialogInitialStep } : {})}
            hasKey={hasKey}
            onSubmit={onDialogSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </Box>
      ) : (
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
            needsSetup={needsSetup}
          />
        </Box>
      )}
    </Box>
  );
}
