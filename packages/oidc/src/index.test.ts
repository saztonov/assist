import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';
import {
  createOidc,
  extractSubject,
  generateDevKeypair,
  signDevToken,
  type DevKeypair,
  type KeycloakClaims,
  type OidcConfig,
} from './index.js';

const ISSUER = 'https://auth.su10.ru/realms/portal';
const AUD = 'agent-api';

describe('createOidc().verify', () => {
  let kp: DevKeypair;
  beforeAll(async () => {
    kp = await generateDevKeypair();
  });

  const oidc = (over: Partial<OidcConfig> = {}) =>
    createOidc({
      issuer: ISSUER,
      audience: AUD,
      clientId: AUD,
      resourceClient: AUD,
      jwks: kp.publicJwks,
      ...over,
    });

  it('accepts a valid RS256 token and extracts subject/roles/groups', async () => {
    const token = await signDevToken(kp, {
      sub: 'u-1',
      issuer: ISSUER,
      audience: 'account',
      azp: AUD,
      email: 'a@su10.ru',
      preferredUsername: 'alice',
      realmRoles: ['portal_user'],
      clientRoles: { [AUD]: ['tasks.read'] },
      groups: ['/dept/it'],
    });
    const ctx = await oidc().verify(token);
    expect(ctx.sub).toBe('u-1');
    expect(ctx.email).toBe('a@su10.ru');
    expect(ctx.username).toBe('alice');
    expect(ctx.roles).toEqual(expect.arrayContaining(['portal_user', 'tasks.read']));
    expect(ctx.groups).toEqual(['/dept/it']);
    expect(ctx.azp).toBe(AUD);
  });

  it('accepts aud:"account" when azp matches the client id (Keycloak default)', async () => {
    const token = await signDevToken(kp, { sub: 'u', issuer: ISSUER, audience: 'account', azp: AUD });
    await expect(oidc().verify(token)).resolves.toMatchObject({ sub: 'u' });
  });

  it('rejects when neither aud nor azp match', async () => {
    const token = await signDevToken(kp, {
      sub: 'u',
      issuer: ISSUER,
      audience: 'account',
      azp: 'other-client',
    });
    await expect(oidc().verify(token)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('rejects a wrong issuer', async () => {
    const token = await signDevToken(kp, {
      sub: 'u',
      issuer: 'https://evil.example/realms/x',
      audience: AUD,
    });
    await expect(oidc().verify(token)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signDevToken(kp, {
      sub: 'u',
      issuer: ISSUER,
      audience: AUD,
      expiresIn: past,
    });
    await expect(oidc().verify(token)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('rejects a token signed by an unknown key', async () => {
    const other = await generateDevKeypair('other-key');
    const token = await signDevToken(other, { sub: 'u', issuer: ISSUER, audience: AUD });
    await expect(oidc().verify(token)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('rejects a non-RS256 (HS256) token — algorithm confusion guard', async () => {
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setSubject('u')
      .setAudience(AUD)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('shared-secret'));
    await expect(oidc().verify(hs)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('tolerates a missing groups claim (-> [])', async () => {
    const token = await signDevToken(kp, { sub: 'u', issuer: ISSUER, audience: AUD });
    const ctx = await oidc().verify(token);
    expect(ctx.groups).toEqual([]);
  });
});

describe('extractSubject', () => {
  it('merges realm and client roles and dedupes', () => {
    const claims: KeycloakClaims = {
      sub: 's',
      realm_access: { roles: ['a', 'b'] },
      resource_access: { [AUD]: { roles: ['b', 'c'] } },
    };
    const ctx = extractSubject(claims, { resourceClient: AUD });
    expect([...ctx.roles].sort()).toEqual(['a', 'b', 'c']);
    expect(ctx.realmRoles).toEqual(['a', 'b']);
    expect(ctx.clientRoles).toEqual(['b', 'c']);
  });

  it('throws when sub is absent', () => {
    expect(() => extractSubject({} as KeycloakClaims)).toThrow();
  });
});
