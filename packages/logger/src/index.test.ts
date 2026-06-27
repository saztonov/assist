import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { REDACT_PATHS } from './index.js';

describe('logger redaction', () => {
  it('covers auth, token, password and presigned-url fields', () => {
    for (const needle of ['authorization', 'password', 'token', 'presignedUrl']) {
      expect(REDACT_PATHS.some((p) => p.includes(needle))).toBe(true);
    }
  });

  it('censors sensitive values in the actual output', () => {
    const chunks: string[] = [];
    const sink = { write: (s: string) => void chunks.push(s) };
    const logger = pino(
      { redact: { paths: REDACT_PATHS, censor: '[Redacted]' } },
      sink as unknown as NodeJS.WritableStream,
    );

    logger.info(
      { authorization: 'Bearer super-secret', password: 'hunter2', nested: { token: 'abc123' } },
      'request',
    );

    const out = chunks.join('');
    expect(out).toContain('[Redacted]');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('super-secret');
    expect(out).not.toContain('abc123');
  });
});
