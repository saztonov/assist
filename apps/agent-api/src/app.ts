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
import type { AgentTaskRepo, WorkflowTemplateRepo } from '@su10/db';
import type { ToolBroker, ToolRegistry } from '@su10/tools';
import type { TemporalPort } from '@su10/workflow-engine';
import type { AgentApiConfig } from './config.js';
import { healthPlugin, type HealthCheck } from './plugins/health.js';
import { openapiPlugin } from './plugins/openapi.js';
import { routes } from './routes/index.js';
import type { DocumentsDeps } from './documents/routes.js';
import type { RagDeps } from './rag/routes.js';
import type { LlmAdminDeps } from './llm/routes.js';
import type { ConnectorsDeps } from './connectors/routes.js';
import type { AgentChatDeps } from './agent-chat/routes.js';
import type { ApprovalsDeps } from './approvals/routes.js';

export interface BuildAppDeps {
  config: AgentApiConfig;
  logger: Logger;
  /** Token verifier — injected so tests/local use a local JWKS (no Keycloak). */
  oidc: OidcVerifier;
  /** Readiness checks (empty by default → local-first, no egress). */
  healthChecks?: HealthCheck[];
  /** AgentTask lifecycle repository (injected; tests pass an in-memory fake). */
  taskRepo: AgentTaskRepo;
  /** Workflow Templates repository (этап 11). Registered only when present. */
  templateRepo?: WorkflowTemplateRepo;
  /** Temporal orchestration port (stub locally; real client added in step 6). */
  temporal: TemporalPort;
  /** Audit sink (DB-backed in server.ts; in-memory in tests). */
  auditSink: AuditSink;
  /** Реестр инструментов (метаданные для Tool Registry API). */
  toolRegistry: ToolRegistry;
  /** Sandbox-брокер для admin test harness (без реальных сайд-эффектов). */
  toolTestBroker: ToolBroker;
  /** Documents API deps (repo + S3 storage port). Registered only when present. */
  documents?: DocumentsDeps;
  /** RAG API deps (ragService + llm gateway). Registered only when present. */
  rag?: RagDeps;
  /** LLM admin API deps (provider registry + gateway). Registered only when present. */
  llmAdmin?: LlmAdminDeps;
  /** Connectors API deps (mail connector). Registered only when present. */
  connectors?: ConnectorsDeps;
  /** Chat API deps (этап 12) — mock-агент поверх chatRepo. */
  chat?: AgentChatDeps;
  /** Approvals API deps (этап 12) — поверх approvalRepo. */
  approvals?: ApprovalsDeps;
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
        ...(deps.documents ? { documents: deps.documents } : {}),
        ...(deps.rag ? { rag: deps.rag } : {}),
        ...(deps.llmAdmin ? { llmAdmin: deps.llmAdmin } : {}),
        ...(deps.connectors ? { connectors: deps.connectors } : {}),
        ...(deps.chat ? { chat: deps.chat } : {}),
        ...(deps.approvals ? { approvals: deps.approvals } : {}),
        ...(deps.templateRepo
          ? {
              workflowTemplates: {
                templateRepo: deps.templateRepo,
                taskRepo: deps.taskRepo,
                temporal: deps.temporal,
                auditSink: deps.auditSink,
                toolRegistry: deps.toolRegistry,
                taskQueue: config.server.TEMPORAL_TASK_QUEUE,
              },
            }
          : {}),
      });
    },
    { prefix: config.apiPrefix },
  );

  return app;
}
