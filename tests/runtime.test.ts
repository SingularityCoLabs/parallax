import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createRuntime } from '../src/app/index.ts';
import { defaultConfig } from '../src/config/index.ts';
import { InMemorySessionStore } from '../src/sessions/index.ts';
import {
  FakeModelProvider,
  modelText,
  modelToolCall,
  type FakeStep,
} from '../src/providers/index.ts';
import { ok, type ToolDefinition } from '../src/tools/core/index.ts';
import type { RuntimeEvent } from '../src/protocol/index.ts';
import type { Config } from '../src/config/index.ts';

interface EchoTool extends ToolDefinition<{ text: string }, { echoed: string }> {
  calls: number;
}

function makeEchoTool(): EchoTool {
  const tool: EchoTool = {
    name: 'echo',
    description: 'Echo text back (read-risk, auto-allowed).',
    inputSchema: z.object({ text: z.string() }),
    risk: 'read',
    resourceClass: 'pure_read',
    calls: 0,
    execute(ctx, input) {
      tool.calls += 1;
      return Promise.resolve(ok(ctx.callId, `echoed ${input.text}`, { echoed: input.text }));
    },
  };
  return tool;
}

function harness(steps: FakeStep[], configOverride: Partial<Config> = {}) {
  const store = new InMemorySessionStore();
  const provider = new FakeModelProvider(steps);
  const echo = makeEchoTool();
  const events: RuntimeEvent[] = [];
  const facade = createRuntime({
    config: { ...defaultConfig(), ...configOverride },
    provider,
    store,
    registerTools: (r) => r.register(echo),
  });
  facade.subscribe((e) => events.push(e));
  return { store, provider, echo, events, facade };
}

const types = (events: RuntimeEvent[]): string[] => events.map((e) => e.type);

describe('runtime turn loop', () => {
  it('produces a golden event sequence for tool → model → final', async () => {
    const h = harness([
      [modelText("I'll echo."), modelToolCall('echo', { text: 'hi' }, 'c1')],
      [modelText('done')],
    ]);
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'echo hi');

    expect(types(h.events)).toEqual([
      'session.started',
      'turn.started',
      'model.started',
      'assistant.delta',
      'model.completed',
      'tool.proposed',
      'tool.started',
      'tool.completed',
      'model.started',
      'assistant.delta',
      'model.completed',
      'turn.completed',
    ]);
    expect(h.echo.calls).toBe(1);
  });

  it('feeds the tool result back and completes', async () => {
    const h = harness([[modelToolCall('echo', { text: 'abc' }, 'c1')], [modelText('ok')]]);
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'go');

    const messages = await h.store.listMessages(session.id);
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('c1');
    expect(toolMsg?.content).toContain('abc');
    // Second model request saw the tool result in its message list.
    expect(h.provider.requests.length).toBe(2);
    expect(
      h.provider.requests[1]!.messages.some((m) => m.role === 'tool' && m.content.includes('abc')),
    ).toBe(true);
  });

  it('enforces the max-steps guard and fails the turn', async () => {
    // Every step proposes a tool call and never finalizes.
    const h = harness(
      [
        [modelToolCall('echo', { text: '1' }, 'a')],
        [modelToolCall('echo', { text: '2' }, 'b')],
      ],
      { maxSteps: 2 },
    );
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'loop');

    const last = h.events.at(-1)!;
    expect(last.type).toBe('turn.failed');
    if (last.type === 'turn.failed') expect(last.message).toMatch(/max steps/i);
  });

  it('rejects invalid tool arguments before execution', async () => {
    const h = harness([
      // `text` must be a string; pass a number.
      [modelToolCall('echo', { text: 123 }, 'c1')],
      [modelText('recovered')],
    ]);
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'bad');

    // The tool never ran.
    expect(h.echo.calls).toBe(0);
    // A tool.failed with validation_error was emitted, and no tool.started for it.
    const failed = h.events.find((e) => e.type === 'tool.failed');
    expect(failed?.type).toBe('tool.failed');
    if (failed?.type === 'tool.failed') {
      expect(failed.result.error?.code).toBe('validation_error');
    }
    expect(h.events.some((e) => e.type === 'tool.started')).toBe(false);
    // The turn still completed after the model recovered.
    expect(types(h.events).at(-1)).toBe('turn.completed');
  });

  it('rejects unknown tools without executing anything', async () => {
    const h = harness([[modelToolCall('nonexistent', {}, 'c1')], [modelText('ok')]]);
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'x');
    const failed = h.events.find((e) => e.type === 'tool.failed');
    if (failed?.type === 'tool.failed') {
      expect(failed.result.error?.code).toBe('unknown_tool');
    }
    expect(h.events.some((e) => e.type === 'tool.started')).toBe(false);
  });
});
