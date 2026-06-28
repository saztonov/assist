/**
 * Keycloak access-token verification via `jose`. Framework-free (no Fastify).
 * Verifies signature (JWKS) + iss + alg + exp/nbf, then validates aud/azp with
 * Keycloak-aware semantics. NODE-ONLY.
 */
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  errors as joseErrors,
  type JWTVerifyGetKey,
} from 'jose';
import { AuthnError, UpstreamError } from '@su10/errors';
import { extractSubject } from './claims.js';
import type { AuthContext, KeycloakClaims, OidcConfig, OidcVerifier } from './types.js';

function buildKeySet(cfg: OidcConfig): JWTVerifyGetKey {
  if (cfg.jwks) return createLocalJWKSet(cfg.jwks);
  if (cfg.jwksUri) {
    return createRemoteJWKSet(new URL(cfg.jwksUri), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }
  throw new Error('OidcConfig requires either `jwks` (local) or `jwksUri` (remote)');
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' ? [v] : [];
}

/**
 * Keycloak access tokens frequently carry `aud: "account"` with the client in
 * `azp`. Accept when the configured audience is present in `aud` OR `azp`
 * equals the configured client id.
 */
function assertAudience(claims: KeycloakClaims, cfg: OidcConfig): void {
  const aud = toStringArray(claims.aud);
  const azp = typeof claims.azp === 'string' ? claims.azp : undefined;
  const audOk = cfg.audience ? aud.includes(cfg.audience) : true;
  const azpOk = cfg.clientId ? azp === cfg.clientId : false;
  if (!(audOk || azpOk)) {
    throw new AuthnError('token audience not accepted', { aud, azp });
  }
}

function mapJoseError(err: unknown): Error {
  if (err instanceof joseErrors.JWKSTimeout) {
    return new UpstreamError('identity provider JWKS timeout');
  }
  if (err instanceof joseErrors.JOSEError) {
    // Expired / bad signature / unknown key / claim mismatch → client auth error.
    return new AuthnError('invalid token', { joseCode: err.code });
  }
  // e.g. network failure fetching a remote JWKS.
  return new UpstreamError('token verification failed');
}

export function createOidc(cfg: OidcConfig): OidcVerifier {
  const keySet = buildKeySet(cfg);
  const algorithms = cfg.allowedAlgorithms ?? ['RS256'];
  const clockTolerance = cfg.clockToleranceSec ?? 5;
  const resourceClient = cfg.resourceClient ?? cfg.clientId ?? cfg.audience;

  return {
    async verify(token: string): Promise<AuthContext> {
      let claims: KeycloakClaims;
      try {
        const { payload } = await jwtVerify(token, keySet, {
          issuer: cfg.issuer,
          algorithms,
          clockTolerance,
        });
        claims = payload as KeycloakClaims;
      } catch (err) {
        throw mapJoseError(err);
      }
      assertAudience(claims, cfg);
      return extractSubject(claims, { resourceClient });
    },
  };
}
