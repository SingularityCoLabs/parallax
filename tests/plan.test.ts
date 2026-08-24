import { describe, it, expect } from 'vitest';
import { createPresentPlanTool } from '../src/tools/plan/index.ts';
import type { ToolExecutionContext } from '../src/tools/core/index.ts';
import { getLogger } from '../src/observability/index.ts';

function ctx(): ToolExecutionContext {
  return {
    callId: 'c1',
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
    emitStdout: () => {},
    emitStderr: () => {},
    logger: getLogger(),
  };
}

const tool = createPresentPlanTool({ maxModelChars: 16_000 });

describe('present_plan tool', () => {
  it('is named present_plan and is read-risk (the gate lives in policy/runtime)', () => {
    expect(tool.name).toBe('present_plan');
    expect(tool.risk).toBe('read');
  });

  it('requires a non-empty plan', () => {
    expect(tool.inputSchema.safeParse({ plan: '' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ plan: '1. do a thing' }).success).toBe(true);
  });

  it('echoes the plan text back to the model', async () => {
    const res = await tool.execute(ctx(), { plan: '1. Read files\n2. Edit\n3. Test' });
    expect(res.ok).toBe(true);
    expect(res.data?.plan).toMatch(/Read files/);
    expect(res.modelContent).toMatch(/3\. Test/);
  });

  it('describes itself as the exit-plan-mode gate for the approval prompt', async () => {
    const desc = await tool.describe!(ctx(), { plan: 'x' });
    expect(desc.title.toLowerCase()).toMatch(/plan mode|start executing/);
  });
});
