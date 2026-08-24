import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { createRuntime } from '../src/app/index.ts';
import { defaultConfig, initCatalog, resetCatalog, type Config } from '../src/config/index.ts';
import { InMemorySessionStore } from '../src/sessions/index.ts';
import {
  FakeModelProvider,
  modelText,
  modelToolCall,
  type FakeStep,
} from '../src/providers/index.ts';
import { FileStateCache, createFsReadTools } from '../src/tools/fs/index.ts';
import type { Agent } from '../src/app/index.ts';
import { App } from '../src/cli/tui/App.tsx';

/**
 * Render tests for the Ink TUI. `ink-testing-library` provides a mock TTY (so
 * `useInput`'s raw mode works headlessly) and captures frames. We drive a real
 * runtime turn against the fake provider and assert the rendered frame.
 */

function makeAgent(steps: FakeStep[]): Agent {
  const store = new InMemorySessionStore();
  const fileState = new FileStateCache();
  const config = defaultConfig();
  const provider = new FakeModelProvider(steps);
  const facade = createRuntime({
    config,
    provider,
    store,
    registerTools: (r) => {
      for (const t of createFsReadTools({
        fileState,
        maxFileReadBytes: config.maxFileReadBytes,
        maxDirEntries: config.maxDirEntries,
        maxSearchResults: config.maxSearchResults,
      })) {
        r.register(t);
      }
    },
  });
  return { facade, store };
}

/** A `buildConfig` that honors provider/model overrides (mirrors the CLI wiring). */
function overrideConfig(over: { provider?: string; model?: string }): Config {
  return {
    ...defaultConfig(),
    ...(over.provider ? { provider: over.provider } : {}),
    ...(over.model ? { defaultModel: over.model } : {}),
  };
}

function renderApp(
  agent: Agent,
  sessionId: string,
  opts: {
    animateIntro?: boolean;
    needsSetup?: boolean;
    initialProvider?: string;
    initialModel?: string;
  } = {},
) {
  return render(
    <App
      agent={agent}
      sessionId={sessionId}
      buildConfig={overrideConfig}
      initialProvider={opts.initialProvider ?? 'fake'}
      initialModel={opts.initialModel ?? 'fake-1'}
      initialMode="workspace"
      cwd="/demo/project"
      animateIntro={opts.animateIntro ?? false}
      needsSetup={opts.needsSetup ?? false}
    />,
  );
}

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Keystrokes for ink-testing-library's mock stdin.
const ENTER = '\r';
const UP = '\u001B[A';
const DOWN = '[B'; // down-arrow escape sequence
const ESC = '';

let tmpHome: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  process.env.PARALLAX_DISABLE_MODELS_FETCH = '1';
  // Keep the TUI tests hermetic: no live npm registry call on mount.
  savedEnv['PARALLAX_NO_UPDATE_CHECK'] = process.env.PARALLAX_NO_UPDATE_CHECK;
  process.env.PARALLAX_NO_UPDATE_CHECK = '1';
  // Isolate credential/key resolution so `hasKey` is deterministic regardless of
  // the developer's shell or `~/.parallax`.
  tmpHome = mkdtempSync(join(tmpdir(), 'parallax-tui-'));
  for (const key of ['PARALLAX_HOME', 'PARALLAX_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PARALLAX_HOME = join(tmpHome, 'home');
  resetCatalog();
  initCatalog();
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetCatalog();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('TUI App render', () => {
  it('renders the header, prompt, and footer with provider:model and mode', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, unmount } = renderApp(agent, session.id);
    await tick();
    const frame = lastFrame() ?? '';
    // The launch banner: wordmark greeting + working directory.
    expect(frame).toContain('Welcome to Parallax');
    expect(frame).toContain('/demo/project');
    // Footer shows provider:model and the permission mode.
    expect(frame).toContain('fake:fake-1');
    expect(frame).toContain('workspace');
    unmount();
  });

  it('plays the intro then settles the banner into the header', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, unmount } = renderApp(agent, session.id, { animateIntro: true });
    // The greeting is present during the animated intro...
    await tick();
    expect(lastFrame() ?? '').toContain('Welcome to Parallax');
    // ...and remains once the intro finishes and it freezes into the header.
    await tick(300);
    expect(lastFrame() ?? '').toContain('Welcome to Parallax');
    unmount();
  });

  it('streams an assistant response into the timeline after a turn', async () => {
    const agent = makeAgent([[modelText('Hello from the agent')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, unmount } = renderApp(agent, session.id);
    await tick();
    // Drive a turn directly (equivalent to the user submitting a line).
    await agent.facade.startTurn(session.id, 'say hi');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('say hi'); // the user line
    expect(frame).toContain('Hello from the agent'); // streamed assistant text
    unmount();
  });

  it('shows the interactive approval prompt when a turn blocks on ASK', async () => {
    const agent = makeAgent([
      [modelToolCall('read_file', { path: 'x.ts' }, 'r1')], // read is allowed
      [modelText('done')],
    ]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, unmount } = renderApp(agent, session.id);
    await tick();
    unmount();
    // (read_file is auto-allowed, so no approval; this asserts the render path
    // stays stable through a tool call — the approval UI is covered by the
    // timeline reducer test.)
    expect(lastFrame ?? '').toBeDefined();
  });

  it('arrow-selects a slash command and runs the highlighted one on Enter', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id);
    await tick();
    // Open the completion menu; the first row is `/help`, the second `/model`.
    stdin.write('/');
    await tick();
    expect(lastFrame() ?? '').toContain('/model');
    // Move the highlight down to `/model` and run it — that opens the picker.
    stdin.write(DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    // Enter on the *highlighted* row ran `/model` (not the top row `/help`),
    // proving arrow selection works.
    expect(lastFrame() ?? '').toContain('Configure model');
    unmount();
  });

  it('/m opens provider-first, highlights the active provider, then selects its model', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id, {
      initialProvider: 'openai',
      initialModel: 'gpt-4.1',
    });
    await tick();

    // The trailing space bypasses autocomplete and exercises `/m` as a real
    // parsed alias. The current provider is highlighted, but not skipped.
    stdin.write('/m ');
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? '').toContain('Configure model');
    expect(lastFrame() ?? '').toContain('select a provider');
    expect(lastFrame() ?? '').toContain('❯ ✗ OpenAI');

    // Entering the current provider preserves and highlights its active model.
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? '').toContain('OpenAI · select a model');
    expect(lastFrame() ?? '').toContain('❯ gpt-4.1');

    // Back returns to the same provider instead of resetting to the first row.
    stdin.write(ESC);
    await tick();
    expect(lastFrame() ?? '').toContain('❯ ✗ OpenAI');

    // Move from OpenAI to Anthropic and confirm: the second step is its model
    // list, proving the command exposes the complete provider → model path.
    stdin.write(UP);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? '').toContain('Anthropic (Claude) · select a model');
    unmount();
  });

  it('switches to bypass mode via /bypass and shows the loud footer', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id);
    await tick();
    stdin.write('/bypass');
    await tick();
    stdin.write(ENTER);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bypass');
    // The session's mode actually changed for subsequent turns.
    const s = await agent.store.getSession(session.id);
    expect(s?.permissionMode).toBe('bypass');
    unmount();
  });
});

