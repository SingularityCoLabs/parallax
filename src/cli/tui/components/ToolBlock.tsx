import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ToolItem } from '../timeline.ts';
import { glyphs, type Theme } from '../theme.ts';

/**
 * A Claude Code-style tool block:
 *
 *   ⏺ Bash(node --test)
 *     └ ran node --test (120ms)
 *       <trimmed output>
 *
 * The bullet is accent-colored while running, green on success, red on failure.
 * Output is dimmed and clipped to the last few lines to keep the transcript
 * scannable (full output is always in the session store).
 */
const MAX_OUTPUT_LINES = 8;

function clipTail(text: string, max: number): string[] {
  const lines = text.replace(/\n$/, '').split('\n');
  return lines.length > max ? lines.slice(lines.length - max) : lines;
}

export function ToolBlock({ tool, theme }: { tool: ToolItem; theme: Theme }): React.ReactElement {
  const running = tool.status === 'running' || tool.status === 'proposed';
  const bulletColor =
    tool.status === 'failed'
      ? theme.error
      : tool.status === 'completed'
        ? theme.success
        : theme.accent;

  const output = (tool.stdout + (tool.stderr ? `\n${tool.stderr}` : '')).trim();
  const outputLines = output ? clipTail(output, MAX_OUTPUT_LINES) : [];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={bulletColor}>{running ? <Spinner type="dots" /> : glyphs.bullet}</Text>
        <Text> </Text>
        <Text color={theme.text} bold>
          {tool.title}
        </Text>
      </Box>

      {tool.summary !== undefined && (
        <Box marginLeft={2}>
          <Text color={theme.subtle}>{glyphs.branch} </Text>
          <Text color={tool.status === 'failed' ? theme.error : theme.subtle}>
            {tool.summary}
            {tool.durationMs !== undefined ? ` (${tool.durationMs}ms)` : ''}
          </Text>
        </Box>
      )}

      {outputLines.length > 0 && (
        <Box flexDirection="column" marginLeft={4}>
          {outputLines.map((line, i) => (
            <Text key={`${i}-${line}`} color={theme.subtle} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
