/**
 * TUI color palette, ported from the Claude Code snapshot's theme
 * (`claude-code/src/utils/theme.ts`) so Parallax's terminal UI shares its visual
 * language. Values are truecolor `rgb(...)` strings that Ink passes through to
 * the terminal; on terminals without truecolor Ink degrades gracefully.
 *
 * These are the semantic roles the components reference — not every Claude Code
 * key, just the ones Parallax renders.
 */
export interface Theme {
  /** Brand accent (assistant bullet, prompt border). Claude orange. */
  accent: string;
  /** Lighter accent for secondary emphasis. */
  accentDim: string;
  /** Permission/approval + suggestions. Medium blue. */
  permission: string;
  /** Primary body text. */
  text: string;
  /** De-emphasized text (metadata, hints, tool output). */
  subtle: string;
  success: string;
  error: string;
  warning: string;
  /** Diff line colors. */
  diffAdded: string;
  diffRemoved: string;
}

/** Dark theme (default) — matches Claude Code's dark palette. */
export const darkTheme: Theme = {
  accent: 'rgb(215,119,87)', // Claude orange
  accentDim: 'rgb(245,149,117)',
  permission: 'rgb(120,138,255)', // medium blue, slightly brightened for dark bg
  text: 'rgb(230,230,230)',
  subtle: 'rgb(140,140,140)',
  success: 'rgb(65,160,85)',
  error: 'rgb(220,90,110)',
  warning: 'rgb(220,170,60)',
  diffAdded: 'rgb(80,180,110)',
  diffRemoved: 'rgb(220,90,110)',
};

/** Light theme — the Claude Code light palette. */
export const lightTheme: Theme = {
  accent: 'rgb(215,119,87)',
  accentDim: 'rgb(180,90,60)',
  permission: 'rgb(87,105,247)',
  text: 'rgb(30,30,30)',
  subtle: 'rgb(110,110,110)',
  success: 'rgb(44,122,57)',
  error: 'rgb(171,43,63)',
  warning: 'rgb(150,110,20)',
  diffAdded: 'rgb(44,122,57)',
  diffRemoved: 'rgb(171,43,63)',
};

export type ThemeName = 'dark' | 'light';

export function getTheme(name: ThemeName = 'dark'): Theme {
  return name === 'light' ? lightTheme : darkTheme;
}

/** Iconography, matching Claude Code's glyphs. */
export const glyphs = {
  /** Assistant response bullet. */
  bullet: '⏺',
  /** Tool-result continuation line. */
  branch: '└',
  /** Spinner star (thinking). */
  star: '✻',
  /** Approved / completed. */
  check: '✓',
  /** Denied / failed. */
  cross: '✗',
  /** Prompt caret. */
  caret: '›',
} as const;
