import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { InMemoryRagRepository, createRagService } from '@su10/rag';
import { buildApp } from '../app.js';
import { createStubTemporalPort } from '../temporal/stubTemporalPort.js';
import { testServerConfig } from '../test-support/serverConfig.js';
import type { AgentApiConfig } from '../config.js';

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

function makeRagService() {
  const repo = new InMemoryRagRepository();
  repo.add(
    {
      chunkId: 'hr-1',
      documentId: 'd-hr',
      ownerUserId: 'u-1',
      title: 'HR doc',
      contentOriginal: 'политика по зарплата',
      contentEmbedding: 'политика по зарплата',
    },
    [1, 0, 0, 0],
  );
  return createRagService({
    repository: repo,
    embedder: { async embed(texts) { return texts.map(() => [1, 0, 0, 0]); } },
  });
}

async function build(opts: { llmFails?: boolean } = {}) {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('rag-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  const llm = {
    analyzeLongContext: async (): Promise<string> => {
      if (opts.llmFails) throw new Error('llm down');
      return 'Ответ по контексту [1]';
    },
  };
  return buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry,
    toolTestBroker: new ToolBroker(sandboxRegistry),
    rag: { ragService: makeRagService(), llm, auditSink: new InMemoryAuditSink() },
  });
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, { sub, issuer: ISSUER, audience: 'account', azp: AUD, realmRoles: roles })}`;
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('POST /rag/search', () => {
  it('401 without a token', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/v1/rag/search', payload: { query: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('owner gets ACL-allowed chunks with citations and timings', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rag/search',
      headers: { authorization: await token('u-1') },
      payload: { query: 'зарплата' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.chunks.map((c: { documentId: string }) => c.documentId)).toContain('d-hr');
    expect(body.citations[0]).toMatchObject({ documentId: 'd-hr' });
    expect(body.timings).toHaveProperty('totalMs');
  });

  it('does not return chunks a different user cannot access', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rag/search',
      headers: { authorization: await token('u-2') },
      payload: { query: 'зарплата' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).chunks).toHaveLength(0);
  });

  it('400 on invalid body', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rag/search',
      headers: { authorization: await token('u-1') },
      payload: { query: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /rag/answer', () => {
  it('returns an answer with citations', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rag/answer',
      headers: { authorization: await token('u-1') },
      payload: { query: 'зарплата' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.answer).toContain('[1]');
    expect(Array.isArray(body.citations)).toBe(true);
  });

  it('502 with a typed upstream error when the LLM gateway fails', async () => {
    const app = await build({ llmFails: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rag/answer',
      headers: { authorization: await token('u-1') },
      payload: { query: 'зарплата' },
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('GET /rag/status', () => {
  it('403 for non-admin, 200 for admin', async () => {
    const app = await build();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/rag/status',
      headers: { authorization: await token('u-1') },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/rag/status',
      headers: { authorization: await token('admin-1', ['admin']) },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ aclEnforced: true });
  });
});
