import { describe, it, expect } from 'vitest';
import { BRAND_PRIMARY, darkTheme, lightTheme, getTheme, glyphs } from '../src/cli/tui/theme.ts';

describe('theme', () => {
  it('uses the exact #0066FF primary with blue interaction and orange warning roles', () => {
    expect(BRAND_PRIMARY).toBe('rgb(0,102,255)');
    expect(darkTheme).toMatchObject({
      accent: BRAND_PRIMARY,
      selection: 'rgb(78,161,255)',
      permission: 'rgb(56,189,248)',
      warning: 'rgb(255,159,28)',
    });
    expect(lightTheme).toMatchObject({
      accent: BRAND_PRIMARY,
      selection: 'rgb(0,95,204)',
      permission: 'rgb(0,122,159)',
      warning: 'rgb(180,83,9)',
    });
  });

  it('exposes every semantic color role on both themes', () => {
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
        'diffAdded',
        'diffRemoved',
      ] as const) {
        expect(theme[key]).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      }
      // Interaction and attention colors stay distinct from the brand primary.
      expect(theme.selection).not.toBe(theme.accent);
      expect(theme.accent).not.toBe(theme.permission);
      expect(theme.warning).not.toBe(theme.accent);
      expect(theme.warning).not.toBe(theme.selection);
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
