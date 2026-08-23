import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { glyphs, type Theme } from '../theme.ts';

/**
 * The launch splash, shown once when the interactive TUI opens (Claude Code
 * shows its logo box the same way). A large ASCII wordmark in the brand accent,
 * a greeting with the version, the active provider/model/mode, the working
 * directory, and a one-line hint. It is committed into the timeline's `<Static>`
 * region, so it prints once at the top and scrolls up as the conversation grows.
 *
 * Purely presentational: the `markColor` prop lets `AnimatedWelcome` pulse the
 * leading `✻` through a palette during the intro, then this same component
 * renders frozen (mark back to accent) as the durable header.
 */

/**
 * "Parallax" rendered in the figlet Standard font. Kept as a literal so there is
 * no runtime figlet dependency; regenerate with `figlet -f standard Parallax`.
 */
const WORDMARK: readonly string[] = [
  '  ____                 _ _',
  ' |  _ \\ __ _ _ __ __ _| | | __ ___  __',
  " | |_) / _` | '__/ _` | | |/ _` \\ \\/ /",
  ' |  __/ (_| | | | (_| | | | (_| |>  <',
  ' |_|   \\__,_|_|  \\__,_|_|_|\\__,_/_/\\_\\',
];

/** Color a permission mode to signal its risk at a glance (matches the footer). */
function modeColor(mode: string, theme: Theme): string {
  if (mode === 'read-only') return theme.subtle;
  if (mode === 'plan') return theme.permission;
  return theme.warning; // workspace: side effects possible
}

export interface WelcomeBannerProps {
  theme: Theme;
  version: string;
  provider: string;
  model: string;
  mode: string;
  cwd: string;
  /** Color of the leading `✻` mark; defaults to the accent (the intro pulses it). */
  markColor?: string;
}

export function WelcomeBanner({
  theme,
  version,
  provider,
  model,
  mode,
  cwd,
  markColor,
}: WelcomeBannerProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {WORDMARK.map((line, i) => (
          <Text key={i} color={theme.accent} bold>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={markColor ?? theme.accent}>{glyphs.star} </Text>
        <Text color={theme.text} bold>
          Welcome to Parallax
        </Text>
        <Text color={theme.subtle}> · v{version}</Text>
      </Box>

      <Box>
        <Text color={theme.subtle}>{'  '}</Text>
        <Text color={theme.accent}>
          {provider}:{model}
        </Text>
        <Text color={theme.subtle}> · </Text>
        <Text color={modeColor(mode, theme)}>{mode}</Text>
      </Box>

      <Box>
        <Text color={theme.subtle}>
          {'  '}
          {cwd}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.subtle}>{'  '}/help for help · shift+tab to switch mode</Text>
      </Box>
    </Box>
  );
}

/**
 * The colors the intro pulses the `✻` mark through before it settles on the
 * accent. A short lively cycle — enough to read as "starting up" without
 * dragging out the launch.
 */
function markPalette(theme: Theme): readonly string[] {
  return [theme.accent, theme.accentDim, theme.warning, theme.success, theme.permission];
}

/** Frames of the intro animation and the delay between them (≈1.1s total). */
const INTRO_FRAMES = 12;
const FRAME_MS = 90;

/**
 * Plays the launch splash with the `✻` mark cycling colors for about a second,
 * then calls `onDone` so the parent can freeze it into the static header. Pass a
 * stable `onDone` (memoized) — it is an effect dependency, so a new identity each
 * render would restart the animation.
 */
export function AnimatedWelcome({
  onDone,
  ...props
}: WelcomeBannerProps & { onDone: () => void }): React.ReactElement {
  const palette = markPalette(props.theme);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let f = 0;
    const id = setInterval(() => {
      f += 1;
      if (f >= INTRO_FRAMES) {
        clearInterval(id);
        onDone();
        return;
      }
      setFrame(f);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [onDone]);

  const markColor = palette[frame % palette.length]!;
  return <WelcomeBanner {...props} markColor={markColor} />;
}
