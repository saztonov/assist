import { describe, it, expect } from 'vitest';
import { createMailRateLimiter } from './rateLimit.js';

describe('createMailRateLimiter', () => {
  it('allows up to capacity then throws until refilled', () => {
    let nowMs = 1_000_000;
    const limiter = createMailRateLimiter({ capacity: 2, refillPerSec: 1 }, () => nowMs);
    expect(() => limiter.acquire('k')).not.toThrow();
    expect(() => limiter.acquire('k')).not.toThrow();
    expect(() => limiter.acquire('k')).toThrow(/rate limit/i);

    // After 1s, one token refills.
    nowMs += 1000;
    expect(() => limiter.acquire('k')).not.toThrow();
    expect(() => limiter.acquire('k')).toThrow(/rate limit/i);
  });

  it('tracks buckets independently per key', () => {
    const nowMs = 0;
    const limiter = createMailRateLimiter({ capacity: 1, refillPerSec: 1 }, () => nowMs);
    expect(() => limiter.acquire('a')).not.toThrow();
    expect(() => limiter.acquire('b')).not.toThrow();
    expect(() => limiter.acquire('a')).toThrow();
    expect(() => limiter.acquire('b')).toThrow();
  });
});
