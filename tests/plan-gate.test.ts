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
import { createPresentPlanTool } from '../src/tools/plan/index.ts';
import type { ApprovalDecision, RuntimeEvent } from '../src/protocol/index.ts';

/** A minimal write-risk tool so we can prove the mode actually flipped to workspace. */
function makeWriteTool(): ToolDefinition<{ path: string }, { wrote: string }> & { calls: number } {
  const tool = {
    name: 'fake_write',
    description: 'pretend to write a file',
    inputSchema: z.object({ path: z.string() }),
    risk: 'write' as const,
    resourceClass: 'filesystem_write' as const,
    calls: 0,
    execute(ctx: { callId: string }, input: { path: string }) {
      tool.calls += 1;
      return Promise.resolve(ok(ctx.callId, `wrote ${input.path}`, { wrote: input.path }));
    },
  };
  return tool;
}

/**
 * Drive a turn while auto-answering every approval with `decision`. Returns the
 * captured event stream. Resolving inside the listener works because the runtime
 * registers the approval waiter before emitting `approval.requested`.
 */
function harness(steps: FakeStep[], decision: ApprovalDecision) {
  const store = new InMemorySessionStore();
  const provider = new FakeModelProvider(steps);
  const write = makeWriteTool();
  const events: RuntimeEvent[] = [];
  const facade = createRuntime({
    config: defaultConfig(),
    provider,
    store,
    registerTools: (r) => {
      r.register(createPresentPlanTool({ maxModelChars: 16_000 }));
      r.register(write);
    },
  });
  facade.subscribe((e) => {
    events.push(e);
    if (e.type === 'approval.requested') facade.resolveApproval(e.request.id, decision);
  });
  return { store, provider, write, events, facade };
}

describe('present_plan mode gate', () => {
  it('approving the plan switches the session plan → workspace mid-turn', async () => {
    const h = harness(
      [
        [
          modelText("Here's the plan."),
          modelToolCall('present_plan', { plan: '1. edit\n2. test' }, 'p1'),
        ],
        // Next step: now in workspace mode, a write is ASK (approved) — not DENY.
        [modelToolCall('fake_write', { path: 'a.ts' }, 'w1')],
        [modelText('done')],
      ],
      'allow_once',
    );
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'plan' });
    await h.facade.startTurn(session.id, 'plan then do it');

    // The gate emitted mode.changed → workspace.
    const changed = h.events.find((e) => e.type === 'mode.changed');
    expect(changed?.type).toBe('mode.changed');
    if (changed?.type === 'mode.changed') expect(changed.mode).toBe('workspace');

    // The write actually executed — proving the turn was no longer plan-gated.
    expect(h.write.calls).toBe(1);
    expect(h.events.some((e) => e.type === 'tool.started' && e.toolName === 'fake_write')).toBe(
      true,
    );

    // The switch is persisted for subsequent turns too.
    const reloaded = await h.store.getSession(session.id);
    expect(reloaded?.permissionMode).toBe('workspace');
    expect(h.events.at(-1)?.type).toBe('turn.completed');
  });

  it('denying the plan keeps the session in plan mode', async () => {
    const h = harness(
      [
        [modelToolCall('present_plan', { plan: '1. edit' }, 'p1')],
        [modelText('staying in plan then')],
      ],
      'deny',
    );
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'plan' });
    await h.facade.startTurn(session.id, 'plan it');

    // No mode change; the plan tool call was denied.
    expect(h.events.some((e) => e.type === 'mode.changed')).toBe(false);
    const failed = h.events.find((e) => e.type === 'tool.failed');
    expect(failed?.type).toBe('tool.failed');
    if (failed?.type === 'tool.failed') expect(failed.result.error?.code).toBe('approval_denied');

    const reloaded = await h.store.getSession(session.id);
    expect(reloaded?.permissionMode).toBe('plan');
  });

  it('does not prompt for present_plan in workspace mode (nothing to switch)', async () => {
    const h = harness(
      [[modelToolCall('present_plan', { plan: 'fyi' }, 'p1')], [modelText('ok')]],
      'deny', // would fire if it asked — it must not
    );
    const session = await h.facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'here is a plan');

    expect(h.events.some((e) => e.type === 'approval.requested')).toBe(false);
    expect(h.events.some((e) => e.type === 'mode.changed')).toBe(false);
    // The tool still ran (it just echoes the plan).
    expect(h.events.some((e) => e.type === 'tool.completed')).toBe(true);
  });
});
