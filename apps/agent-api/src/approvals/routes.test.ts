import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentApprovalRepo, InMemoryAgentTaskRepo } from '@su10/db';
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

async function build() {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('approvals-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  const approvalRepo = new InMemoryAgentApprovalRepo();
  const app = await buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry,
    toolTestBroker: new ToolBroker(new ToolRegistry()),
    approvals: { approvalRepo, auditSink: new InMemoryAuditSink() },
  });
  return { app, approvalRepo };
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, { sub, issuer: ISSUER, audience: 'account', azp: AUD, realmRoles: roles })}`;
}

async function seed(approvalRepo: InMemoryAgentApprovalRepo, subjectId: string) {
  return approvalRepo.create({
    subjectId,
    riskLevel: 'high',
    action: 'mail.create_draft',
    resource: 'draft:1',
  });
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('approvals REST', () => {
  it('401 без токена', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/approvals' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('список отдаёт только свои pending; admin видит все', async () => {
    const { app, approvalRepo } = await build();
    await seed(approvalRepo, 'u-1');
    await seed(approvalRepo, 'u-2');

    const own = await app.inject({ method: 'GET', url: '/api/v1/approvals', headers: { authorization: await token('u-1') } });
    expect(own.json().items).toHaveLength(1);

    const all = await app.inject({ method: 'GET', url: '/api/v1/approvals', headers: { authorization: await token('admin', ['admin']) } });
    expect(all.json().items).toHaveLength(2);
    await app.close();
  });

  it('чужое approval → 404', async () => {
    const { app, approvalRepo } = await build();
    const a = await seed(approvalRepo, 'u-1');
    const res = await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.id}`, headers: { authorization: await token('u-2') } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('approve меняет статус один раз; повторный resolve → 409', async () => {
    const { app, approvalRepo } = await build();
    const a = await seed(approvalRepo, 'u-1');
    const auth = await token('u-1');

    const ok = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.id}/approve`, headers: { authorization: auth }, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('approved');

    const again = await app.inject({ method: 'POST', url: `/api/v1/approvals/${a.id}/reject`, headers: { authorization: auth }, payload: {} });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('reject работает и пишет reason', async () => {
    const { app, approvalRepo } = await build();
    const a = await seed(approvalRepo, 'u-1');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${a.id}/reject`,
      headers: { authorization: await token('u-1') },
      payload: { reason: 'не согласовано' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'rejected', reason: 'не согласовано' });
    await app.close();
  });
});
