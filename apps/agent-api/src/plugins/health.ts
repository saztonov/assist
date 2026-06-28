/**
 * Liveness + readiness. `/health/live` is dependency-free (process up).
 * `/health/ready` aggregates an INJECTED registry of named checks — at the
 * foundation stage the registry is empty by default (local-first, no egress);
 * later stages register DB / JWKS / LM Studio checks. Details never leak.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheckResult {
  status: HealthStatus;
  detail?: string;
}

export interface HealthCheck {
  name: string;
  check(): Promise<HealthCheckResult>;
}

export interface HealthOptions {
  checks?: HealthCheck[];
  /** Keep the deprecated `/health` alias from the scaffold (default true). */
  legacyAlias?: boolean;
}

const HIDDEN = { schema: { hide: true } } as const;

const plugin: FastifyPluginAsync<HealthOptions> = async (app, opts) => {
  const checks = opts.checks ?? [];

  app.get('/health/live', HIDDEN, async () => ({ status: 'ok' }));

  app.get('/health/ready', HIDDEN, async (_req, reply) => {
    const results = await Promise.all(
      checks.map(async (c) => {
        try {
          const r = await c.check();
          return { name: c.name, status: r.status, ...(r.detail ? { detail: r.detail } : {}) };
        } catch {
          return { name: c.name, status: 'down' as const, detail: 'check failed' };
        }
      }),
    );
    const healthy = results.every((r) => r.status === 'ok');
    return reply
      .status(healthy ? 200 : 503)
      .send({ status: healthy ? 'ok' : 'unavailable', checks: results });
  });

  if (opts.legacyAlias !== false) {
    app.get('/health', HIDDEN, async () => ({ status: 'ok' }));
  }
};

export const healthPlugin = fp(plugin, { name: 'agent-api-health', fastify: '5.x' });

/**
 * Readiness check: база данных отвечает (`SELECT 1`). Проба инжектируется
 * (создаётся в server.ts из @su10/db), чтобы `buildApp` не выполнял I/O.
 * Выключена по умолчанию (DB_READYCHECK_ENABLED). Строка подключения не логируется.
 */
export function dbHealthCheck(probe: () => Promise<void>, timeoutMs = 2000): HealthCheck {
  return {
    name: 'db',
    async check() {
      try {
        await Promise.race([
          probe(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs),
          ),
        ]);
        return { status: 'ok' };
      } catch {
        return { status: 'down', detail: 'unreachable' };
      }
    },
  };
}

/** Readiness check: remote JWKS endpoint reachable (only meaningful in prod). */
export function jwksHealthCheck(jwksUri: string, timeoutMs = 2000): HealthCheck {
  return {
    name: 'jwks',
    async check() {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(jwksUri, { signal: ctrl.signal });
        return res.ok ? { status: 'ok' } : { status: 'down', detail: `http ${res.status}` };
      } catch {
        return { status: 'down', detail: 'unreachable' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Readiness check: LM Studio `/models` reachable. The token is sent only in the
 * Authorization header and never logged. Stage 10 moves this into
 * `@su10/llm.healthCheck()`; here it is inline + disabled by default.
 */
export function lmStudioHealthCheck(baseUrl: string, token: string, timeoutMs = 2000): HealthCheck {
  return {
    name: 'lmstudio',
    async check() {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
          headers: { authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        return res.ok ? { status: 'ok' } : { status: 'down', detail: `http ${res.status}` };
      } catch {
        return { status: 'down', detail: 'unreachable' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
