import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { glyphs, type Theme } from '../theme.ts';
import { completionsFor } from '../slashCommands.ts';

/**
 * The bordered prompt input, styled after Claude Code's PromptInput: a round
 * border in the accent color, a caret, a placeholder when empty, in-session
 * history (↑/↓), and a slash-command autocomplete menu that appears while typing
 * a `/command`. Tab/Enter on a sole completion fills it in.
 *
 * Built on Ink's `useInput` rather than a text-input dependency so we fully own
 * the slash-completion + history behavior. Disabled (dimmed) while a turn is in
 * flight or an approval is pending — those own the keyboard.
 */
export function PromptInput({
  theme,
  disabled,
  placeholder,
  onSubmit,
}: {
  theme: Theme;
  disabled: boolean;
  placeholder: string;
  onSubmit: (text: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | undefined>(undefined);

  const completions = completionsFor(value);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        // Tab-like completion: a single slash match becomes the value first.
        const line = value.trim();
        if (line === '') return;
        setHistory((h) => [...h, line]);
        setHistIdx(undefined);
        setValue('');
        onSubmit(line);
        return;
      }

      if (key.tab && completions.length > 0) {
        setValue(`/${completions[0]!.name} `);
        return;
      }

      if (key.upArrow) {
        if (history.length === 0) return;
        const next = histIdx === undefined ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(next);
        setValue(history[next] ?? '');
        return;
      }
      if (key.downArrow) {
        if (histIdx === undefined) return;
        const next = histIdx + 1;
        if (next >= history.length) {
          setHistIdx(undefined);
          setValue('');
        } else {
          setHistIdx(next);
          setValue(history[next] ?? '');
        }
        return;
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }

      // Ignore other control keys (ctrl/meta chords handled at the App level).
      if (key.ctrl || key.meta || key.escape) return;
      if (input) setValue((v) => v + input);
    },
    { isActive: !disabled },
  );

  const showPlaceholder = value === '';

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={disabled ? theme.subtle : theme.accent} paddingX={1}>
        <Text color={theme.accent}>{glyphs.caret} </Text>
        {showPlaceholder ? (
          <Text color={theme.subtle}>{placeholder}</Text>
        ) : (
          <Text color={theme.text}>{value}</Text>
        )}
      </Box>

      {completions.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {completions.slice(0, 6).map((c, i) => (
            <Box key={c.name}>
              <Text color={i === 0 ? theme.accent : theme.subtle}>/{c.name}</Text>
              {c.arg !== undefined && <Text color={theme.subtle}> {c.arg}</Text>}
              <Text color={theme.subtle}> — {c.summary}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
