import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { buildApp } from '../app.js';
import type { AgentApiConfig } from '../config.js';
import { createStubTemporalPort } from '../temporal/stubTemporalPort.js';

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
      LOG_LEVEL: 'silent',
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

async function build() {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('tools-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  return buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry,
    toolTestBroker: new ToolBroker(sandboxRegistry),
  });
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, {
    sub,
    issuer: ISSUER,
    audience: 'account',
    azp: AUD,
    realmRoles: roles,
  })}`;
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('GET /tools', () => {
  it('401 без токена', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/tools' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('admin видит все базовые инструменты, метаданные без handler', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tools',
      headers: { authorization: await token('a', ['admin']) },
    });
    expect(res.statusCode).toBe(200);
    const { tools } = res.json();
    expect(tools.length).toBe(5);
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('notification.send');
    for (const t of tools) expect(t).not.toHaveProperty('handler');
    await app.close();
  });

  it('обычный пользователь (стаб can) не видит инструменты', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tools',
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toHaveLength(0);
    await app.close();
  });
});

describe('GET /tools/:name', () => {
  it('admin: 200 для известного; 404 для неизвестного', async () => {
    const app = await build();
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/tools/notification.send',
      headers: { authorization: await token('a', ['admin']) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe('notification.send');

    const nf = await app.inject({
      method: 'GET',
      url: '/api/v1/tools/does.not.exist',
      headers: { authorization: await token('a', ['admin']) },
    });
    expect(nf.statusCode).toBe(404);
    await app.close();
  });

  it('невидимый инструмент → 404 для обычного пользователя', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tools/notification.send',
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /tools/:name/test', () => {
  it('не-admin → 403', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/notification.send/test',
      headers: { authorization: await token('u-1') },
      payload: { input: { to: 'x', subject: 's', body: 'b' } },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admin dry-run: ok=true без реальных сайд-эффектов', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/notification.send/test',
      headers: { authorization: await token('a', ['admin']) },
      payload: { input: { to: 'x@y', subject: 's', body: 'b', dedupeKey: 'k1' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.output).toMatchObject({ enqueued: true });
    await app.close();
  });

  it('admin: невалидный вход → ok=false, error VALIDATION_FAILED', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/notification.send/test',
      headers: { authorization: await token('a', ['admin']) },
      payload: { input: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('admin: неизвестный инструмент → 404', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/nope/test',
      headers: { authorization: await token('a', ['admin']) },
      payload: { input: {} },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('admin: dryRun=false → 409 (live harness отключён)', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/notification.send/test',
      headers: { authorization: await token('a', ['admin']) },
      payload: { input: { to: 'x', subject: 's', body: 'b' }, dryRun: false },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
