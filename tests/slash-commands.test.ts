import { describe, it, expect } from 'vitest';
import { SLASH_COMMANDS, slashCommands, completionsFor } from '../src/cli/tui/slashCommands.ts';

describe('slash-command catalog', () => {
  it('has no duplicate command names', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes the new commands (modes, theme, tools, exit/quit)', () => {
    const names = new Set(slashCommands().map((c) => c.name));
    for (const n of [
      'plan',
      'workspace',
      'read-only',
      'bypass',
      'theme',
      'tools',
      'exit',
      'quit',
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it('completes by prefix while typing a command name', () => {
    const forWork = completionsFor('/wo').map((c) => c.name);
    expect(forWork).toContain('workspace');
    const forB = completionsFor('/b').map((c) => c.name);
    expect(forB).toContain('bypass');
  });

  it('offers all commands for a bare slash, and none once a space is typed', () => {
    expect(completionsFor('/').length).toBe(slashCommands().length);
    expect(completionsFor('/model ')).toEqual([]); // typing an argument, not a name
    expect(completionsFor('hello')).toEqual([]); // not a command
  });
});
