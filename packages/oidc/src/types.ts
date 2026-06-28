/** OIDC/JWT types for Keycloak resource-server validation. NODE-ONLY. */
import type { JSONWebKeySet, JWTPayload } from 'jose';

/** Keycloak access-token claim shape (subset we rely on). */
export interface KeycloakClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  /** Authorized party = the OIDC client id that obtained the token. */
  azp?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  /** Present only if a Keycloak "Group Membership" mapper is configured. */
  groups?: string[];
}

/** Backend authorization context derived from a verified access token. */
export interface AuthContext {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  username?: string;
  /** realm roles ∪ client roles, deduped. */
  roles: string[];
  realmRoles: string[];
  clientRoles: string[];
  groups: string[];
  /** Authorized party — authoritative signal for source-portal derivation. */
  azp?: string;
  raw: KeycloakClaims;
}

export interface OidcConfig {
  /** Expected `iss` (Keycloak frontend realm URL). */
  issuer: string;
  /** Expected audience; combined with azp per Keycloak semantics. */
  audience: string;
  /** Remote JWKS endpoint (internal URL ok). Required unless `jwks` is given. */
  jwksUri?: string;
  /** OIDC client id; accepted as `azp` fallback when `aud` is e.g. "account". */
  clientId?: string;
  /** `resource_access` key holding the authoritative client roles. */
  resourceClient?: string;
  /** Accepted signature algorithms. Default ['RS256'] — never `none`/HS*. */
  allowedAlgorithms?: string[];
  /** Clock skew tolerance in seconds. Default 5. */
  clockToleranceSec?: number;
  /**
   * Inject a static JWKS (tests / offline local-first) — uses `createLocalJWKSet`
   * and performs NO network I/O. Takes precedence over `jwksUri`.
   */
  jwks?: JSONWebKeySet;
}

export interface OidcVerifier {
  /** Verify signature + iss/aud/azp/alg/exp, then map claims → AuthContext. */
  verify(token: string): Promise<AuthContext>;
}
