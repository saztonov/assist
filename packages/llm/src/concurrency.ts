/**
 * In-process per-model concurrency limiter. NODE-ONLY.
 *
 * Enforces the LM Studio parallelism limits (chandra=4, lift=4, qwen=1). This is
 * a single-process limiter (single-VPS baseline); cross-process rate-limiting is
 * out of scope.
 */
import type { LlmGatewayConfig } from './types.js';
import type { ModelBucket } from './modelRouter.js';

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore max must be >= 1');
  }

  /** Current number of in-flight permits (for assertions/metrics). */
  get inFlight(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export type Limiters = Record<ModelBucket, Semaphore>;

export function createLimiters(caps: LlmGatewayConfig['concurrency']): Limiters {
  return {
    chandra: new Semaphore(caps.chandra),
    lift: new Semaphore(caps.lift),
    qwen: new Semaphore(caps.qwen),
  };
}
