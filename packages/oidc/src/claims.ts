/** Keycloak claims → AuthContext mapping. Pure, framework-free, no network. */
import { AuthnError } from '@su10/errors';
import type { AuthContext, KeycloakClaims } from './types.js';

export interface ExtractOptions {
  /** `resource_access` key holding the authoritative client roles. */
  resourceClient?: string;
}

/**
 * Map a verified Keycloak access token to the backend authorization context.
 * Tolerant of a missing `groups` claim (→ []), which requires a Keycloak
 * Group Membership mapper to be present at all.
 */
export function extractSubject(claims: KeycloakClaims, opts: ExtractOptions = {}): AuthContext {
  const sub = claims.sub;
  if (!sub) throw new AuthnError('token has no subject');

  const realmRoles = claims.realm_access?.roles ?? [];
  const clientRoles = opts.resourceClient
    ? (claims.resource_access?.[opts.resourceClient]?.roles ?? [])
    : [];
  const roles = [...new Set([...realmRoles, ...clientRoles])];
  const groups = Array.isArray(claims.groups) ? claims.groups : [];

  return {
    sub,
    email: claims.email,
    emailVerified: claims.email_verified,
    username: claims.preferred_username,
    roles,
    realmRoles,
    clientRoles,
    groups,
    azp: typeof claims.azp === 'string' ? claims.azp : undefined,
    raw: claims,
  };
}
