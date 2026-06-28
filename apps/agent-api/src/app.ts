/**
 * Fastify app factory — the only public HTTP surface. Construction performs NO
 * network I/O (no DB/LLM/Temporal/Keycloak connection), so it runs under
 * `app.inject()` in tests and boots locally without external services.
 *
 * Layering:
 *  - securityPlugin (global): helmet, CORS, rate-limit, request-context, errors
 *  - openapi (optional) + health + /system/info  → PUBLIC (no auth)
 *  - authenticated scope (authPlugin + 10 route groups) under API_PREFIX
 */
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { securityPlugin, authPlugin } from '@su10/fastify-security';
import type { Logger } from '@su10/logger';
import type { OidcVerifier } from '@su10/oidc';
import type { AuditSink } from '@su10/audit';
import type { AgentTaskRepo } from '@su10/db';
import type { ToolBroker, ToolRegistry } from '@su10/tools';
import type { TemporalPort } from '@su10/workflow-engine';
import type { AgentApiConfig } from './config.js';
import { healthPlugin, type HealthCheck } from './plugins/health.js';
import { openapiPlugin } from './plugins/openapi.js';
import { routes } from './routes/index.js';

export interface BuildAppDeps {
  config: AgentApiConfig;
  logger: Logger;
  /** Token verifier — injected so tests/local use a local JWKS (no Keycloak). */
  oidc: OidcVerifier;
  /** Readiness checks (empty by default → local-first, no egress). */
  healthChecks?: HealthCheck[];
  /** AgentTask lifecycle repository (injected; tests pass an in-memory fake). */
  taskRepo: AgentTaskRepo;
  /** Temporal orchestration port (stub locally; real client added in step 6). */
  temporal: TemporalPort;
  /** Audit sink (DB-backed in server.ts; in-memory in tests). */
  auditSink: AuditSink;
  /** Реестр инструментов (метаданные для Tool Registry API). */
  toolRegistry: ToolRegistry;
  /** Sandbox-брокер для admin test harness (без реальных сайд-эффектов). */
  toolTestBroker: ToolBroker;
}

export async function buildApp(deps: BuildAppDeps) {
  const { config, logger, oidc } = deps;

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Global cross-cutting security (applies to every route, incl. health).
  await app.register(securityPlugin, {
    corsOrigins: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    rateLimit: { max: config.rateLimit.max, timeWindow: config.rateLimit.timeWindow },
    allowedSourcePortals: config.allowedSourcePortals,
  });

  // --- PUBLIC surface (no auth) ---
  if (config.openapi.enabled) {
    await app.register(openapiPlugin, { uiEnabled: config.openapi.uiEnabled });
  }
  await app.register(healthPlugin, { checks: deps.healthChecks ?? [] });
  app.get(`${config.apiPrefix}/system/info`, { schema: { hide: true } }, async () => ({
    name: 'agent-api',
    version: '0.0.0',
    apiPrefix: config.apiPrefix,
  }));

  // --- AUTHENTICATED surface (Bearer JWT required, by encapsulation) ---
  await app.register(
    async (api) => {
      await api.register(authPlugin, {
        oidc,
        allowedSourcePortals: config.allowedSourcePortals,
      });
      await api.register(routes, {
        taskRepo: deps.taskRepo,
        temporal: deps.temporal,
        auditSink: deps.auditSink,
        taskQueue: config.server.TEMPORAL_TASK_QUEUE,
        toolRegistry: deps.toolRegistry,
        toolTestBroker: deps.toolTestBroker,
      });
    },
    { prefix: config.apiPrefix },
  );

  return app;
}
