import pino, { type Logger } from 'pino';

/**
 * Structured logger (blueprint §5.7, §27). Logs go to **stderr** so stdout stays
 * a clean protocol channel for future headless/JSON mode (§24). Level is taken
 * from PARALLAX_LOG_LEVEL (default: warn, so normal CLI use is quiet).
 *
 * pino's `redact` handles common secret-bearing paths defensively; tools/runtime
 * should still avoid logging secrets in the first place (§27.2).
 */
export type { Logger };

let root: Logger | undefined;

export function getLogger(): Logger {
  if (!root) {
    root = pino(
      {
        level: process.env.PARALLAX_LOG_LEVEL ?? 'warn',
        redact: {
          paths: [
            'apiKey',
            'token',
            'secret',
            'password',
            'authorization',
            '*.apiKey',
            '*.token',
            '*.secret',
            '*.password',
            'env.*',
          ],
          censor: '[redacted]',
        },
      },
      pino.destination(2),
    );
  }
  return root;
}

/** Child logger with fixed bindings (e.g. sessionId/turnId). */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}
