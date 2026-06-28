/**
 * Runtime entrypoint. Loads config, builds the app, listens, and shuts down
 * gracefully on SIGTERM/SIGINT. Local-first: OIDC uses an injected dev JWKS when
 * OIDC_DEV_JWKS is set, so protected routes work without a live Keycloak.
 */
import {
  createAgentTaskRepo,
  createDb,
  createDbAuditSink,
  closeDb,
  pingDatabase,
  type Database,
} from '@su10/db';
import { createLogger, type Logger } from '@su10/logger';
import { createOidc, type OidcConfig, type OidcVerifier } from '@su10/oidc';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import {
  createDbBaseToolDeps,
  createInMemoryBaseToolDeps,
  registerBaseTools,
} from '@su10/tool-base';
import type { TemporalPort } from '@su10/workflow-engine';
import { buildApp } from './app.js';
import { loadAgentApiConfig, type AgentApiConfig } from './config.js';
import { createStubTemporalPort } from './temporal/stubTemporalPort.js';
import { createTemporalClientPort } from './temporal/temporalClientPort.js';
import {
  dbHealthCheck,
  jwksHealthCheck,
  lmStudioHealthCheck,
  type HealthCheck,
} from './plugins/health.js';

function buildOidcVerifier(config: AgentApiConfig): OidcVerifier {
  const base: OidcConfig = {
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    clientId: config.oidc.clientId,
    resourceClient: config.oidc.resourceClient,
    clockToleranceSec: config.oidc.clockToleranceSec,
  };
  if (config.oidc.devJwks) {
    return createOidc({ ...base, jwks: JSON.parse(config.oidc.devJwks) as OidcConfig['jwks'] });
  }
  return createOidc({ ...base, jwksUri: config.oidc.jwksUri });
}

function buildHealthChecks(config: AgentApiConfig, db: Database): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (config.oidc.jwksUri) checks.push(jwksHealthCheck(config.oidc.jwksUri));
  if (config.readiness.llmEnabled) {
    checks.push(
      lmStudioHealthCheck(config.server.LLM_STUDIO_BASE_URL, config.server.LLM_STUDIO_API_TOKEN),
    );
  }
  if (config.readiness.dbEnabled) {
    checks.push(dbHealthCheck(() => pingDatabase(db)));
  }
  return checks;
}

/**
 * Temporal-порт: при `TEMPORAL_ENABLED=true` — реальный `@temporalio/client`
 * (I/O вне `buildApp`); иначе local-first stub. Реальный порт умеет `close()`.
 */
async function buildTemporalPort(
  config: AgentApiConfig,
): Promise<TemporalPort & { close?(): Promise<void> }> {
  if (config.temporal.enabled) {
    return createTemporalClientPort({
      address: config.server.TEMPORAL_ADDRESS,
      namespace: config.server.TEMPORAL_NAMESPACE,
    });
  }
  return createStubTemporalPort();
}

async function main(): Promise<void> {
  const config = loadAgentApiConfig();
  const logger: Logger = createLogger('agent-api', { level: config.server.LOG_LEVEL });

  // Единый пул соединений (I/O-точка — не в buildApp). Используется readiness,
  // репозиторием задач и audit-sink; закрывается при graceful shutdown.
  const db = createDb(config.server.DATABASE_URL);

  // Реестр инструментов (метаданные/реальные handler'ы) + sandbox-брокер для
  // admin test harness (in-memory deps, без реальных сайд-эффектов).
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createDbBaseToolDeps(db));
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  const toolTestBroker = new ToolBroker(sandboxRegistry);

  const temporal = await buildTemporalPort(config);

  const app = await buildApp({
    config,
    logger,
    oidc: buildOidcVerifier(config),
    healthChecks: buildHealthChecks(config, db),
    taskRepo: createAgentTaskRepo(db),
    temporal,
    auditSink: createDbAuditSink(db),
    toolRegistry,
    toolTestBroker,
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    app
      .close()
      .then(() => temporal.close?.())
      .then(() => closeDb(db))
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.server.HTTP_HOST, port: config.server.HTTP_PORT });
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('server.js') || entry.endsWith('server.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
