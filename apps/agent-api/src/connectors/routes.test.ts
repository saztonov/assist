import { describe, it, expect, beforeAll } from 'vitest';
import { createLogger } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { InMemoryAgentTaskRepo, InMemoryConnectorRepo, type SecretResolver } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { createStubMailProviderFactory, StubMailProvider } from '@su10/mail-connector';
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

const SECRET_REF = 'env:MAIL_TEST_APP_PASSWORD';
const secretResolver: SecretResolver = {
  resolve: (ref) => (ref === SECRET_REF ? 'app-pass' : (() => { throw new Error('no secret'); })()),
  tryResolve: (ref) => (ref === SECRET_REF ? 'app-pass' : undefined),
};

let kp: DevKeypair;

async function build() {
  const config = makeConfig(JSON.stringify(kp.publicJwks));
  const oidc = createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks });
  const logger = createLogger('conn-test', { level: 'silent' });
  const registry = new ToolRegistry();
  registerBaseTools(registry, createInMemoryBaseToolDeps().deps);
  const connectorRepo = new InMemoryConnectorRepo();
  const auditSink = new InMemoryAuditSink();
  const app = await buildApp({
    config,
    logger,
    oidc,
    taskRepo: new InMemoryAgentTaskRepo(),
    temporal: createStubTemporalPort(),
    auditSink: new InMemoryAuditSink(),
    toolRegistry: registry,
    toolTestBroker: new ToolBroker(registry),
    connectors: {
      connectorRepo,
      secretResolver,
      providerFactory: createStubMailProviderFactory(new StubMailProvider([])),
      auditSink,
    },
  });
  return { app, connectorRepo, auditSink };
}

async function token(sub: string, roles: string[] = []): Promise<string> {
  return `Bearer ${await signDevToken(kp, { sub, issuer: ISSUER, audience: 'account', azp: AUD, realmRoles: roles })}`;
}

async function seed(connectorRepo: InMemoryConnectorRepo, ownerUserId: string) {
  return connectorRepo.createAccount({
    connectorKey: 'mail',
    ownerUserId,
    secretRef: SECRET_REF,
    status: 'active',
    enabled: true,
    metadata: { host: 'imap.yandex.ru', user: 'me@yandex.ru' },
  });
}

beforeAll(async () => {
  kp = await generateDevKeypair();
});

describe('GET /connectors', () => {
  it('401 without a token', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/connectors' });
    expect(res.statusCode).toBe(401);
  });

  it('lists only owned connections; admin sees all; no secrets/host leak', async () => {
    const { app, connectorRepo } = await build();
    await seed(connectorRepo, 'u-1');
    await seed(connectorRepo, 'u-9');

    const owner = await app.inject({ method: 'GET', url: '/api/v1/connectors', headers: { authorization: await token('u-1') } });
    expect(owner.statusCode).toBe(200);
    const body = JSON.parse(owner.body);
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ providerKind: 'generic-imap', mailbox: 'INBOX', status: 'active' });
    expect(owner.body).not.toContain('app-pass');
    expect(owner.body).not.toContain('imap.yandex.ru');
    expect(owner.body).not.toContain(SECRET_REF);

    const stranger = await app.inject({ method: 'GET', url: '/api/v1/connectors', headers: { authorization: await token('u-7') } });
    expect(JSON.parse(stranger.body).connections).toHaveLength(0);

    const admin = await app.inject({ method: 'GET', url: '/api/v1/connectors', headers: { authorization: await token('a', ['admin']) } });
    expect(JSON.parse(admin.body).connections).toHaveLength(2);
  });
});

describe('GET /connectors/:id', () => {
  it('owner reads; stranger gets 404 (no existence leak)', async () => {
    const { app, connectorRepo } = await build();
    const acc = await seed(connectorRepo, 'u-1');
    const owner = await app.inject({ method: 'GET', url: `/api/v1/connectors/${acc.id}`, headers: { authorization: await token('u-1') } });
    expect(owner.statusCode).toBe(200);
    expect(JSON.parse(owner.body).connectorAccountId).toBe(acc.id);

    const stranger = await app.inject({ method: 'GET', url: `/api/v1/connectors/${acc.id}`, headers: { authorization: await token('u-2') } });
    expect(stranger.statusCode).toBe(404);
  });
});

describe('POST /connectors', () => {
  const body = {
    displayName: 'My mailbox',
    providerKind: 'yandex360',
    host: 'imap.yandex.ru',
    user: 'me@yandex.ru',
    secretRef: SECRET_REF,
  };

  it('403 without the management role', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'POST', url: '/api/v1/connectors', headers: { authorization: await token('u-1') }, payload: body });
    expect(res.statusCode).toBe(403);
  });

  it('201 stores secretRef + metadata (raw secret never accepted)', async () => {
    const { app, connectorRepo } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      headers: { authorization: await token('u-1', ['connector.mail.create']) },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const { connectorAccountId } = JSON.parse(res.body);
    const stored = await connectorRepo.getAccount(connectorAccountId);
    expect(stored?.secretRef).toBe(SECRET_REF);
    expect(stored?.metadataJson).toMatchObject({ host: 'imap.yandex.ru', providerKind: 'yandex360' });
    // Metadata must not carry any secret value.
    expect(JSON.stringify(stored?.metadataJson)).not.toContain('app-pass');
  });

  it('rejects secret-like metadata keys (strict schema → 400)', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      headers: { authorization: await token('u-1', ['connector.mail.create']) },
      payload: { ...body, password: 'leak' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /connectors/:id/test', () => {
  it('runs verify (stub ok) and updates status to active', async () => {
    const { app, connectorRepo } = await build();
    const acc = await seed(connectorRepo, 'u-1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/connectors/${acc.id}/test`, headers: { authorization: await token('u-1') } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, status: 'active' });
  });

  it('404 for a non-owner', async () => {
    const { app, connectorRepo } = await build();
    const acc = await seed(connectorRepo, 'u-1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/connectors/${acc.id}/test`, headers: { authorization: await token('u-2') } });
    expect(res.statusCode).toBe(404);
  });
});
