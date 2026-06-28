import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo, InMemoryProviderRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { buildApp } from '../app.js';
import { createStubTemporalPort } from '../temporal/stubTemporalPort.js';
import { testServerConfig } from '../test-support/serverConfig.js';
import type { AgentApiConfig } from '../config.js';
import type { LlmAdminDeps } from './routes.js';

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
    openapi: { enabled: false, uiEnabled: false },
    oidc: { issuer: ISSUER, audience: AUD, clientId: AUD, resourceClient: AUD, devJwks, clockToleranceSec: 5 },
    readiness: { llmEnabled: false, dbEnabled: false },
    temporal: { enabled: false },
  };
}

let kp: DevKeypair;

const fakeLlm: LlmAdminDeps['llm'] = {
  async listModels() {
    return [{ id: 'qwen36-27b-mtp' }, { id: 'lift' }];
  },
  async healthCheck() {
    return { status: 'ok', models: ['qwen36-27b-mtp', 'lift'] };
  },
  async chatCompletion({ model }) {
    return { content: 'pong', model: model ?? 'qwen36-27b-mtp' };
  },
};

async function build() {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('llm-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  const providerRepo = new InMemoryProviderRepo();
  const app = await buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry,
    toolTestBroker: new ToolBroker(sandboxRegistry),
    llmAdmin: { providerRepo, llm: fakeLlm, auditSink: new InMemoryAuditSink() },
  });
  return { app, providerRepo };
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, { sub, issuer: ISSUER, audience: 'account', azp: AUD, realmRoles: roles })}`;
}

const admin = (): Promise<string> => token('admin-1', ['admin']);

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('LLM admin API — authorization', () => {
  it('401 without a token', async () => {
    const { app } = await build();
    expect((await app.inject({ method: 'GET', url: '/api/v1/llm/providers' })).statusCode).toBe(401);
  });

  it('403 for a non-admin user', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/llm/providers',
      headers: { authorization: await token('u-1') },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('LLM admin API — provider/model CRUD', () => {
  it('registers a provider with a secret_ref (no raw secret) and lists it', async () => {
    const { app } = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/providers',
      headers: { authorization: await admin() },
      payload: {
        providerType: 'lmstudio',
        displayName: 'LM Studio',
        apiTokenSecretRef: 'env:LLM_STUDIO_API_TOKEN',
        localOnly: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body);
    expect(body.hasToken).toBe(true);
    // The raw secret ref must NOT be echoed back.
    expect(created.body).not.toContain('env:LLM_STUDIO_API_TOKEN');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/llm/providers',
      headers: { authorization: await admin() },
    });
    expect(JSON.parse(list.body).providers).toHaveLength(1);
  });

  it('rejects a raw-secret key via strict schema', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/providers',
      headers: { authorization: await admin() },
      payload: { providerType: 'lmstudio', displayName: 'X', token: 'raw-secret' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('adds a model to a provider and lists provider models', async () => {
    const { app } = await build();
    const provider = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/llm/providers',
          headers: { authorization: await admin() },
          payload: { providerType: 'lmstudio', displayName: 'LM Studio' },
        })
      ).body,
    );
    const model = await app.inject({
      method: 'POST',
      url: `/api/v1/llm/providers/${provider.id}/models`,
      headers: { authorization: await admin() },
      payload: { modelId: 'qwen36-27b-mtp', purpose: 'analysis', contextWindow: 131072, maxParallelRequests: 1 },
    });
    expect(model.statusCode).toBe(201);
    expect(JSON.parse(model.body).modelId).toBe('qwen36-27b-mtp');
  });
});

describe('LLM admin API — analysis, health, test', () => {
  it('merges registered models with live availability', async () => {
    const { app, providerRepo } = await build();
    const p = await providerRepo.createProvider({ providerType: 'lmstudio', displayName: 'LM' });
    await providerRepo.createModel({ providerId: p.id, modelId: 'qwen36-27b-mtp', purpose: 'analysis' });
    await providerRepo.createModel({ providerId: p.id, modelId: 'unregistered-but-not-live', purpose: 'chat' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/llm/models',
      headers: { authorization: await admin() },
    });
    expect(res.statusCode).toBe(200);
    const models = JSON.parse(res.body).models as Array<{ modelId: string; registered: boolean; available: boolean }>;
    const qwen = models.find((m) => m.modelId === 'qwen36-27b-mtp');
    expect(qwen).toMatchObject({ registered: true, available: true });
    // A live model not in the registry is surfaced as available + not registered.
    expect(models.find((m) => m.modelId === 'lift')).toMatchObject({ registered: false, available: true });
  });

  it('reports provider health', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/llm/health',
      headers: { authorization: await admin() },
    });
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok' });
  });

  it('runs a sandbox model test', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/models/qwen36-27b-mtp/test',
      headers: { authorization: await admin() },
    });
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, model: 'qwen36-27b-mtp' });
  });
});

describe('LLM admin API — policies', () => {
  it('creates and lists routing policies', async () => {
    const { app } = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/policies',
      headers: { authorization: await admin() },
      payload: { name: 'sensitive-local-only', dataClass: 'pii', decision: 'deny', localOnlyRequired: true },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/llm/policies',
      headers: { authorization: await admin() },
    });
    expect(JSON.parse(list.body).policies).toHaveLength(1);
  });
});
