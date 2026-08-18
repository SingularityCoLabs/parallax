import { describe, it, expect } from 'vitest';
import {
  reduceTimeline,
  reduceAll,
  initialTimeline,
  toolLabel,
  type TimelineState,
  type ToolItem,
  type AssistantItem,
} from '../src/cli/tui/timeline.ts';
import type { RuntimeEvent } from '../src/protocol/index.ts';

/**
 * The TUI timeline reducer is the testable heart of the Ink UI: it folds the
 * runtime's event stream into a render model. These tests use plain event
 * objects (no Ink render) — the same contract the components consume.
 */

let seq = 0;
function ev<T extends RuntimeEvent['type']>(
  type: T,
  body: Omit<Extract<RuntimeEvent, { type: T }>, 'v' | 'seq' | 'timestamp' | 'type' | 'sessionId'>,
): RuntimeEvent {
  return {
    v: 1,
    seq: seq++,
    timestamp: 0,
    sessionId: 's1',
    type,
    ...body,
  } as unknown as RuntimeEvent;
}

function fold(events: RuntimeEvent[]): TimelineState {
  return events.reduce(reduceTimeline, initialTimeline());
}

describe('toolLabel', () => {
  it('maps internal tool names to Claude Code-style labels', () => {
    expect(toolLabel('shell', { command: 'node --test' })).toBe('Bash(node --test)');
    expect(toolLabel('read_file', { path: 'src/a.ts' })).toBe('Read(src/a.ts)');
    expect(toolLabel('edit_file', { path: 'src/a.ts' })).toBe('Update(src/a.ts)');
    expect(toolLabel('write_file', { path: 'src/b.ts' })).toBe('Write(src/b.ts)');
    expect(toolLabel('search_files', { query: 'TODO' })).toBe('Search(TODO)');
    expect(toolLabel('list_directory', {})).toBe('List(.)');
    expect(toolLabel('unknown_tool', {})).toBe('unknown_tool');
  });

  it('truncates long command/query args', () => {
    const long = 'x'.repeat(80);
    expect(toolLabel('shell', { command: long }).length).toBeLessThan(60);
  });
});

describe('timeline reducer', () => {
  it('records session info', () => {
    const s = fold([
      ev('session.started', {
        cwd: '/w',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        permissionMode: 'workspace',
      }),
    ]);
    expect(s.session).toEqual({
      sessionId: 's1',
      cwd: '/w',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      permissionMode: 'workspace',
    });
  });

  it('accumulates streaming assistant deltas into one block per step', () => {
    const s = fold([
      ev('turn.started', { turnId: 't1', userText: 'hi' }),
      ev('model.started', { turnId: 't1', step: 0 }),
      ev('assistant.delta', { turnId: 't1', text: 'Hel' }),
      ev('assistant.delta', { turnId: 't1', text: 'lo' }),
    ]);
    const assistants = s.items.filter((i): i is AssistantItem => i.kind === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]!.text).toBe('Hello');
    expect(assistants[0]!.streaming).toBe(true);
    expect(s.active).toBe(true);
  });

  it('marks the assistant block done and tallies usage on model.completed', () => {
    const s = fold([
      ev('turn.started', { turnId: 't1', userText: 'hi' }),
      ev('assistant.delta', { turnId: 't1', text: 'Done' }),
      ev('model.completed', { turnId: 't1', reason: 'stop', inputTokens: 10, outputTokens: 4 }),
    ]);
    const a = s.items.find((i): i is AssistantItem => i.kind === 'assistant')!;
    expect(a.streaming).toBe(false);
    expect(s.usage).toEqual({ input: 10, output: 4 });
  });

  it('tracks a tool call through proposed → running → completed with output', () => {
    const s = fold([
      ev('turn.started', { turnId: 't1', userText: 'go' }),
      ev('tool.proposed', {
        turnId: 't1',
        call: { id: 'c1', name: 'shell', arguments: { command: 'ls' } },
      }),
      ev('tool.started', { turnId: 't1', callId: 'c1', toolName: 'shell' }),
      ev('tool.stdout', { turnId: 't1', callId: 'c1', text: 'file.txt\n' }),
      ev('tool.completed', {
        turnId: 't1',
        result: { callId: 'c1', ok: true, summary: 'ran ls', durationMs: 12 },
      }),
    ]);
    const tool = s.items.find((i): i is ToolItem => i.kind === 'tool')!;
    expect(tool.title).toBe('Bash(ls)');
    expect(tool.status).toBe('completed');
    expect(tool.stdout).toBe('file.txt\n');
    expect(tool.summary).toBe('ran ls');
    expect(tool.durationMs).toBe(12);
  });

  it('records an approval request as pending and clears it on resolve', () => {
    const req = {
      id: 'ap1',
      toolCallId: 'c1',
      toolName: 'edit_file',
      risk: 'write' as const,
      title: 'Edit a.ts',
    };
    const afterReq = fold([
      ev('turn.started', { turnId: 't1', userText: 'edit' }),
      ev('approval.requested', { turnId: 't1', request: req }),
    ]);
    expect(afterReq.pendingApproval?.id).toBe('ap1');

    const afterResolve = reduceTimeline(
      afterReq,
      ev('approval.resolved', { turnId: 't1', approvalId: 'ap1', decision: 'allow_once' }),
    );
    expect(afterResolve.pendingApproval).toBeUndefined();
    const appr = afterResolve.items.find((i) => i.kind === 'approval');
    expect(appr && appr.kind === 'approval' && appr.decision).toBe('allow_once');
  });

  it('adds a notice and clears active on turn.failed', () => {
    const s = fold([
      ev('turn.started', { turnId: 't1', userText: 'x' }),
      ev('turn.failed', { turnId: 't1', errorCode: 'internal_error', message: 'boom' }),
    ]);
    expect(s.active).toBe(false);
    const notice = s.items.find((i) => i.kind === 'notice');
    expect(notice && notice.kind === 'notice' && notice.tone).toBe('error');
  });

  it('reduceAll replays a full event list deterministically', () => {
    const events = [
      ev('session.started', {
        cwd: '/w',
        provider: 'fake',
        model: 'fake-1',
        permissionMode: 'workspace',
      }),
      ev('turn.started', { turnId: 't1', userText: 'hi' }),
      ev('assistant.delta', { turnId: 't1', text: 'yo' }),
      ev('turn.completed', { turnId: 't1' }),
    ];
    const s = reduceAll(events);
    expect(s.session?.provider).toBe('fake');
    expect(s.active).toBe(false);
    expect(s.items.filter((i) => i.kind === 'user')).toHaveLength(1);
  });
});
