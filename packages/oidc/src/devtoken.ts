/**
 * Local/test helpers: generate an RS256 keypair + sign Keycloak-shaped access
 * tokens, so protected routes can be exercised WITHOUT a live Keycloak.
 * Used by unit tests and the `mint-dev-token` dev script. NODE-ONLY.
 */
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  type KeyLike,
} from 'jose';

export interface DevKeypair {
  kid: string;
  privateKey: KeyLike;
  publicJwks: JSONWebKeySet;
}

export async function generateDevKeypair(kid = 'dev-key-1'): Promise<DevKeypair> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { kid, privateKey, publicJwks: { keys: [jwk] } };
}

export interface DevTokenClaims {
  sub: string;
  issuer: string;
  audience?: string | string[];
  azp?: string;
  email?: string;
  preferredUsername?: string;
  realmRoles?: string[];
  /** keyed by `resource_access` client id. */
  clientRoles?: Record<string, string[]>;
  groups?: string[];
  /** jose timespan ('5m') or absolute epoch seconds. Default '5m'. */
  expiresIn?: string | number;
  extra?: Record<string, unknown>;
}

export async function signDevToken(kp: DevKeypair, claims: DevTokenClaims): Promise<string> {
  const payload: JWTPayload & Record<string, unknown> = {
    realm_access: { roles: claims.realmRoles ?? [] },
    resource_access: claims.clientRoles
      ? Object.fromEntries(
          Object.entries(claims.clientRoles).map(([client, roles]) => [client, { roles }]),
        )
      : {},
    ...(claims.email ? { email: claims.email, email_verified: true } : {}),
    ...(claims.preferredUsername ? { preferred_username: claims.preferredUsername } : {}),
    ...(claims.azp ? { azp: claims.azp } : {}),
    ...(claims.groups ? { groups: claims.groups } : {}),
    ...(claims.extra ?? {}),
  };

  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: kp.kid })
    .setIssuedAt()
    .setIssuer(claims.issuer)
    .setSubject(claims.sub)
    .setExpirationTime(claims.expiresIn ?? '5m');
  if (claims.audience !== undefined) jwt.setAudience(claims.audience);
  return jwt.sign(kp.privateKey);
}
