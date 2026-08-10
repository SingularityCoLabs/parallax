/**
 * Redaction helpers (blueprint §27.2). We never want secrets in logs. This is a
 * best-effort scrub for structured log bindings and short strings; it is not a
 * substitute for not passing secrets in the first place.
 */

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|authorization|bearer)/i;

const REDACTED = '[redacted]';

export function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.length > 0) {
    return REDACTED;
  }
  return value;
}

/** Recursively redact obvious secret-bearing keys in a plain object. */
export function redactObject<T>(input: T, depth = 0): T {
  if (depth > 6 || input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactObject(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const redacted = redactValue(k, v);
    out[k] = redacted === v ? redactObject(v, depth + 1) : redacted;
  }
  return out as T;
}
