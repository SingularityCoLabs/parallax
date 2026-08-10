import type { EnvironmentPolicy } from './Executor.ts';

/**
 * v0.1 environment policy (blueprint §15.3). Inherits a mostly-normal parent
 * environment for usability, but is an explicit seam so secrets can be
 * restricted later (safe baseline + explicit PATH + injected per-tool creds).
 * It already strips a few obvious agent-provider secrets so a spawned command
 * cannot trivially read them from `process.env`.
 */
const STRIPPED = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PARALLAX_DB',
];

export class InheritedEnvironmentPolicy implements EnvironmentPolicy {
  buildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base };
    for (const key of STRIPPED) delete env[key];
    return env;
  }
}
