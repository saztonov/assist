import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo, InMemoryChatRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
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
let auditSink: InMemoryAuditSink;

async function build() {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('chat-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  auditSink = new InMemoryAuditSink();
  return buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink,
    toolRegistry,
    toolTestBroker: new ToolBroker(new ToolRegistry()),
    chat: { chatRepo: new InMemoryChatRepo(), auditSink },
  });
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, { sub, issuer: ISSUER, audience: 'account', azp: AUD, realmRoles: roles })}`;
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('chat REST', () => {
  it('401 без токена', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/chat/sessions' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('создаёт сессию, постит user+assistant (echo), не пишет контент в audit', async () => {
    const app = await build();
    const auth = await token('u-1');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sessions',
      headers: { authorization: auth },
      payload: { title: 'Тест' },
    });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().id as string;

    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/chat/sessions/${sessionId}/messages`,
      headers: { authorization: auth },
      payload: { content: 'привет агент' },
    });
    expect(posted.statusCode).toBe(201);
    const body = posted.json();
    expect(body.userMessage.content).toBe('привет агент');
    expect(body.assistantMessage.role).toBe('assistant');
    expect(body.assistantMessage.content).toBe('Эхо: привет агент');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/chat/sessions/${sessionId}`,
      headers: { authorization: auth },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().messages).toHaveLength(2);

    // Контент сообщений НЕ должен присутствовать в audit.
    const serialized = JSON.stringify(auditSink.events);
    expect(serialized).not.toContain('привет агент');
    expect(auditSink.events.some((e) => e.action === 'chat.message.post')).toBe(true);
    await app.close();
  });

  it('чужая сессия → 404', async () => {
    const app = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat/sessions',
      headers: { authorization: await token('owner') },
      payload: {},
    });
    const sessionId = created.json().id as string;

    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/chat/sessions/${sessionId}`,
      headers: { authorization: await token('intruder') },
    });
    expect(other.statusCode).toBe(404);
    await app.close();
  });

  it('список сессий скоупится по владельцу', async () => {
    const app = await build();
    await app.inject({ method: 'POST', url: '/api/v1/agent/chat/sessions', headers: { authorization: await token('u-1') }, payload: {} });
    await app.inject({ method: 'POST', url: '/api/v1/agent/chat/sessions', headers: { authorization: await token('u-2') }, payload: {} });

    const list = await app.inject({ method: 'GET', url: '/api/v1/agent/chat/sessions', headers: { authorization: await token('u-1') } });
    expect(list.json().items).toHaveLength(1);
    await app.close();
  });
});
