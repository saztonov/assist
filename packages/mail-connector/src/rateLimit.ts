/**
 * Process-local token-bucket rate limiter, keyed per connection. Bounds IMAP call
 * volume to one external mailbox. Single-instance only (not shared across
 * processes) — acceptable for v1; a distributed limiter is a future step.
 */
import { UpstreamError } from '@su10/errors';

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export interface MailRateLimiter {
  /** Consumes one token for `key`, or throws `UpstreamError` when exhausted. */
  acquire(key: string): void;
}

interface BucketState {
  tokens: number;
  lastMs: number;
}

/** `now` is injectable for deterministic tests. */
export function createMailRateLimiter(
  config: RateLimitConfig,
  now: () => number = () => Date.now(),
): MailRateLimiter {
  const buckets = new Map<string, BucketState>();
  return {
    acquire(key: string): void {
      const t = now();
      const state = buckets.get(key) ?? { tokens: config.capacity, lastMs: t };
      const elapsedSec = Math.max(0, (t - state.lastMs) / 1000);
      const refilled = Math.min(config.capacity, state.tokens + elapsedSec * config.refillPerSec);
      if (refilled < 1) {
        // Persist the refill progress so repeated calls don't reset the clock.
        buckets.set(key, { tokens: refilled, lastMs: t });
        throw new UpstreamError('mail rate limit exceeded', { key });
      }
      buckets.set(key, { tokens: refilled - 1, lastMs: t });
    },
  };
}
