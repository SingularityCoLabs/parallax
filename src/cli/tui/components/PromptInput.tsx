import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { glyphs, type Theme } from '../theme.ts';
import { completionsFor, type SlashCommand } from '../slashCommands.ts';

/**
 * The bordered prompt input, styled after Claude Code's PromptInput: a round
 * border in the accent color, a caret, a placeholder when empty, in-session
 * history (↑/↓), and a slash-command autocomplete menu that appears while typing
 * a `/command`.
 *
 * While the completion menu is open, ↑/↓ move the highlighted command (wrapping),
 * **Enter** runs the highlighted command, and **Tab** completes its name (adding
 * a space so an argument can follow). When the menu is closed, ↑/↓ recall input
 * history. Built on Ink's `useInput` so we fully own this behavior; disabled
 * (dimmed) while a turn is in flight or an approval is pending.
 */

/** Rows shown in the completion menu at once (windowed around the selection). */
const MENU_VISIBLE = 8;

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
  // Highlighted row in the slash-command menu (only meaningful while it's open).
  const [selected, setSelected] = useState(0);

  const completions = completionsFor(value);
  const menuOpen = completions.length > 0;

  /** Edit the input text and reset the menu highlight to the top. */
  const edit = (next: string): void => {
    setValue(next);
    setSelected(0);
  };

  const submitLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    setHistory((h) => [...h, trimmed]);
    setHistIdx(undefined);
    setValue('');
    setSelected(0);
    onSubmit(trimmed);
  };

  useInput(
    (input, key) => {
      if (disabled) return;

      // --- Completion menu is open: ↑/↓ select, Enter runs, Tab completes. ---
      if (menuOpen && (key.upArrow || key.downArrow || key.return || key.tab)) {
        const count = completions.length;
        if (key.upArrow) {
          setSelected((i) => (i - 1 + count) % count);
          return;
        }
        if (key.downArrow) {
          setSelected((i) => (i + 1) % count);
          return;
        }
        const chosen = completions[Math.min(selected, count - 1)] ?? completions[0]!;
        if (key.return) {
          // Run the highlighted command as-is; the handler decides what a bare
          // command means (e.g. `/model` opens the picker).
          submitLine(`/${chosen.name}`);
          return;
        }
        // Tab: complete the name and add a space so an argument can be typed.
        edit(`/${chosen.name} `);
        return;
      }

      if (key.return) {
        submitLine(value);
        return;
      }

      if (key.upArrow) {
        if (history.length === 0) return;
        const next = histIdx === undefined ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(next);
        edit(history[next] ?? '');
        return;
      }
      if (key.downArrow) {
        if (histIdx === undefined) return;
        const next = histIdx + 1;
        if (next >= history.length) {
          setHistIdx(undefined);
          edit('');
        } else {
          setHistIdx(next);
          edit(history[next] ?? '');
        }
        return;
      }

      if (key.backspace || key.delete) {
        edit(value.slice(0, -1));
        return;
      }

      // Ignore other control keys (ctrl/meta chords handled at the App level).
      if (key.ctrl || key.meta || key.escape || key.tab) return;
      if (input) edit(value + input);
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

      {menuOpen && <CompletionMenu theme={theme} rows={completions} selected={selected} />}
    </Box>
  );
}

/** The slash-command autocomplete list, windowed so the selection stays visible. */
function CompletionMenu({
  theme,
  rows,
  selected,
}: {
  theme: Theme;
  rows: SlashCommand[];
  selected: number;
}): React.ReactElement {
  const sel = Math.min(selected, rows.length - 1);
  const start =
    rows.length <= MENU_VISIBLE
      ? 0
      : Math.min(Math.max(0, sel - Math.floor(MENU_VISIBLE / 2)), rows.length - MENU_VISIBLE);
  const slice = rows.slice(start, start + MENU_VISIBLE);
  return (
    <Box flexDirection="column" marginLeft={2}>
      {slice.map((c, i) => {
        const active = start + i === sel;
        return (
          <Box key={c.name}>
            <Text color={active ? theme.selection : theme.subtle}>{active ? '❯ ' : '  '}</Text>
            <Text color={active ? theme.selection : theme.text} bold={active}>
              /{c.name}
            </Text>
            {c.arg !== undefined && <Text color={theme.subtle}> {c.arg}</Text>}
            <Text color={theme.subtle}> — {c.summary}</Text>
          </Box>
        );
      })}
      {rows.length > slice.length && (
        <Text color={theme.subtle}>
          {'  '}… {rows.length - slice.length} more
        </Text>
      )}
    </Box>
  );
}