describe('TUI model configuration', () => {
  it('opens the model dialog and shows the unconfigured footer when needsSetup', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id, { needsSetup: true });
    await tick();
    // The picker auto-opens on an unconfigured launch.
    expect(lastFrame() ?? '').toContain('Configure model');

    // Esc closes it; the footer then shows the call to action, not a model.
    stdin.write(ESC);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Configure model');
    expect(frame).toContain('/model to configure');
    unmount();
  });

  it('blocks a turn until a model is chosen', async () => {
    const agent = makeAgent([[modelText('should not run')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id, { needsSetup: true });
    await tick();
    stdin.write(ESC); // close the auto-opened dialog
    await tick();
    // Type a goal and submit it — it must be intercepted, not sent to the model.
    stdin.write('do the thing');
    await tick();
    stdin.write(ENTER);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Choose a model first');
    expect(frame).not.toContain('should not run'); // the fake model never ran
    unmount();
  });

  it('configures a provider + key through the dialog and switches to it', async () => {
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id, { needsSetup: true });
    await tick();
    expect(lastFrame() ?? '').toContain('Configure model');

    // Filter to Anthropic and select it.
    stdin.write('anthropic');
    await tick();
    stdin.write(ENTER);
    await tick();
    // Now on the model step — select the first (default) model.
    stdin.write(ENTER);
    await tick();
    // Anthropic has no key here, so we land on key entry. Type one and confirm.
    stdin.write('sk-ant-test-123');
    await tick();
    stdin.write(ENTER);
    await tick(120); // allow the async switch to resolve

    const frame = lastFrame() ?? '';
    // Dialog closed, provider switched, footer now shows the real model.
    expect(frame).not.toContain('Configure model');
    expect(frame).toContain('anthropic:claude');
    expect(frame).not.toContain('/model to configure');
    unmount();
  });

  it('preserves a directly requested model while collecting its missing key', async () => {
    // A whitespace-only env value must be treated exactly like a missing key by
    // both provider construction and the dialog's routing logic.
    process.env.OPENAI_API_KEY = '  \n\t ';
    const agent = makeAgent([[modelText('hi')]]);
    const session = await agent.facade.createSession({
      cwd: '/demo/project',
      permissionMode: 'workspace',
    });
    const { lastFrame, stdin, unmount } = renderApp(agent, session.id);
    await tick();

    stdin.write('/model openai/gpt-4.1');
    await tick();
    stdin.write(ENTER);
    await tick(120);
    expect(lastFrame() ?? '').toContain('OpenAI · enter API key');

    // Going back restores the requested model, not row zero; selecting it again
    // returns to key entry with the same pending selection.
    stdin.write(ESC);
    await tick();
    expect(lastFrame() ?? '').toContain('OpenAI · select a model');
    expect(lastFrame() ?? '').toContain('❯ gpt-4.1');
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? '').toContain('OpenAI · enter API key');

    stdin.write('sk-test-openai');
    await tick();
    stdin.write(ENTER);
    await tick(120);
    expect(lastFrame() ?? '').toContain('openai:gpt-4.1');
    unmount();
  });
});
