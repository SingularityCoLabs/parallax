import { describe, it, expect } from 'vitest';
import {
  parseRuntimeEvent,
  runtimeEventSchema,
  PROTOCOL_VERSION,
  type RuntimeEvent,
} from '../src/protocol/events.ts';
import { newSessionId, newTurnId, newToolCallId } from '../src/protocol/ids.ts';

function stamp<T extends { type: string }>(e: T): RuntimeEvent {
  return {
    v: PROTOCOL_VERSION,
    seq: 0,
    sessionId: 's',
    timestamp: 1,
    ...e,
  } as unknown as RuntimeEvent;
}

describe('protocol events', () => {
  it('round-trips a representative sample through the schema', () => {
    const samples: RuntimeEvent[] = [
      stamp({
        type: 'session.started',
        cwd: '/w',
        provider: 'fake',
        model: 'fake-1',
        permissionMode: 'workspace',
      }),
      stamp({ type: 'turn.started', turnId: 't', userText: 'hi' }),
      stamp({ type: 'assistant.delta', turnId: 't', text: 'hello' }),
      stamp({
        type: 'tool.proposed',
        turnId: 't',
        call: { id: 'c', name: 'read_file', arguments: { path: 'a' } },
      }),
      stamp({
        type: 'tool.completed',
        turnId: 't',
        result: { callId: 'c', ok: true, summary: 'ok', durationMs: 3 },
      }),
      stamp({ type: 'turn.completed', turnId: 't' }),
      stamp({ type: 'turn.failed', turnId: 't', errorCode: 'internal_error', message: 'boom' }),
    ];

    for (const s of samples) {
      const encoded = JSON.parse(JSON.stringify(s)) as unknown;
      const decoded = parseRuntimeEvent(encoded);
      expect(decoded).toEqual(s);
    }
  });

  it('rejects an event with an unknown type', () => {
    expect(() =>
      parseRuntimeEvent({ v: 1, seq: 0, sessionId: 's', timestamp: 1, type: 'nope' }),
    ).toThrow();
  });

  it('rejects a wrong protocol version', () => {
    const bad = { ...stamp({ type: 'turn.completed', turnId: 't' }), v: 2 };
    expect(runtimeEventSchema.safeParse(bad).success).toBe(false);
  });

  it('mints distinct ids', () => {
    expect(newSessionId()).not.toEqual(newSessionId());
    expect(newTurnId()).not.toEqual(newToolCallId());
  });
});
