import { describe, it, expect } from 'vitest';
import { createUpdateTodosTool } from '../src/tools/todo/index.ts';
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

const tool = createUpdateTodosTool({ maxModelChars: 16_000 });

describe('update_todos tool', () => {
  it('is read-risk so it runs in every mode without approval', () => {
    expect(tool.risk).toBe('read');
    expect(tool.resourceClass).toBe('pure_read');
  });

  it('rejects an invalid status', () => {
    const parsed = tool.inputSchema.safeParse({ todos: [{ content: 'x', status: 'bogus' }] });
    expect(parsed.success).toBe(false);
  });

  it('echoes the list back with counts in the summary', async () => {
    const res = await tool.execute(ctx(), {
      todos: [
        { content: 'Write tool', status: 'completed' },
        { content: 'Wire it', status: 'in_progress' },
        { content: 'Test it', status: 'pending' },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.data?.counts).toEqual({ total: 3, pending: 1, inProgress: 1, completed: 1 });
    expect(res.summary).toMatch(/3 todos/);
    expect(res.summary).toMatch(/1 in progress/);
    expect(res.modelContent).toMatch(/\[x\] Write tool/);
    expect(res.modelContent).toMatch(/\[~\] Wire it/);
  });

  it("uses the active task's activeForm in the title", async () => {
    const desc = await tool.describe!(ctx(), {
      todos: [{ content: 'Add tool', status: 'in_progress', activeForm: 'Adding tool' }],
    });
    expect(desc.title).toContain('Adding tool');
  });

  it('handles an empty list (cleared)', async () => {
    const res = await tool.execute(ctx(), { todos: [] });
    expect(res.ok).toBe(true);
    expect(res.data?.counts.total).toBe(0);
    expect(res.modelContent).toMatch(/cleared/);
  });
});
