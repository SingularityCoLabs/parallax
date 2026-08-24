import { describe, it, expect } from 'vitest';
import { darkTheme, lightTheme, getTheme, glyphs } from '../src/cli/tui/theme.ts';

describe('theme', () => {
  it('exposes the red/blue/purple identity roles on both themes', () => {
    for (const theme of [darkTheme, lightTheme]) {
      // Every semantic role the components reference must be a defined color.
      for (const key of [
        'accent',
        'accentDim',
        'selection',
        'permission',
        'text',
        'subtle',
        'success',
        'error',
        'warning',
      ] as const) {
        expect(theme[key]).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      }
      // selection (purple) is distinct from accent (red) and permission (blue).
      expect(theme.selection).not.toBe(theme.accent);
      expect(theme.selection).not.toBe(theme.permission);
      expect(theme.accent).not.toBe(theme.permission);
    }
  });

  it('getTheme defaults to dark and resolves light by name', () => {
    expect(getTheme()).toBe(darkTheme);
    expect(getTheme('dark')).toBe(darkTheme);
    expect(getTheme('light')).toBe(lightTheme);
  });

  it('keeps the glyph set the components rely on', () => {
    expect(glyphs.star).toBeTruthy();
    expect(glyphs.bullet).toBeTruthy();
    expect(glyphs.caret).toBeTruthy();
  });
});
