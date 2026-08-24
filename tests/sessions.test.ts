import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { SqliteSessionStore } from '../src/sessions/index.ts';
import { createRuntime } from '../src/app/index.ts';
import { defaultConfig } from '../src/config/index.ts';
import { FakeModelProvider, modelText, modelToolCall } from '../src/providers/index.ts';
import { ok, type ToolDefinition } from '../src/tools/core/index.ts';
import { PROTOCOL_VERSION, type RuntimeEvent } from '../src/protocol/index.ts';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'parallax-db-'));
  dbPath = join(dir, 'sessions.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const echoTool: ToolDefinition<{ text: string }, { echoed: string }> = {
  name: 'echo',
  description: 'echo',
  inputSchema: z.object({ text: z.string() }),
  risk: 'read',
  resourceClass: 'pure_read',
  execute: (ctx, input) => Promise.resolve(ok(ctx.callId, 'echoed', { echoed: input.text })),
};

describe('SqliteSessionStore', () => {
  it('persists sessions, turns, messages, and ordered events', async () => {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession({
      cwd: '/w',
      provider: 'fake',
      model: 'fake-1',
      permissionMode: 'workspace',
    });
    const turn = await store.createTurn(session.id, 'hi');
    await store.appendMessage({
      sessionId: session.id,
      turnId: turn.id,
      role: 'user',
      content: 'hi',
    });
    await store.appendEvent({
      v: PROTOCOL_VERSION,
      seq: 0,
      sessionId: session.id,
      timestamp: 1,
      type: 'turn.started',
      turnId: turn.id,
      userText: 'hi',
    } as RuntimeEvent);
    await store.appendEvent({
      v: PROTOCOL_VERSION,
      seq: 1,
      sessionId: session.id,
      timestamp: 2,
      type: 'turn.completed',
      turnId: turn.id,
    } as RuntimeEvent);
    store.close();

    // Reopen the same file — state survives process-like restart.
    const reopened = new SqliteSessionStore(dbPath);
    const loaded = await reopened.getSession(session.id);
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.permissionMode).toBe('workspace');

    const events = await reopened.listEvents(session.id);
    expect(events.map((e) => e.type)).toEqual(['turn.started', 'turn.completed']);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
    expect(await reopened.maxEventSeq(session.id)).toBe(1);

    const messages = await reopened.listMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe('hi');
    reopened.close();
  });

  it('gives every message a globally unique id across sessions (regression: messages.id PK collision)', async () => {
    // Repro of the original crash: message ids were `m<process-counter>-<per-session-seq>`.
    // The per-session seq restarts at 0 for each new session and the counter restarted
    // on every process launch, so the first message of the first session in any launch
    // was always `m1-0` — colliding on the second launch against a persistent DB.
    const ids = new Set<string>();
    const first = new SqliteSessionStore(dbPath);
    const s1 = await first.createSession({
      cwd: '/a',
      provider: 'fake',
      model: 'm',
      permissionMode: 'workspace',
    });
    const t1 = await first.createTurn(s1.id, 'hi');
    const m1 = await first.appendMessage({
      sessionId: s1.id,
      turnId: t1.id,
      role: 'user',
      content: 'hi',
    });
    ids.add(m1.id);
    first.close();

    // Reopen the same DB file — simulates a fresh process launch (counter would reset).
    const second = new SqliteSessionStore(dbPath);
    const s2 = await second.createSession({
      cwd: '/b',
      provider: 'fake',
      model: 'm',
      permissionMode: 'workspace',
    });
    const t2 = await second.createTurn(s2.id, 'hi again');
    // This is the append that used to throw `UNIQUE constraint failed: messages.id`.
    const m2 = await second.appendMessage({
      sessionId: s2.id,
      turnId: t2.id,
      role: 'user',
      content: 'hi again',
    });
    expect(ids.has(m2.id)).toBe(false);
    // Both sessions' first messages share seq 0 but must have distinct row ids.
    expect(m1.id).not.toBe(m2.id);
    expect(await second.listMessages(s1.id)).toHaveLength(1);
    expect(await second.listMessages(s2.id)).toHaveLength(1);
    second.close();
  });

  it('lists sessions most-recently-updated first', async () => {
    const store = new SqliteSessionStore(dbPath);
    const a = await store.createSession({
      cwd: '/a',
      provider: 'fake',
      model: 'm',
      permissionMode: 'workspace',
    });
    const b = await store.createSession({
      cwd: '/b',
      provider: 'fake',
      model: 'm',
      permissionMode: 'workspace',
    });
    // Touch a so it becomes most-recent.
    await store.appendEvent({
      v: PROTOCOL_VERSION,
      seq: 0,
      sessionId: a.id,
      timestamp: Date.now() + 1000,
      type: 'turn.completed',
      turnId: 't',
    } as RuntimeEvent);
    const list = await store.listSessions();
    expect(list[0]!.id).toBe(a.id);
    expect(list.map((s) => s.id)).toContain(b.id);
    store.close();
  });

  it('drives a full fake turn and reloads its history + resumes seq', async () => {
    const store = new SqliteSessionStore(dbPath);
    const provider = new FakeModelProvider([
      [modelText("I'll echo."), modelToolCall('echo', { text: 'persisted' }, 'c1')],
      [modelText('done')],
    ]);
    const facade = createRuntime({
      config: defaultConfig(),
      provider,
      store,
      registerTools: (r) => r.register(echoTool),
    });
    const session = await facade.createSession({ cwd: '/w', permissionMode: 'workspace' });
    await facade.startTurn(session.id, 'go');

    const events = await store.listEvents(session.id);
    const seqs = events.map((e) => e.seq);
    // Strictly increasing, contiguous from 0.
    expect(seqs).toEqual(seqs.map((_, i) => i));
    expect(events.some((e) => e.type === 'tool.completed')).toBe(true);

    const toolMessage = (await store.listMessages(session.id)).find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('persisted');

    // Resume: a new facade on the same file continues the seq without collision.
    store.close();
    const store2 = new SqliteSessionStore(dbPath);
    const facade2 = createRuntime({
      config: defaultConfig(),
      provider: new FakeModelProvider([[modelText('resumed reply')]]),
      store: store2,
      registerTools: (r) => r.register(echoTool),
    });
    const resumed = await facade2.resumeSession(session.id);
    expect(resumed?.id).toBe(session.id);
    const before = await store2.maxEventSeq(session.id);
    await facade2.startTurn(session.id, 'again');
    const after = await store2.listEvents(session.id);
    // New events strictly follow the old max seq (no duplicates/gaps at the seam).
    const newSeqs = after.map((e) => e.seq).filter((s) => s > before);
    expect(newSeqs[0]).toBe(before + 1);
    expect(new Set(after.map((e) => e.seq)).size).toBe(after.length);
    store2.close();
  });
});
