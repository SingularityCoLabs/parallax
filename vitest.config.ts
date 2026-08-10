import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    env: {
      // Keep expected error logs out of test output; tests assert on events,
      // not logs. Override with PARALLAX_LOG_LEVEL when debugging.
      PARALLAX_LOG_LEVEL: process.env.PARALLAX_LOG_LEVEL ?? 'silent',
    },
  },
});
