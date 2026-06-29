import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo, InMemoryWorkflowTemplateRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry, type ToolDefinition } from '@su10/tools';
import { buildApp } from '../app.js';
import type { AgentApiConfig } from '../config.js';
import { createStubTemporalPort, type StubTemporalPort } from '../temporal/stubTemporalPort.js';
import { testServerConfig } from '../test-support/serverConfig.js';

const ISSUER = 'https://auth.su10.ru/realms/portal';
const AUD = 'agent-api';

const VALID_DEF = {
  id: 'd',
  name: 'n',
  version: 1,
  nodes: [
    { id: 'a', type: 'manual_trigger', position: { x: 0, y: 0 } },
    { id: 'b', type: 'tool', toolRef: 'rag.search', position: { x: 200, y: 0 } },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b' }],
};

function fakeTool(name: string): ToolDefinition {
  return {
    name,
    version: 1,
    description: name,
    category: 'system',
    riskLevel: 'low',
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}).passthrough(),
    timeoutMs: 1000,
    handler: async () => ({}),
  };
}

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
  taskRepo: InMemoryAgentTaskRepo;
  templateRepo: InMemoryWorkflowTemplateRepo;
  audit: InMemoryAuditSink;
  temporal: StubTemporalPort;
}

async function build(opts: { temporal?: StubTemporalPort } = {}): Promise<Built> {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('wf-templates-test', { level: 'silent' });
  const taskRepo = new InMemoryAgentTaskRepo();
  const templateRepo = new InMemoryWorkflowTemplateRepo();
  const audit = new InMemoryAuditSink();
  const temporal = opts.temporal ?? createStubTemporalPort();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(fakeTool('rag.search'));
  const toolTestBroker = new ToolBroker(toolRegistry);
  const app = await buildApp({
    config,
    logger,
    oidc,
    taskRepo,
    templateRepo,
    temporal,
    auditSink: audit,
    toolRegistry,
    toolTestBroker,
  });
  return { app, taskRepo, templateRepo, audit, temporal };
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

async function createTemplate(
  app: Built['app'],
  auth: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/workflow-templates',
    headers: { authorization: auth },
    payload: body,
  });
  return { id: res.json().id };
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('workflow-templates API', () => {
  it('401 без токена', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/workflow-templates' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('создаёт draft v1; невалидное тело → 400', async () => {
    const { app } = await build();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-templates',
      headers: { authorization: await token('u-1') },
      payload: { name: 'Мой шаблон' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'draft', latestVersion: 1 });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-templates',
      headers: { authorization: await token('u-1') },
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('create → save draft → publish; audit-последовательность', async () => {
    const { app, audit } = await build();
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, { name: 'T' });

    const draft = await app.inject({
      method: 'PUT',
      url: `/api/v1/workflow-templates/${id}/draft`,
      headers: { authorization: auth },
      payload: { definition: VALID_DEF },
    });
    expect(draft.statusCode).toBe(200);

    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/publish`,
      headers: { authorization: auth },
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().status).toBe('published');
    expect(actions(audit)).toEqual([
      'workflow_template.create',
      'workflow_template.save_draft',
      'workflow_template.publish',
    ]);
    await app.close();
  });

  it('publish невалидного графа (нет триггера) → 409', async () => {
    const { app } = await build();
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, {
      name: 'T',
      definition: { id: 'd', name: 'n', version: 1, nodes: [{ id: 'x', type: 'tool', toolRef: 'rag.search' }], edges: [] },
    });
    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/publish`,
      headers: { authorization: auth },
    });
    expect(pub.statusCode).toBe(409);
    expect(pub.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await app.close();
  });

  it('publish с неизвестным toolRef → 409', async () => {
    const { app } = await build();
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, {
      name: 'T',
      definition: {
        id: 'd',
        name: 'n',
        version: 1,
        nodes: [
          { id: 'a', type: 'manual_trigger' },
          { id: 'b', type: 'tool', toolRef: 'nope.missing' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
    });
    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/publish`,
      headers: { authorization: auth },
    });
    expect(pub.statusCode).toBe(409);
    await app.close();
  });

  it('доступ: чужой → 404, admin → 200', async () => {
    const { app } = await build();
    const { id } = await createTemplate(app, await token('u-1'), { name: 'T' });

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-templates/${id}`,
      headers: { authorization: await token('u-2') },
    });
    expect(foreign.statusCode).toBe(404);

    const adminRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-templates/${id}`,
      headers: { authorization: await token('admin-1', ['admin']) },
    });
    expect(adminRes.statusCode).toBe(200);
    await app.close();
  });

  it('save draft после publish форкает v2 (status → draft)', async () => {
    const { app } = await build();
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, { name: 'T', definition: VALID_DEF });
    await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/publish`,
      headers: { authorization: auth },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/workflow-templates/${id}/draft`,
      headers: { authorization: auth },
      payload: { definition: VALID_DEF },
    });
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-templates/${id}`,
      headers: { authorization: auth },
    });
    expect(got.json()).toMatchObject({ status: 'draft', latestVersion: 2 });
    await app.close();
  });

  it('test-run валидного шаблона → 201 queued + visual-старт', async () => {
    const { app, temporal } = await build();
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, { name: 'T', definition: VALID_DEF });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/test-run`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('queued');
    expect(body.workflowId).toMatch(/^agent-task-/);
    expect(temporal.startedVisual.has(body.workflowId)).toBe(true);
    await app.close();
  });

  it('test-run при сбое Temporal → 201 failed/TEMPORAL_START_FAILED', async () => {
    const { app } = await build({ temporal: createStubTemporalPort({ failStart: true }) });
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, { name: 'T', definition: VALID_DEF });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/test-run`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'failed', errorCode: 'TEMPORAL_START_FAILED' });
    await app.close();
  });

  it('test-run невалидного графа → 409', async () => {
    const { app } = await build();
    const auth = await token('u-1');
    const { id } = await createTemplate(app, auth, { name: 'T' }); // пустой default — нет триггера
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-templates/${id}/test-run`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
