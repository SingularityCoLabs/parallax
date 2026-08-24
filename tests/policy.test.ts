import { describe, it, expect } from 'vitest';
import { PolicyEngine, classifyCommand } from '../src/policy/index.ts';
import type { PermissionContext } from '../src/policy/index.ts';
import type { PermissionMode, ToolRisk } from '../src/protocol/index.ts';

const engine = new PolicyEngine();

function ctx(over: Partial<PermissionContext>): PermissionContext {
  return {
    sessionId: 's',
    turnId: 't',
    workspaceRoot: '/w',
    mode: 'workspace',
    toolName: 'tool',
    toolCallId: 'c1',
    risk: 'read',
    outsideWorkspace: false,
    actionTitle: 'do a thing',
    ...over,
  };
}

interface Case {
  name: string;
  mode: PermissionMode;
  risk: ToolRisk;
  outsideWorkspace?: boolean;
  expected: 'allow' | 'ask' | 'deny';
}

const cases: Case[] = [
  // Escapes always deny, regardless of mode/risk.
  {
    name: 'escape read (workspace)',
    mode: 'workspace',
    risk: 'read',
    outsideWorkspace: true,
    expected: 'deny',
  },
  {
    name: 'escape read (read-only)',
    mode: 'read-only',
    risk: 'read',
    outsideWorkspace: true,
    expected: 'deny',
  },
  {
    name: 'escape write',
    mode: 'workspace',
    risk: 'write',
    outsideWorkspace: true,
    expected: 'deny',
  },

  // read-only mode: reads allowed, everything else denied.
  { name: 'read-only + read', mode: 'read-only', risk: 'read', expected: 'allow' },
  { name: 'read-only + write', mode: 'read-only', risk: 'write', expected: 'deny' },
  { name: 'read-only + destructive', mode: 'read-only', risk: 'destructive', expected: 'deny' },
  { name: 'read-only + network', mode: 'read-only', risk: 'network', expected: 'deny' },
  {
    name: 'read-only + external_write',
    mode: 'read-only',
    risk: 'external_write',
    expected: 'deny',
  },

  // workspace mode: reads allowed, side effects ask.
  { name: 'workspace + read', mode: 'workspace', risk: 'read', expected: 'allow' },
  { name: 'workspace + write', mode: 'workspace', risk: 'write', expected: 'ask' },
  { name: 'workspace + destructive', mode: 'workspace', risk: 'destructive', expected: 'ask' },
  { name: 'workspace + network', mode: 'workspace', risk: 'network', expected: 'ask' },
  {
    name: 'workspace + external_write',
    mode: 'workspace',
    risk: 'external_write',
    expected: 'ask',
  },

  // plan mode: gates identically to read-only (allow reads, deny side effects).
  { name: 'plan + read', mode: 'plan', risk: 'read', expected: 'allow' },
  { name: 'plan + write', mode: 'plan', risk: 'write', expected: 'deny' },
  { name: 'plan + destructive', mode: 'plan', risk: 'destructive', expected: 'deny' },
  { name: 'plan + network', mode: 'plan', risk: 'network', expected: 'deny' },
  { name: 'plan + external_write', mode: 'plan', risk: 'external_write', expected: 'deny' },

  // bypass mode: auto-approve everything in-workspace (no prompts).
  { name: 'bypass + read', mode: 'bypass', risk: 'read', expected: 'allow' },
  { name: 'bypass + write', mode: 'bypass', risk: 'write', expected: 'allow' },
  { name: 'bypass + destructive', mode: 'bypass', risk: 'destructive', expected: 'allow' },
  { name: 'bypass + network', mode: 'bypass', risk: 'network', expected: 'allow' },
  { name: 'bypass + external_write', mode: 'bypass', risk: 'external_write', expected: 'allow' },
  // …but the workspace-escape guardrail still applies.
  {
    name: 'bypass + escape',
    mode: 'bypass',
    risk: 'write',
    outsideWorkspace: true,
    expected: 'deny',
  },
];

