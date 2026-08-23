import React from 'react';
import { render } from 'ink';
import type { PermissionMode, RuntimeEvent } from '../../protocol/index.ts';
import type { Agent } from '../../app/index.ts';
import { refreshCatalog, type Config } from '../../config/index.ts';
import { App } from './App.tsx';
import type { ThemeName } from './theme.ts';

export interface TuiOptions {
  agent: Agent;
  sessionId: string;
  buildConfig: (over: { provider?: string; model?: string }) => Config;
  provider: string;
  model: string;
  mode: PermissionMode;
  cwd: string;
  themeName?: ThemeName;
  /** Prior events to seed the timeline (resuming a persisted session). */
  seedEvents?: RuntimeEvent[];
  /**
   * Open with no working model configured: the App shows the `/model` dialog and
   * gates turns until a provider is chosen. See `buildAgentOrFallback`.
   */
  needsSetup?: boolean;
}

/**
 * Mount the Ink TUI and resolve when the user quits. This is the interactive
 * front door: it kicks off a background models.dev refresh, renders `<App>`, and
 * awaits `waitUntilExit`. All runtime interaction happens through the injected
 * `agent.facade` — the CLI builds the agent + session (so missing-key errors
 * surface the same friendly guidance as the readline path).
 */
export async function runTui(options: TuiOptions): Promise<void> {
  // Best-effort catalog refresh (offline keeps the snapshot).
  void refreshCatalog();

  const { waitUntilExit } = render(
    <App
      agent={options.agent}
      sessionId={options.sessionId}
      buildConfig={options.buildConfig}
      initialProvider={options.provider}
      initialModel={options.model}
      initialMode={options.mode}
      cwd={options.cwd}
      {...(options.themeName ? { themeName: options.themeName } : {})}
      {...(options.seedEvents ? { seedEvents: options.seedEvents } : {})}
      // Play the launch-splash intro only on a fresh start. A resumed session
      // (seeded with a transcript) skips it and renders the banner frozen.
      animateIntro={!options.seedEvents}
      {...(options.needsSetup ? { needsSetup: true } : {})}
    />,
    { exitOnCtrlC: false }, // we handle Ctrl-C ourselves (cancel turn vs quit)
  );

  await waitUntilExit();
  options.agent.facade.close();
}
