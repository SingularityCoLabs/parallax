/**
 * TUI color palette. Parallax's identity is a **red** accent (brand marks,
 * borders, bullets, prompt), **purple** for the selected/highlighted row in
 * menus, and **blue** for links, the permission/approval color, and the mode
 * indicator. Primary body text stays high-contrast (near-white on dark,
 * near-black on light) for readability — only secondary text is tinted.
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
  /** Highlighted/selected row in menus & completions. Purple. */
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

/** Dark theme (default) — red accent, purple selection, blue links. */
export const darkTheme: Theme = {
  accent: 'rgb(235,75,75)', // brand red
  accentDim: 'rgb(250,130,130)',
  selection: 'rgb(180,140,255)', // purple — selected row
  permission: 'rgb(95,155,255)', // blue — approvals, links, mode
  text: 'rgb(232,232,232)',
  subtle: 'rgb(140,150,170)', // blue-tinted gray for secondary text
  success: 'rgb(70,180,110)',
  error: 'rgb(255,105,125)', // pink-red, distinct from the accent red
  warning: 'rgb(225,175,70)',
  diffAdded: 'rgb(80,180,110)',
  diffRemoved: 'rgb(255,105,125)',
};

/** Light theme — deeper red/purple/blue for contrast on a light background. */
export const lightTheme: Theme = {
  accent: 'rgb(200,40,40)', // brand red
  accentDim: 'rgb(170,55,55)',
  selection: 'rgb(120,70,200)', // purple — selected row
  permission: 'rgb(40,90,210)', // blue — approvals, links, mode
  text: 'rgb(28,28,28)',
  subtle: 'rgb(95,105,120)',
  success: 'rgb(38,120,60)',
  error: 'rgb(190,40,70)',
  warning: 'rgb(150,110,20)',
  diffAdded: 'rgb(38,120,60)',
  diffRemoved: 'rgb(190,40,70)',
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