describe('PolicyEngine decision table', () => {
  for (const c of cases) {
    it(c.name, () => {
      const decision = engine.evaluate(
        ctx({ mode: c.mode, risk: c.risk, outsideWorkspace: c.outsideWorkspace ?? false }),
      );
      expect(decision.kind).toBe(c.expected);
    });
  }

  it('read-only technically blocks writes (not a suggestion)', () => {
    const decision = engine.evaluate(ctx({ mode: 'read-only', risk: 'write' }));
    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') expect(decision.reason).toMatch(/read-only/);
  });

  it('ASK builds an approval request carrying the tool call id and title', () => {
    const decision = engine.evaluate(
      ctx({ risk: 'write', toolName: 'edit_file', toolCallId: 'call-9', actionTitle: 'Edit a.ts' }),
    );
    expect(decision.kind).toBe('ask');
    if (decision.kind === 'ask') {
      expect(decision.approval.toolCallId).toBe('call-9');
      expect(decision.approval.toolName).toBe('edit_file');
      expect(decision.approval.title).toBe('Edit a.ts');
      expect(decision.approval.risk).toBe('write');
    }
  });

  it('surfaces a destructive shell command in the approval detail', () => {
    const decision = engine.evaluate(
      ctx({
        risk: 'destructive',
        toolName: 'shell',
        command: 'rm -rf build',
        actionTitle: 'Run rm -rf build',
      }),
    );
    expect(decision.kind).toBe('ask');
    if (decision.kind === 'ask') {
      expect(decision.approval.detail ?? '').toMatch(/⚠/);
    }
  });

  it('passes a diff preview through to the approval request', () => {
    const decision = engine.evaluate(ctx({ risk: 'write', diffPreview: '- old\n+ new' }));
    if (decision.kind === 'ask') {
      expect(decision.approval.diffPreview).toBe('- old\n+ new');
    }
  });
});

describe('present_plan gate', () => {
  it('ASKs in plan mode (approving it exits plan mode)', () => {
    const decision = engine.evaluate(
      ctx({ toolName: 'present_plan', risk: 'read', mode: 'plan', actionTitle: 'Ready to code?' }),
    );
    expect(decision.kind).toBe('ask');
    if (decision.kind === 'ask') {
      expect(decision.approval.toolName).toBe('present_plan');
      expect(decision.approval.title).toBe('Ready to code?');
    }
  });

  it('ALLOWs in workspace mode (nothing to switch)', () => {
    const decision = engine.evaluate(
      ctx({ toolName: 'present_plan', risk: 'read', mode: 'workspace' }),
    );
    expect(decision.kind).toBe('allow');
  });

  it('ALLOWs in read-only mode', () => {
    const decision = engine.evaluate(
      ctx({ toolName: 'present_plan', risk: 'read', mode: 'read-only' }),
    );
    expect(decision.kind).toBe('allow');
  });

  it('still DENYs when the (irrelevant) path escapes the workspace', () => {
    const decision = engine.evaluate(
      ctx({ toolName: 'present_plan', risk: 'read', mode: 'plan', outsideWorkspace: true }),
    );
    expect(decision.kind).toBe('deny');
  });

  it('does not gate present_plan in bypass mode (auto-approved like everything else)', () => {
    const decision = engine.evaluate(
      ctx({ toolName: 'present_plan', risk: 'read', mode: 'bypass' }),
    );
    expect(decision.kind).toBe('allow');
  });
});

describe('classifyCommand', () => {
  it('flags recursive force remove', () => {
    expect(classifyCommand('rm -rf /tmp/x').destructive).toBe(true);
  });
  it('flags sudo, force push, and fork bombs', () => {
    expect(classifyCommand('sudo apt install x').destructive).toBe(true);
    expect(classifyCommand('git push --force origin main').destructive).toBe(true);
    expect(classifyCommand(':(){ :|:& };:').destructive).toBe(true);
  });
  it('treats ordinary commands as non-destructive', () => {
    expect(classifyCommand('pnpm test').destructive).toBe(false);
    expect(classifyCommand('git status').destructive).toBe(false);
    expect(classifyCommand('node --version').destructive).toBe(false);
  });
});
