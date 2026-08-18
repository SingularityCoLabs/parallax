import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { AssistantItem, UserItem, NoticeItem } from '../timeline.ts';
import { glyphs, type Theme } from '../theme.ts';

/** A user turn: a bold "you" label + the text they sent. */
export function UserMessage({ item, theme }: { item: UserItem; theme: Theme }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text color={theme.subtle} bold>
        you{' '}
      </Text>
      <Text color={theme.text}>{item.text}</Text>
    </Box>
  );
}

/**
 * An assistant response block, led by the Claude-orange bullet. While streaming,
 * a spinner sits in place of the bullet so the user sees liveness even before
 * the first token lands.
 */
export function AssistantMessage({
  item,
  theme,
}: {
  item: AssistantItem;
  theme: Theme;
}): React.ReactElement {
  return (
    <Box marginTop={1} flexDirection="row">
      <Box marginRight={1}>
        <Text color={theme.accent}>
          {item.streaming && item.text === '' ? <Spinner type="dots" /> : glyphs.bullet}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={theme.text}>{item.text}</Text>
      </Box>
    </Box>
  );
}

/** A runtime notice (cancelled / error / info). */
export function Notice({ item, theme }: { item: NoticeItem; theme: Theme }): React.ReactElement {
  const color =
    item.tone === 'error' ? theme.error : item.tone === 'warn' ? theme.warning : theme.subtle;
  return (
    <Box marginTop={1}>
      <Text color={color}>
        {item.tone === 'error' ? glyphs.cross : '•'} {item.text}
      </Text>
    </Box>
  );
}
