/**
 * Structured JSON logging (pino) with a redaction allowlist. NODE-ONLY.
 * The same REDACT_PATHS set feeds the Sentry `beforeSend` scrubber.
 */
import pino, { type Logger as PinoLogger } from 'pino';
import { getRequestContext } from './context.js';

export {
  type RequestContext,
  runWithRequestContext,
  enterRequestContext,
  getRequestContext,
  patchRequestContext,
} from './context.js';

/** Fields that must never appear in logs in cleartext (SEC-3). */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'password',
  '*.password',
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.token',
  'client_secret',
  '*.client_secret',
  'secretAccessKey',
  '*.secretAccessKey',
  'connectionString',
  'databaseUrl',
  '*.connectionString',
  'presignedUrl',
  'signedUrl',
  '*.presignedUrl',
  '*.signedUrl',
  'req.body',
  'res.body',
  'body',
  '*.inn',
  '*.passport',
  '*.cardNumber',
  '*.phone',
  '*.email',
];

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
}

export function createLogger(name: string, opts: CreateLoggerOptions = {}): Logger {
  return pino({
    name,
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    // Auto-tag every log line emitted inside a request with its correlation ids.
    mixin() {
      const ctx = getRequestContext();
      if (!ctx) return {};
      return {
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        ...(ctx.sub ? { sub: ctx.sub } : {}),
        ...(ctx.sourcePortal ? { sourcePortal: ctx.sourcePortal } : {}),
      };
    },
    ...(opts.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}
