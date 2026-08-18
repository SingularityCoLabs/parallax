import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { glyphs, type Theme } from '../theme.ts';

/** Color a permission mode to signal its risk at a glance. */
function modeColor(mode: string, theme: Theme): string {
  if (mode === 'read-only') return theme.subtle;
  if (mode === 'plan') return theme.permission;
  return theme.warning; // workspace: side effects possible
}

/**
 * The status footer beneath the prompt: provider:model, permission mode, a
 * running-cost hint, and the key hints. Mirrors Claude Code's
 * PromptInputFooter — compact, dim, single line.
 */
export function Footer({
  theme,
  provider,
  model,
  mode,
  usage,
  active,
}: {
  theme: Theme;
  provider: string;
  model: string;
  mode: string;
  usage: { input: number; output: number };
  active: boolean;
}): React.ReactElement {
  const tokens = usage.input + usage.output;
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        <Text color={theme.accent}>
          {provider}:{model}
        </Text>
        <Text color={theme.subtle}> · </Text>
        <Text color={modeColor(mode, theme)}>{mode}</Text>
        {tokens > 0 && <Text color={theme.subtle}> · {tokens} tok</Text>}
      </Box>
      <Box>
        {active ? (
          <Text color={theme.accent}>
            <Spinner type="dots" /> <Text color={theme.subtle}>esc to interrupt</Text>
          </Text>
        ) : (
          <Text color={theme.subtle}>{glyphs.star} shift+tab mode · /help · ⏎ send</Text>
        )}
      </Box>
    </Box>
  );
}
