import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { AuthzError } from '@su10/errors';
import { REDACT_PATHS } from '@su10/logger';
import { createOidc, generateDevKeypair, signDevToken, type DevKeypair } from '@su10/oidc';
import { securityPlugin, authPlugin } from './index.js';

const ISSUER = 'https://auth.su10.ru/realms/portal';
const AUD = 'agent-api';

async function buildTestApp(kp: DevKeypair, logSink?: string[]): Promise<FastifyInstance> {
  const loggerInstance = pino(
    { redact: { paths: REDACT_PATHS, censor: '[Redacted]' }, level: 'info' },
    { write: (s: string) => void logSink?.push(s) } as unknown as NodeJS.WritableStream,
  );
  const app = Fastify({ loggerInstance });
  await app.register(securityPlugin, { corsOrigins: false, rateLimit: { max: 1000 } });

  // Public scope — no auth.
  app.get('/pub', async () => ({ ok: true }));
  app.get('/boom', async () => {
    throw new AuthzError('nope', { secret: 'do-not-leak' });
  });

  // Authenticated scope — auth hook applies only here.
  await app.register(async (api) => {
    await api.register(authPlugin, {
      oidc: createOidc({ issuer: ISSUER, audience: AUD, clientId: AUD, jwks: kp.publicJwks }),
    });
    api.get('/prot', async (req) => ({ sub: req.auth?.sub, portal: req.ctx.sourcePortal }));
    api.get('/dump', async (req) => {
      req.log.info({ headers: req.headers }, 'dump headers');
      return { ok: true };
    });
  });

  await app.ready();
  return app;
}

describe('fastify-security', () => {
  let kp: DevKeypair;
  beforeAll(async () => {
    kp = await generateDevKeypair();
  });

  const token = (over = {}) =>
    signDevToken(kp, { sub: 'u-1', issuer: ISSUER, audience: 'account', azp: AUD, ...over });

  it('public route bypasses auth (encapsulation, not path matching)', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({ method: 'GET', url: '/pub' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBeDefined();
    await app.close();
  });

  it('protected route returns 401 envelope without a token', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({ method: 'GET', url: '/prot' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'AUTHN_REQUIRED' } });
    await app.close();
  });

  it('protected route returns 401 for an invalid token', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({
      method: 'GET',
      url: '/prot',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('protected route passes with a valid token and exposes auth context', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({
      method: 'GET',
      url: '/prot',
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: 'u-1' });
    await app.close();
  });

  it('echoes inbound X-Correlation-Id', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({
      method: 'GET',
      url: '/pub',
      headers: { 'x-correlation-id': 'corr-xyz' },
    });
    expect(res.headers['x-correlation-id']).toBe('corr-xyz');
    await app.close();
  });

  it('maps a thrown AppError to a safe envelope (no meta leak)', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body).toMatchObject({ error: { code: 'AUTHZ_DENIED', message: 'nope' } });
    expect(body.error.correlationId).toBeDefined();
    expect(res.payload).not.toContain('do-not-leak');
    await app.close();
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const app = await buildTestApp(kp);
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });

  it('redacts Authorization in logs (serialized req.headers.authorization path)', async () => {
    const logs: string[] = [];
    const app = await buildTestApp(kp, logs);
    const secret = await token();
    await app.inject({
      method: 'GET',
      url: '/dump',
      headers: { authorization: `Bearer ${secret}` },
    });
    const out = logs.join('');
    expect(out).toContain('[Redacted]');
    expect(out).not.toContain(secret);
    await app.close();
  });
});
