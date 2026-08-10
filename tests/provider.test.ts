import { describe, it, expect } from 'vitest';
import {
  FakeModelProvider,
  modelText,
  modelToolCall,
  modelFinal,
  type ModelEvent,
} from '../src/providers/index.ts';
import type { ModelRequest } from '../src/providers/index.ts';

const req: ModelRequest = { model: 'fake-1', system: 'sys', messages: [], tools: [] };

async function collect(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('FakeModelProvider', () => {
  it('streams scripted deltas then auto-completes', async () => {
    const p = new FakeModelProvider([[modelText('Hello '), modelText('world')]]);
    const events = await collect(p.stream(req, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello ' },
      { type: 'text.delta', text: 'world' },
      { type: 'completed', reason: 'stop' },
    ]);
  });

  it('emits a tool call and reports tool_use completion', async () => {
    const p = new FakeModelProvider([[modelToolCall('read_file', { path: 'a' }, 'c1')]]);
    const events = await collect(p.stream(req, new AbortController().signal));
    expect(events[0]).toEqual({
      type: 'tool_call.completed',
      call: { id: 'c1', name: 'read_file', arguments: { path: 'a' } },
    });
    expect(events.at(-1)).toEqual({ type: 'completed', reason: 'tool_use' });
  });

  it('advances one scripted step per stream() call and records requests', async () => {
    const p = new FakeModelProvider([
      [modelToolCall('read_file', { path: 'a' }, 'c1')],
      [modelText('done'), modelFinal()],
    ]);
    await collect(p.stream(req, new AbortController().signal));
    const second = await collect(p.stream({ ...req, system: 'again' }, new AbortController().signal));
    expect(second.some((e) => e.type === 'text.delta' && e.text === 'done')).toBe(true);
    expect(p.calls).toBe(2);
    expect(p.requests.map((r) => r.system)).toEqual(['sys', 'again']);
  });

  it('respects a pre-aborted signal', async () => {
    const p = new FakeModelProvider([[modelText('x'), modelText('y')]]);
    const ac = new AbortController();
    ac.abort();
    const events = await collect(p.stream(req, ac.signal));
    expect(events).toEqual([]);
  });

  it('gracefully completes when the script is exhausted', async () => {
    const p = new FakeModelProvider([]);
    const events = await collect(p.stream(req, new AbortController().signal));
    expect(events).toEqual([{ type: 'completed', reason: 'stop' }]);
  });
});
