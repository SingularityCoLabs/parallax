/**
 * TUI color palette. Parallax's identity is the exact **#DC0000** brand red for
 * marks, borders, bullets, and the prompt. Blue handles interactive selection,
 * links, and permissions; orange handles warnings and other attention states.
 * Primary body text stays high-contrast (near-white on dark, near-black on
 * light) for readability — only secondary text is tinted.
 *
 * Values are truecolor `rgb(...)` strings that Ink passes through to the
 * terminal; on terminals without truecolor Ink degrades gracefully. These are
 * the semantic roles the components reference.
 */
export interface Theme {
  /** Brand accent (wordmark, prompt border, bullets). Red. */
  accent: string;
  /** Lighter accent for secondary emphasis / intro pulse. */
  accentDim: string;
  /** Highlighted/selected row in menus & completions. Blue. */
  selection: string;
  /** Permission/approval, links, and the mode indicator. Blue. */
  permission: string;
  /** Primary body text (high contrast). */
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

/** Exact brand primary requested for both terminal themes (#DC0000). */
export const BRAND_PRIMARY = 'rgb(220,0,0)';

/** Dark theme (default) — brand red, blue interactions, orange attention. */
export const darkTheme: Theme = {
  accent: BRAND_PRIMARY,
  // A brighter red is available for secondary emphasis and intro motion while
  // the exact requested red remains the canonical brand accent.
  accentDim: 'rgb(255,77,77)',
  selection: 'rgb(78,161,255)',
  permission: 'rgb(56,189,248)',
  text: 'rgb(242,244,248)',
  subtle: 'rgb(154,167,186)',
  success: 'rgb(60,203,127)',
  error: 'rgb(255,92,122)',
  warning: 'rgb(255,159,28)',
  diffAdded: 'rgb(60,203,127)',
  diffRemoved: 'rgb(255,92,122)',
};

/** Light theme — exact brand red with darker blue/orange semantic colors. */
export const lightTheme: Theme = {
  accent: BRAND_PRIMARY,
  accentDim: 'rgb(167,0,0)',
  selection: 'rgb(0,95,204)',
  permission: 'rgb(0,122,159)',
  text: 'rgb(25,28,32)',
  subtle: 'rgb(94,105,120)',
  success: 'rgb(19,122,67)',
  error: 'rgb(180,35,62)',
  warning: 'rgb(180,83,9)',
  diffAdded: 'rgb(19,122,67)',
  diffRemoved: 'rgb(180,35,62)',
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
