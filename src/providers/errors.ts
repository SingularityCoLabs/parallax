/**
 * Shared provider error + HTTP helpers (blueprint §11, §25). Both the
 * OpenAI-compatible and Anthropic adapters surface non-2xx responses the same
 * way, so the error type lives here rather than inside one adapter.
 */

export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

/** Read up to 500 chars of an error body without throwing. */
export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

/**
 * Strip secrets from an error message before it is surfaced (to logs, the
 * `turn.failed` event, or the UI). undici's "invalid header value" TypeError
 * echoes the offending header value verbatim — which for us is `Bearer <key>` /
 * the `x-api-key` — so a raw provider error can leak the API key. This removes
 * the exact key and any `Bearer <token>` sequence. Keys are sanitized upstream
 * so this error should not normally fire, but it is the safety net that
 * guarantees a key never reaches a log line.
 */
export function redactSecrets(message: string, secret?: string): string {
  let out = message;
  if (secret && secret.length >= 4) out = out.split(secret).join('<redacted>');
  return out.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>');
}
