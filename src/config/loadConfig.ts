import { configSchema, defaultConfig, type Config } from './schema.ts';

/**
 * Load configuration. v0.1 uses defaults plus a small set of env overrides
 * (blueprint §28.3 precedence: defaults < env). File-based user/project config
 * is a documented extension point.
 */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env: Partial<Config> = {};
  if (process.env.PARALLAX_MODEL) env.defaultModel = process.env.PARALLAX_MODEL;
  if (process.env.PARALLAX_MAX_STEPS) {
    const n = Number(process.env.PARALLAX_MAX_STEPS);
    if (Number.isFinite(n)) env.maxSteps = n;
  }
  return configSchema.parse({ ...defaultConfig(), ...env, ...overrides });
}
