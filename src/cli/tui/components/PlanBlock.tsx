import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ToolItem } from '../timeline.ts';
import { glyphs, type Theme } from '../theme.ts';

/**
 * Renders a `present_plan` call: the proposed plan in a bordered panel (the plan
 * text comes from the tool call's `plan` argument). Because `tool.proposed` is
 * emitted before `approval.requested`, this block appears directly above the
 * approval prompt — so the user reads the full plan, then answers "approve to
 * exit plan mode and start executing".
 */
export function PlanBlock({ tool, theme }: { tool: ToolItem; theme: Theme }): React.ReactElement {
  const plan = typeof tool.args['plan'] === 'string' ? (tool.args['plan'] as string) : '';
  const running = tool.status === 'running' || tool.status === 'proposed';
  const bulletColor =
    tool.status === 'failed'
      ? theme.error
      : tool.status === 'completed'
        ? theme.success
        : theme.permission;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={bulletColor}>{running ? <Spinner type="dots" /> : glyphs.bullet}</Text>
        <Text> </Text>
        <Text color={theme.text} bold>
          Plan
        </Text>
      </Box>
      <Box
        flexDirection="column"
        marginLeft={2}
        borderStyle="round"
        borderColor={theme.permission}
        paddingX={1}
      >
        {plan.split('\n').map((line, i) => (
          <Text key={`${i}-${line}`} color={theme.text}>
            {line === '' ? ' ' : line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
