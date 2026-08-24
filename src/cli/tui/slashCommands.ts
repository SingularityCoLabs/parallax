/**
 * Slash-command catalog for the TUI. The plain REPL parses a small set in
 * `replCommands.ts`; the TUI adds a few more (clear, sessions, resume, init,
 * mode) and drives an autocomplete menu from this list. Parsing stays a pure
 * function so it's testable and the prompt component stays a thin view.
 */

export interface SlashCommand {
  name: string;
  /** One-line help shown in the autocomplete menu. */
  summary: string;
  /** Whether it takes an argument (shown as a hint). */
  arg?: string;
}

/** The commands the TUI offers, in menu order. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', summary: 'Show commands and shortcuts' },
  { name: 'model', summary: 'Switch model (or provider/model)', arg: '[prov/]id' },
  { name: 'models', summary: 'List models for a provider', arg: '[provider]' },
  { name: 'provider', summary: 'Switch provider (uses its default model)', arg: 'id' },
  { name: 'providers', summary: 'List providers and key status' },
  { name: 'tools', summary: 'List the available agent tools' },
  { name: 'theme', summary: 'Switch color theme', arg: '[dark|light]' },
  { name: 'mode', summary: 'Set permission mode', arg: 'workspace|plan|read-only|bypass' },
  { name: 'workspace', summary: 'Permission mode: ask before side effects' },
  { name: 'plan', summary: 'Permission mode: research & propose (read-only)' },
  { name: 'read-only', summary: 'Permission mode: reads only, block side effects' },
  { name: 'bypass', summary: 'Permission mode: auto-approve everything (careful)' },
  { name: 'sessions', summary: 'List persisted sessions' },
  { name: 'resume', summary: 'Resume a session', arg: '[id]' },
  { name: 'clear', summary: 'Clear the on-screen transcript' },
  { name: 'init', summary: 'Summarize the project into a note' },
  { name: 'exit', summary: 'Quit Parallax' },
  { name: 'quit', summary: 'Quit Parallax' },
];

/** De-duplicated command list (the array above is authored for menu ordering). */
export function slashCommands(): SlashCommand[] {
  const seen = new Set<string>();
  return SLASH_COMMANDS.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

/**
 * Given the current input, return the slash-command completions to show.
 * Only fires when the line starts with `/` and has no space yet (i.e. the user
 * is still typing the command name). Empty when not applicable.
 */
export function completionsFor(input: string): SlashCommand[] {
  if (!input.startsWith('/') || input.includes(' ')) return [];
  const prefix = input.slice(1).toLowerCase();
  return slashCommands().filter((c) => c.name.startsWith(prefix));
}
