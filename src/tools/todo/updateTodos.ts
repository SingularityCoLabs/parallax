import { z } from 'zod';
import { TODO_TOOL_NAME } from '../../protocol/index.ts';
import { ok, truncateMiddle, type ToolDefinition } from '../core/index.ts';

/**
 * `update_todos` (Claude Code's TodoWrite). A stateless task-list tool: the model
 * sends the *entire* list every call and the runtime simply echoes it back, so
 * the "state" is just the latest call's arguments — the TUI renders them as a
 * live checklist (see TodoBlock). No persistence table is needed; the durable
 * message history already records each call.
 *
 * Risk is `read`: it has no side effects on the workspace, so it runs in every
 * permission mode and never triggers an approval prompt — exactly like the
 * planning scratchpad it models.
 */

const todoSchema = z.object({
  /** The imperative task, e.g. "Add the web_fetch tool". */
  content: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed']),
  /** Present-continuous label shown while active, e.g. "Adding the web_fetch tool". */
  activeForm: z.string().min(1).optional(),
});

const inputSchema = z.object({
  todos: z.array(todoSchema),
});

export type Todo = z.infer<typeof todoSchema>;
type Input = z.infer<typeof inputSchema>;

interface Output {
  todos: Todo[];
  counts: { total: number; pending: number; inProgress: number; completed: number };
}

const STATUS_MARK: Record<Todo['status'], string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

/** Render the list as compact text the model re-reads as its own working plan. */
function renderChecklist(todos: Todo[]): string {
  if (todos.length === 0) return '(todo list cleared)';
  return todos.map((t) => `${STATUS_MARK[t.status]} ${t.content}`).join('\n');
}

export function createUpdateTodosTool(deps: {
  maxModelChars: number;
}): ToolDefinition<Input, Output> {
  return {
    name: TODO_TOOL_NAME,
    description:
      'Create and maintain a structured task list for the current work. Send the COMPLETE list every ' +
      'time — it replaces the previous one. Use it to plan multi-step tasks and to show progress: keep ' +
      'exactly one task `in_progress` at a time and mark tasks `completed` as soon as they are done.',
    inputSchema,
    risk: 'read',
    resourceClass: 'pure_read',
    describe(_ctx, input) {
      const active = input.todos.find((t) => t.status === 'in_progress');
      return Promise.resolve({
        title: active
          ? `Todo: ${active.activeForm ?? active.content}`
          : `Todo (${input.todos.length})`,
      });
    },
    execute(ctx, input) {
      const counts = {
        total: input.todos.length,
        pending: input.todos.filter((t) => t.status === 'pending').length,
        inProgress: input.todos.filter((t) => t.status === 'in_progress').length,
        completed: input.todos.filter((t) => t.status === 'completed').length,
      };
      const summaryParts = [`${counts.total} todo${counts.total === 1 ? '' : 's'}`];
      if (counts.inProgress > 0) summaryParts.push(`${counts.inProgress} in progress`);
      if (counts.completed > 0) summaryParts.push(`${counts.completed} done`);
      const modelContent = truncateMiddle(renderChecklist(input.todos), {
        maxChars: deps.maxModelChars,
      }).text;
      return Promise.resolve(
        ok(ctx.callId, summaryParts.join(' · '), { todos: input.todos, counts }, { modelContent }),
      );
    },
  };
}
