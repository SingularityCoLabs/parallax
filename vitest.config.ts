import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    env: {
      // Keep expected error logs out of test output; tests assert on events,
      // not logs. Override with PARALLAX_LOG_LEVEL when debugging.
      PARALLAX_LOG_LEVEL: process.env.PARALLAX_LOG_LEVEL ?? 'silent',
      // Tests must never hit the network for the models.dev catalog — the
      // bundled snapshot is deterministic. models-dev.test.ts opts back in
      // per-case by stubbing global fetch.
      PARALLAX_DISABLE_MODELS_FETCH: '1',
    },
  },
});
