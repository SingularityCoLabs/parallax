import { z } from 'zod';
import { permissionModeSchema } from '../protocol/index.ts';

/**
 * Runtime configuration (blueprint §28). v0.1 exposes the knobs the runtime and
 * tools actually read; layered user/project config files are an extension point.
 * Defaults are conservative (workspace mode, bounded output).
 */
export const configSchema = z.object({
  defaultModel: z.string().default('fake-1'),
  permissionMode: permissionModeSchema.default('workspace'),
  maxSteps: z.number().int().positive().default(24),
  systemPrompt: z
    .string()
    .default(
      'You are Parallax, a careful general-purpose agent. Use the provided tools to inspect and act on the workspace. Prefer native file tools over shell for reading and editing. Explain what you did concisely.',
    ),
  maxToolResultChars: z.number().int().positive().default(16_000),
  maxMessages: z.number().int().nonnegative().default(0),
  // Tool limits (blueprint §13, §14, §15).
  maxFileReadBytes: z.number().int().positive().default(1_000_000),
  maxDirEntries: z.number().int().positive().default(1_000),
  maxSearchResults: z.number().int().positive().default(200),
  shellTimeoutMs: z.number().int().positive().default(120_000),
  shellMaxOutputBytes: z.number().int().positive().default(1_000_000),
});

export type Config = z.infer<typeof configSchema>;

export function defaultConfig(): Config {
  return configSchema.parse({});
}
