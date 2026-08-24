import React from 'react';
import { Box, Text } from 'ink';
import type { ToolItem } from '../timeline.ts';
import { type Theme } from '../theme.ts';

/**
 * Renders an `update_todos` call as a live checklist (Claude Code's todo panel).
 * The list is read from the tool call's arguments (`item.args.todos`), which the
 * reducer already captured — the tool has no separate state. Defensive parsing:
 * the model's arguments are untrusted shape until the tool validates them, and
 * this renders off the proposed args (before execution).
 */
interface TodoView {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const MARK: Record<TodoView['status'], string> = {
  pending: '☐',
  in_progress: '◐',
  completed: '☑',
};

function parseTodos(args: Record<string, unknown>): TodoView[] {
  const raw = args['todos'];
  if (!Array.isArray(raw)) return [];
  const out: TodoView[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object') {
      const content = (entry as Record<string, unknown>)['content'];
      const status = (entry as Record<string, unknown>)['status'];
      if (typeof content === 'string') {
        const s: TodoView['status'] =
          status === 'in_progress' || status === 'completed' ? status : 'pending';
        out.push({ content, status: s });
      }
    }
  }
  return out;
}

export function TodoBlock({ tool, theme }: { tool: ToolItem; theme: Theme }): React.ReactElement {
  const todos = parseTodos(tool.args);
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.accent}>{'⏺'}</Text>
        <Text> </Text>
        <Text color={theme.text} bold>
          Todos{' '}
        </Text>
        <Text color={theme.subtle}>
          ({done}/{todos.length})
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {todos.length === 0 ? (
          <Text color={theme.subtle}>(empty)</Text>
        ) : (
          todos.map((t, i) => {
            const color =
              t.status === 'completed'
                ? theme.success
                : t.status === 'in_progress'
                  ? theme.accent
                  : theme.subtle;
            return (
              <Text key={`${i}-${t.content}`} color={color}>
                {MARK[t.status]}{' '}
                {t.status === 'completed' ? <Text strikethrough>{t.content}</Text> : t.content}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}
