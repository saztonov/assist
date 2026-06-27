import { describe, it, expect } from 'vitest';
import { makeIdempotencyKey, mailConnector } from './index.js';

describe('connectors', () => {
  it('builds a stable idempotency key', () => {
    expect(makeIdempotencyKey(['mail', 'u1', 'hash'])).toBe('mail:u1:hash');
  });

  it('exposes a named mail connector', () => {
    expect(mailConnector.name).toBe('mail');
  });
});
