import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../theme.ts';

/**
 * Render a unified-diff-ish preview (the `+`/`-` lines Parallax's edit tools and
 * approval requests produce) with Claude Code's diff colors. Context lines are
 * dimmed; added/removed lines are green/red.
 */
export function DiffView({ diff, theme }: { diff: string; theme: Theme }): React.ReactElement {
  const lines = diff.replace(/\n$/, '').split('\n');
  return (
    <Box flexDirection="column" marginLeft={4}>
      {lines.map((line, i) => {
        const key = `${i}-${line}`;
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return (
            <Text key={key} color={theme.diffAdded}>
              {line}
            </Text>
          );
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          return (
            <Text key={key} color={theme.diffRemoved}>
              {line}
            </Text>
          );
        }
        return (
          <Text key={key} color={theme.subtle}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
