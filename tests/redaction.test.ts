import { describe, it, expect } from 'vitest';
import { redactObject, redactValue } from '../src/observability/redaction.ts';

describe('redaction', () => {
  it('redacts obvious secret keys', () => {
    expect(redactValue('apiKey', 'sk-123')).toBe('[redacted]');
    expect(redactValue('AUTHORIZATION', 'Bearer x')).toBe('[redacted]');
    expect(redactValue('path', '/etc/hosts')).toBe('/etc/hosts');
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactObject({
      path: 'a',
      creds: { token: 'abc', nested: [{ password: 'p' }] },
    });
    expect(out).toEqual({
      path: 'a',
      creds: { token: '[redacted]', nested: [{ password: '[redacted]' }] },
    });
  });
});
