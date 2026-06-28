/**
 * Runtime entrypoint. Loads config, builds the app, listens, and shuts down
 * gracefully on SIGTERM/SIGINT. Local-first: OIDC uses an injected dev JWKS when
 * OIDC_DEV_JWKS is set, so protected routes work without a live Keycloak.
 */
import { createLogger, type Logger } from '@su10/logger';
import { createOidc, type OidcConfig, type OidcVerifier } from '@su10/oidc';
import { buildApp } from './app.js';
import { loadAgentApiConfig, type AgentApiConfig } from './config.js';
import {
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

function buildHealthChecks(config: AgentApiConfig): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (config.oidc.jwksUri) checks.push(jwksHealthCheck(config.oidc.jwksUri));
  if (config.readiness.llmEnabled) {
    checks.push(
      lmStudioHealthCheck(config.server.LLM_STUDIO_BASE_URL, config.server.LLM_STUDIO_API_TOKEN),
    );
  }
  return checks;
}

async function main(): Promise<void> {
  const config = loadAgentApiConfig();
  const logger: Logger = createLogger('agent-api', { level: config.server.LOG_LEVEL });
  const app = await buildApp({
    config,
    logger,
    oidc: buildOidcVerifier(config),
    healthChecks: buildHealthChecks(config),
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
