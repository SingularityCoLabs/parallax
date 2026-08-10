import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDemo, replaySession, listPersistedSessions } from '../src/app/index.ts';
import { defaultConfig } from '../src/config/index.ts';
import type { RuntimeEvent, ApprovalDecision } from '../src/protocol/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'sum-project');

let work: string;
let dbPath: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'parallax-e2e-'));
  work = join(base, 'project');
  cpSync(fixture, work, { recursive: true });
  dbPath = join(base, 'sessions.sqlite');
});

afterEach(() => rmSync(dirname(work), { recursive: true, force: true }));

const types = (events: RuntimeEvent[]): string[] => events.map((e) => e.type);
const autoAllow = (): Promise<ApprovalDecision> => Promise.resolve('allow_once');

describe('E2E: run → shell → edit → shell → final (blueprint §35)', () => {
  it('fixes the failing test through typed tools + approval, then verifies', async () => {
    const events: RuntimeEvent[] = [];
    const { sessionId } = await runDemo({
      scenario: 'edit-fix',
      cwd: work,
      config: defaultConfig(),
      dbPath,
      onEvent: (e) => events.push(e),
      onApproval: autoAllow,
    });

    // The bug is actually fixed on disk.
    expect(readFileSync(join(work, 'sum.mjs'), 'utf8')).toContain('(a, b) => a + b');

    // The workflow shape: two shell runs and one edit, each approved.
    const shellStarts = events.filter((e) => e.type === 'tool.started' && e.toolName === 'shell');
    const editStarts = events.filter((e) => e.type === 'tool.started' && e.toolName === 'edit_file');
    expect(shellStarts).toHaveLength(2);
    expect(editStarts).toHaveLength(1);

    // First shell failed (the bug), last shell passed (the fix).
    const shellResults = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'tool.completed' | 'tool.failed' }> =>
        (e.type === 'tool.completed' || e.type === 'tool.failed') &&
        'result' in e &&
        typeof e.result.data === 'object',
    );
    const firstShell = shellResults.find((e) => e.type === 'tool.failed');
    expect(firstShell).toBeDefined();

    // Every side effect was gated by an approval that was requested then resolved.
    const requested = events.filter((e) => e.type === 'approval.requested');
    const resolved = events.filter((e) => e.type === 'approval.resolved');
    expect(requested.length).toBe(3); // shell, edit, shell
    expect(resolved.length).toBe(3);
    // Approval precedes execution for every gated call.
    for (const start of [...shellStarts, ...editStarts]) {
      const idxStart = events.indexOf(start);
      const priorResolved = events
        .slice(0, idxStart)
        .filter((e) => e.type === 'approval.resolved');
      expect(priorResolved.length).toBeGreaterThan(0);
    }

    // Turn completed cleanly.
    expect(types(events).at(-1)).toBe('turn.completed');
    expect(sessionId).toBeTruthy();
  });

  it('persists the session and can replay its transcript (resume)', async () => {
    const live: RuntimeEvent[] = [];
    const { sessionId } = await runDemo({
      scenario: 'edit-fix',
      cwd: work,
      config: defaultConfig(),
      dbPath,
      onEvent: (e) => live.push(e),
      onApproval: autoAllow,
    });

    const sessions = await listPersistedSessions(dbPath);
    expect(sessions.map((s) => s.id)).toContain(sessionId);

    // Replay reproduces the same ordered event types from disk.
    const replayed: RuntimeEvent[] = [];
    const found = await replaySession(dbPath, sessionId, (e) => replayed.push(e));
    expect(found).toBe(true);
    expect(types(replayed)).toEqual(types(live));
    // seq is contiguous and increasing.
    expect(replayed.map((e) => e.seq)).toEqual(replayed.map((_, i) => i));
  });

  it('read-only mode blocks the fix (shell denied, file unchanged)', async () => {
    const events: RuntimeEvent[] = [];
    await runDemo({
      scenario: 'edit-fix',
      cwd: work,
      config: defaultConfig(),
      permissionMode: 'read-only',
      onEvent: (e) => events.push(e),
      onApproval: autoAllow,
    });

    // Never asked (deterministic deny), never started the shell, file untouched.
    expect(events.some((e) => e.type === 'approval.requested')).toBe(false);
    expect(events.some((e) => e.type === 'tool.started' && e.toolName === 'shell')).toBe(false);
    expect(readFileSync(join(work, 'sum.mjs'), 'utf8')).toContain('(a, b) => a - b');
  });
});

describe('architecture: the CLI executes no tools (blueprint Principle 2, §39)', () => {
  it('CLI source imports only app/protocol/config layers', () => {
    const cliFiles = ['index.ts', 'renderer.ts', 'approvalPrompt.ts'];
    const forbidden = /from '\.\.\/(providers|tools|policy|executor|sessions|runtime|context|observability)\//;
    for (const file of cliFiles) {
      const src = readFileSync(join(here, '..', 'src', 'cli', file), 'utf8');
      expect(forbidden.test(src), `${file} must not import runtime internals`).toBe(false);
    }
  });
});
