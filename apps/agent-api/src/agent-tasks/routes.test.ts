import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { buildApp } from '../app.js';
import type { AgentApiConfig } from '../config.js';
import { createStubTemporalPort, type StubTemporalPort } from '../temporal/stubTemporalPort.js';
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

interface Built {
  app: Awaited<ReturnType<typeof buildApp>>;
  repo: InMemoryAgentTaskRepo;
  audit: InMemoryAuditSink;
  temporal: StubTemporalPort;
}

async function build(opts: { temporal?: StubTemporalPort } = {}): Promise<Built> {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('agent-tasks-test', { level: 'silent' });
  const repo = new InMemoryAgentTaskRepo();
  const audit = new InMemoryAuditSink();
  const temporal = opts.temporal ?? createStubTemporalPort();
  const app = await buildApp({ config, logger, oidc, taskRepo: repo, temporal, auditSink: audit });
  return { app, repo, audit, temporal };
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

const actions = (audit: InMemoryAuditSink): string[] => audit.events.map((e) => e.action);

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('POST /agent/tasks', () => {
  it('401 без токена', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'POST', url: '/api/v1/agent/tasks', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('создаёт задачу: created → queued + workflowId; audit create+start', async () => {
    const { app, audit, temporal } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/tasks',
      headers: { authorization: await token('u-1') },
      payload: { title: 'Отчёт' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('queued');
    expect(body.workflowId).toMatch(/^agent-task-/);
    expect(temporal.started.has(body.workflowId)).toBe(true);
    expect(actions(audit)).toEqual(['agent_task.create', 'agent_task.start']);
    await app.close();
  });

  it('ошибка старта Temporal → failed + errorCode; audit create+fail', async () => {
    const { app, audit } = await build({ temporal: createStubTemporalPort({ failStart: true }) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/tasks',
      headers: { authorization: await token('u-1') },
      payload: { title: 'X' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('failed');
    expect(body.errorCode).toBe('TEMPORAL_START_FAILED');
    const evs = audit.events;
    expect(actions(audit)).toEqual(['agent_task.create', 'agent_task.fail']);
    expect(evs[1].outcome).toBe('failure');
    await app.close();
  });

  it('невалидное тело → 400', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/tasks',
      headers: { authorization: await token('u-1') },
      payload: { templateId: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });
});

describe('GET /agent/tasks (scope + фильтр)', () => {
  it('не-admin видит только свои; admin видит все; фильтр по статусу', async () => {
    const { app, repo } = await build();
    const a = await repo.createTask({ createdBy: 'u-1' });
    await repo.createTask({ createdBy: 'u-2' });
    await repo.transitionStatus({ taskId: a.id, to: 'queued' });

    const own = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/tasks',
      headers: { authorization: await token('u-1') },
    });
    expect(own.statusCode).toBe(200);
    const ownBody = own.json();
    expect(ownBody.items).toHaveLength(1);
    expect(ownBody.items[0].createdBy).toBe('u-1');

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/tasks',
      headers: { authorization: await token('admin-1', ['admin']) },
    });
    expect(all.json().items).toHaveLength(2);

    const queued = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/tasks?status=queued',
      headers: { authorization: await token('u-1') },
    });
    expect(queued.json().items).toHaveLength(1);
    expect(queued.json().items[0].id).toBe(a.id);
    await app.close();
  });
});

describe('GET /agent/tasks/:id (+ events)', () => {
  it('свой → 200; чужой → 404; неизвестный → 404; события упорядочены', async () => {
    const { app, repo } = await build();
    const t = await repo.createTask({ createdBy: 'u-1' });

    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/tasks/${t.id}`,
      headers: { authorization: await token('u-1') },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().id).toBe(t.id);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/tasks/${t.id}`,
      headers: { authorization: await token('u-2') },
    });
    expect(foreign.statusCode).toBe(404);

    const unknown = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/tasks/${crypto.randomUUID()}`,
      headers: { authorization: await token('u-1') },
    });
    expect(unknown.statusCode).toBe(404);

    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/tasks/${t.id}/events`,
      headers: { authorization: await token('u-1') },
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().items[0]).toMatchObject({ eventType: 'created', status: 'created' });
    await app.close();
  });
});

describe('POST /agent/tasks/:id/cancel', () => {
  it('отмена своей задачи без workflowId → cancelled (без сигнала); audit cancel', async () => {
    const { app, repo, audit, temporal } = await build();
    const t = await repo.createTask({ createdBy: 'u-1' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/tasks/${t.id}/cancel`,
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect(temporal.cancelled.size).toBe(0);
    expect(actions(audit)).toContain('agent_task.cancel');
    await app.close();
  });

  it('отмена терминальной задачи → 409', async () => {
    const { app, repo } = await build();
    const t = await repo.createTask({ createdBy: 'u-1' });
    await repo.transitionStatus({ taskId: t.id, to: 'cancelled' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/tasks/${t.id}/cancel`,
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await app.close();
  });

  it('отмена чужой задачи → 404', async () => {
    const { app, repo } = await build();
    const t = await repo.createTask({ createdBy: 'u-1' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/tasks/${t.id}/cancel`,
      headers: { authorization: await token('u-2') },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('отмена queued-задачи c workflowId → сигнал отмены отправлен', async () => {
    const { app, temporal } = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/tasks',
      headers: { authorization: await token('u-1') },
      payload: { title: 'T' },
    });
    const { id, workflowId } = created.json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/tasks/${id}/cancel`,
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect(temporal.cancelled.has(workflowId)).toBe(true);
    await app.close();
  });
});
