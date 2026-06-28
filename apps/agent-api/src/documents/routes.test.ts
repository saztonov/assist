import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo, InMemoryDocumentRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import type { DocumentStoragePort } from '@su10/s3';
import { buildApp } from '../app.js';
import type { DocumentProcessingPort } from '../documents/routes.js';
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

function fakeStorage(state: { exists: boolean }): DocumentStoragePort {
  return {
    buildObjectKey: ({ filename }) => `documents/test/${filename}`,
    presignPut: async (key) => `https://s3.local/${key}?X-Amz-Signature=abc`,
    putObject: async () => undefined,
    headObject: async () => (state.exists ? { size: 10, etag: '"e"' } : null),
    getObjectBytes: async () => new Uint8Array([1, 2, 3]),
  };
}

async function build(storageState = { exists: true }, documentProcessing?: DocumentProcessingPort) {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('docs-test', { level: 'silent' });
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createInMemoryBaseToolDeps().deps);
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  const documentRepo = new InMemoryDocumentRepo();
  const app = await buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry,
    toolTestBroker: new ToolBroker(sandboxRegistry),
    documents: {
      documentRepo,
      storage: fakeStorage(storageState),
      auditSink: new InMemoryAuditSink(),
      ...(documentProcessing ? { documentProcessing } : {}),
    },
  });
  return { app, documentRepo };
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

async function createSession(app: Awaited<ReturnType<typeof build>>['app'], auth: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/documents/upload-session',
    headers: { authorization: auth },
    payload: { filename: 'act.pdf', mimeType: 'application/pdf', title: 'Акт' },
  });
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('POST /documents/upload-session', () => {
  it('401 without a token', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/upload-session',
      payload: { filename: 'a.pdf', mimeType: 'application/pdf' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('201 returns documentId + presigned uploadUrl + pending_upload', async () => {
    const { app } = await build();
    const res = await createSession(app, await token('u-1'));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.documentId).toBeTruthy();
    expect(body.uploadUrl).toContain('X-Amz-Signature');
    expect(body.status).toBe('pending_upload');
  });

  it('rejects invalid bodies (zod)', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/upload-session',
      headers: { authorization: await token('u-1') },
      payload: { filename: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /documents/:id/confirm', () => {
  it('200 marks uploaded and returns a parse job when the object exists', async () => {
    const { app } = await build({ exists: true });
    const auth = await token('u-1');
    const session = JSON.parse((await createSession(app, auth)).body);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${session.documentId}/confirm`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('uploaded');
    expect(body.parseJobId).toBeTruthy();
  });

  it('409 when the uploaded object is missing in storage', async () => {
    const { app } = await build({ exists: false });
    const auth = await token('u-1');
    const session = JSON.parse((await createSession(app, auth)).body);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${session.documentId}/confirm`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(409);
  });

  it('404 when a different non-admin user confirms', async () => {
    const { app } = await build({ exists: true });
    const session = JSON.parse((await createSession(app, await token('u-1'))).body);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${session.documentId}/confirm`,
      headers: { authorization: await token('u-2') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('starts the Temporal processing workflow → status indexing', async () => {
    const started: string[] = [];
    const { app } = await build(
      { exists: true },
      {
        start: async (input) => {
          started.push(input.documentId);
          return { workflowId: `document-${input.documentId}` };
        },
      },
    );
    const auth = await token('u-1');
    const session = JSON.parse((await createSession(app, auth)).body);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${session.documentId}/confirm`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('indexing');
    expect(started).toContain(session.documentId);
  });

  it('marks failed (without losing confirm) when workflow start fails', async () => {
    const { app } = await build(
      { exists: true },
      {
        start: async () => {
          throw new Error('temporal down');
        },
      },
    );
    const auth = await token('u-1');
    const session = JSON.parse((await createSession(app, auth)).body);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${session.documentId}/confirm`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('failed');
  });
});

describe('GET /documents/:id', () => {
  it('owner can read; a different non-admin user gets 404 (ACL)', async () => {
    const { app } = await build();
    const session = JSON.parse((await createSession(app, await token('u-1'))).body);

    const owner = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${session.documentId}`,
      headers: { authorization: await token('u-1') },
    });
    expect(owner.statusCode).toBe(200);
    expect(JSON.parse(owner.body).id).toBe(session.documentId);

    const stranger = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${session.documentId}`,
      headers: { authorization: await token('u-2') },
    });
    expect(stranger.statusCode).toBe(404);

    const admin = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${session.documentId}`,
      headers: { authorization: await token('u-3', ['admin']) },
    });
    expect(admin.statusCode).toBe(200);
  });
});
