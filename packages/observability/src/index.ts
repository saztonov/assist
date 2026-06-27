/** Tracing/metrics helpers. NODE-ONLY. Scaffold uses a no-op span. */
import { createLogger, type Logger } from '@su10/logger';

export interface Span {
  end(): void;
}

export function initTelemetry(serviceName: string): Logger {
  return createLogger(`otel:${serviceName}`);
}

export async function withSpan<T>(_name: string, fn: () => Promise<T> | T): Promise<T> {
  // Real implementation wraps `fn` in an OpenTelemetry span.
  return await fn();
}
