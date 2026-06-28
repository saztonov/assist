import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { buildApp } from './app.js';
import type { AgentApiConfig } from './config.js';
import { ROUTE_GROUPS } from './routes/index.js';
import { createStubTemporalPort } from './temporal/stubTemporalPort.js';
import type { HealthCheck } from './plugins/health.js';

function makeToolDeps() {
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  return { toolRegistry, toolTestBroker: new ToolBroker(sandboxRegistry) };
}

const ISSUER = 'https://auth.su10.ru/realms/portal';
const AUD = 'agent-api';

function makeConfig(devJwks: string): AgentApiConfig {
  return {
    server: {
      NODE_ENV: 'test',
      HTTP_HOST: '0.0.0.0',
      HTTP_PORT: 8080,
      DATABASE_URL: 'postgres://placeholder/db',
      DATABASE_POOL_MAX: 10,
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'ai-portal',
      LLM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
      LLM_STUDIO_API_TOKEN: 'placeholder',
      RAG_ACL_ENFORCE: true,
      LOG_LEVEL: 'info',
    },
    apiPrefix: '/api/v1',
    trustProxy: false,
    bodyLimit: 1_048_576,
    corsOrigins: [],
    rateLimit: { max: 1000, timeWindow: '1 minute' },
    allowedSourcePortals: [],
    openapi: { enabled: true, uiEnabled: false },
    oidc: {
      issuer: ISSUER,
      audience: AUD,
      clientId: AUD,
      resourceClient: AUD,
      devJwks,
      clockToleranceSec: 5,
    },
    readiness: { llmEnabled: false, dbEnabled: false },
    temporal: { enabled: false },
  };
}

let kp: DevKeypair;
async function makeApp(healthChecks?: HealthCheck[]) {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('agent-api-test', { level: 'silent' });
  return buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    ...makeToolDeps(),
    ...(healthChecks ? { healthChecks } : {}),
  });
}

const bearer = async () => ({
  authorization: `Bearer ${await signDevToken(kp, {
    sub: 'u-1',
    issuer: ISSUER,
    audience: 'account',
    azp: AUD,
  })}`,
});

describe('agent-api foundation', () => {
  beforeAll(async () => {
    kp = await generateDevKeypair();
  });

  it('GET /health/live returns ok without auth', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('GET /health/ready is green with no checks (local-first)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: [] });
    await app.close();
  });

  it('GET /health/ready returns 503 when an injected check is down', async () => {
    const app = await makeApp([
      { name: 'dep', check: async () => ({ status: 'down', detail: 'x' }) },
    ]);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'unavailable' });
    await app.close();
  });

  it('keeps the deprecated /health alias', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('GET /api/v1/system/info is public', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'agent-api' });
    await app.close();
  });

  it('protected group returns 401 without a token', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/tasks' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'AUTHN_REQUIRED' } });
    await app.close();
  });

  it('not-yet-implemented route groups return 501 with a valid token', async () => {
    const app = await makeApp();
    const headers = await bearer();
    const implemented = new Set(['/agent/tasks', '/tools']);
    for (const group of ROUTE_GROUPS) {
      if (implemented.has(group.prefix)) continue; // реализованы в этапах 4–5
      const res = await app.inject({ method: 'GET', url: `/api/v1${group.prefix}`, headers });
      expect(res.statusCode, group.prefix).toBe(501);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_IMPLEMENTED' } });
    }
    await app.close();
  });

  it('GET /api/v1/agent/tasks is implemented (200 list) with a valid token', async () => {
    const app = await makeApp();
    const headers = await bearer();
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/tasks', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [] });
    await app.close();
  });

  it('GET /api/v1/tools is implemented (200 list) with a valid token', async () => {
    const app = await makeApp();
    const headers = await bearer();
    const res = await app.inject({ method: 'GET', url: '/api/v1/tools', headers });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().tools)).toBe(true);
    await app.close();
  });

  it('serves an OpenAPI spec with bearerAuth and the route groups tagged', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(spec.paths['/api/v1/agent/tasks']).toBeDefined();
    await app.close();
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });
});
