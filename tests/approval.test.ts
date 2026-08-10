import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../src/app/index.ts';
import { defaultConfig } from '../src/config/index.ts';
import { InMemorySessionStore } from '../src/sessions/index.ts';
import { FakeModelProvider, modelText, modelToolCall, type FakeStep } from '../src/providers/index.ts';
import { FileStateCache, createFsReadTools, createFsWriteTools } from '../src/tools/fs/index.ts';
import type { RuntimeEvent } from '../src/protocol/index.ts';
import type { RuntimeFacade } from '../src/runtime/index.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'parallax-appr-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

interface Harness {
  facade: RuntimeFacade;
  events: RuntimeEvent[];
}

function harness(steps: FakeStep[], autoDecision: 'allow_once' | 'deny' | 'none'): Harness {
  const store = new InMemorySessionStore();
  const fileState = new FileStateCache();
  const provider = new FakeModelProvider(steps);
  const config = defaultConfig();
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
      for (const t of createFsWriteTools({ fileState, maxDiffChars: 4000 })) {
        r.register(t);
      }
    },
    // In tests we resolve approvals synchronously via the listener below; give a
    // small auto-deny so a "none" scenario can't hang the suite.
    approvalAutoDenyMs: 2000,
  });
  const events: RuntimeEvent[] = [];
  facade.subscribe((e) => {
    events.push(e);
    if (e.type === 'approval.requested' && autoDecision !== 'none') {
      facade.resolveApproval(e.request.id, autoDecision);
    }
  });
  return { facade, events };
}

describe('approval flow at the runtime level', () => {
  it('does not write before ASK is resolved, and allow_once permits the edit', async () => {
    const h = harness(
      [
        [modelToolCall('read_file', { path: 'src/app.ts' }, 'r1')],
        [modelToolCall('edit_file', { path: 'src/app.ts', oldText: 'x = 1', newText: 'x = 2' }, 'e1')],
        [modelText('done')],
      ],
      'allow_once',
    );
    const session = await h.facade.createSession({ cwd: root, permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'edit it');

    // Ordering: approval.requested precedes tool.started for the edit.
    const idxRequested = h.events.findIndex((e) => e.type === 'approval.requested');
    const idxStarted = h.events.findIndex(
      (e) => e.type === 'tool.started' && e.toolName === 'edit_file',
    );
    expect(idxRequested).toBeGreaterThanOrEqual(0);
    expect(idxStarted).toBeGreaterThan(idxRequested);
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toContain('x = 2');
  });

  it('deny blocks execution and the file is unchanged', async () => {
    const h = harness(
      [
        [modelToolCall('read_file', { path: 'src/app.ts' }, 'r1')],
        [modelToolCall('edit_file', { path: 'src/app.ts', oldText: 'x = 1', newText: 'x = 9' }, 'e1')],
        [modelText('ok, skipped')],
      ],
      'deny',
    );
    const session = await h.facade.createSession({ cwd: root, permissionMode: 'workspace' });
    await h.facade.startTurn(session.id, 'try edit');

    expect(h.events.some((e) => e.type === 'tool.started' && e.toolName === 'edit_file')).toBe(false);
    const failed = h.events.find((e) => e.type === 'tool.failed');
    if (failed?.type === 'tool.failed') expect(failed.result.error?.code).toBe('approval_denied');
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toContain('x = 1');
  });

  it('read-only mode technically blocks a write (deny, never asks)', async () => {
    const h = harness(
      [
        [modelToolCall('write_file', { path: 'src/new.ts', content: 'export const z = 3;\n' }, 'w1')],
        [modelText('cannot write in read-only')],
      ],
      'none',
    );
    const session = await h.facade.createSession({ cwd: root, permissionMode: 'read-only' });
    await h.facade.startTurn(session.id, 'write a file');

    // No approval was ever requested; the write was denied deterministically.
    expect(h.events.some((e) => e.type === 'approval.requested')).toBe(false);
    const failed = h.events.find((e) => e.type === 'tool.failed');
    if (failed?.type === 'tool.failed') expect(failed.result.error?.code).toBe('permission_denied');
    expect(existsSync(join(root, 'src', 'new.ts'))).toBe(false);
  });
});
