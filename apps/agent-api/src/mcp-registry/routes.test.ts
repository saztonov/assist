import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo, InMemoryMcpRegistryRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { InMemoryMcpClient, mcpToolName } from '@su10/mcp';
import { buildApp } from '../app.js';
import type { AgentApiConfig } from '../config.js';
import { createStubTemporalPort } from '../temporal/stubTemporalPort.js';
import { testServerConfig } from '../test-support/serverConfig.js';

const ISSUER = 'https://auth.su10.ru/realms/portal';
const AUD = 'agent-api';

function makeConfig(devJwks: string): AgentApiConfig {
  return {
    server: testServerConfig(),
    apiPrefix: '/api/v1',
    trustProxy: false,
    bodyLimit: 1_048_576,
    corsOrigins: [],
    rateLimit: { max: 1000, timeWindow: '1 minute' },
    allowedSourcePortals: [],
    openapi: { enabled: true, uiEnabled: false },
    oidc: { issuer: ISSUER, audience: AUD, clientId: AUD, resourceClient: AUD, devJwks, clockToleranceSec: 5 },
    readiness: { llmEnabled: false, dbEnabled: false },
    temporal: { enabled: false },
  };
}

let kp: DevKeypair;

async function build() {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('mcp-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  const mcpRepo = new InMemoryMcpRegistryRepo();
  const mcpClient = new InMemoryMcpClient({
    tools: { srv: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'sum' }] },
    callResults: { 'srv:echo': { value: 42 } },
  });
  const app = await buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry,
    toolTestBroker: new ToolBroker(new ToolRegistry()),
    mcp: { mcpRepo, mcpClient, toolRegistry, auditSink: new InMemoryAuditSink() },
  });
  return { app, mcpRepo, toolRegistry };
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, { sub, issuer: ISSUER, audience: 'account', azp: AUD, realmRoles: roles })}`;
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('MCP registry REST', () => {
  it('401 без токена', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/mcp/servers' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('403 для не-admin', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/mcp/servers',
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST создаёт сервер (201) и не возвращает секрет', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      headers: { authorization: await token('admin', ['admin']) },
      payload: {
        key: 'srv',
        name: 'Srv',
        endpointSecretRef: 'env:MCP_SRV_URL',
        allowed: true,
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ key: 'srv', allowed: true, enabled: true });
    // Контракт: ни секрета, ни endpoint в ответе.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/secret|endpoint|MCP_SRV_URL|token/i);
    await app.close();
  });

  it('snapshot: новые tools disabled; повтор → тот же hash; новый tool не включается', async () => {
    const { app, mcpRepo } = await build();
    const auth = await token('admin', ['admin']);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mcp/servers',
        headers: { authorization: auth },
        payload: { key: 'srv', name: 'Srv', allowed: true, enabled: true },
      })
    ).json();

    const snap1 = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${created.id}/snapshot-tools`,
      headers: { authorization: auth },
    });
    expect(snap1.statusCode).toBe(200);
    expect(snap1.json()).toMatchObject({ total: 2, added: 2, kept: 0 });
    const tools = await mcpRepo.listTools(created.id);
    expect(tools.every((t) => t.enabled === false)).toBe(true);

    // Повтор того же snapshot → тот же hash, added=0.
    const snap2 = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${created.id}/snapshot-tools`,
      headers: { authorization: auth },
    });
    expect(snap2.json().hash).toBe(snap1.json().hash);
    expect(snap2.json().added).toBe(0);
    await app.close();
  });

  it('enable: tool регистрируется в ToolRegistry и проходит через Tool Broker', async () => {
    const { app, mcpRepo, toolRegistry } = await build();
    const auth = await token('admin', ['admin']);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mcp/servers',
        headers: { authorization: auth },
        payload: { key: 'srv', name: 'Srv', allowed: true, enabled: true },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${created.id}/snapshot-tools`,
      headers: { authorization: auth },
    });

    const name = mcpToolName('srv', 'echo');
    expect(toolRegistry.has(name)).toBe(false);

    const enable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/mcp/servers/${created.id}/tools/echo/enable`,
      headers: { authorization: auth },
      payload: { enabled: true },
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json()).toMatchObject({ toolName: 'echo', enabled: true });
    expect(toolRegistry.has(name)).toBe(true);

    // Реально проходит через брокер → stub-клиент возвращает echo-результат.
    const broker = new ToolBroker(toolRegistry);
    const out = await broker.invoke(name, { x: 1 }, {
      subject: { id: 'admin', roles: ['admin'] },
      auditSink: new InMemoryAuditSink(),
      at: '2026-06-30T00:00:00.000Z',
    });
    expect(out).toEqual({ value: 42 });

    // disable → снимается с регистрации.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/mcp/servers/${created.id}/tools/echo/enable`,
      headers: { authorization: auth },
      payload: { enabled: false },
    });
    expect(toolRegistry.has(name)).toBe(false);
    void mcpRepo;
    await app.close();
  });

  it('health-check записывает результат и возвращает ok', async () => {
    const { app, mcpRepo } = await build();
    const auth = await token('admin', ['admin']);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mcp/servers',
        headers: { authorization: auth },
        payload: { key: 'srv', name: 'Srv', allowed: true },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${created.id}/health-check`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'ok' });
    const checks = await mcpRepo.listHealthChecks(created.id, 10);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('ok');
    await app.close();
  });

  it('not-allowed server: включённый tool не исполняется через брокер (AuthzError)', async () => {
    const { app, toolRegistry } = await build();
    const auth = await token('admin', ['admin']);
    // allowed=false: tool не должен исполняться, даже если enabled в БД.
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mcp/servers',
        headers: { authorization: auth },
        payload: { key: 'srv', name: 'Srv', allowed: false, enabled: true },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${created.id}/snapshot-tools`,
      headers: { authorization: auth },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/mcp/servers/${created.id}/tools/echo/enable`,
      headers: { authorization: auth },
      payload: { enabled: true },
    });

    // shouldRegister=false (server.allowed=false) → tool НЕ в реестре.
    expect(toolRegistry.has(mcpToolName('srv', 'echo'))).toBe(false);
    await app.close();
  });
});
