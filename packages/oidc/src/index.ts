/**
 * OIDC/JWT verification for Keycloak (resource server). NODE-ONLY.
 * `createOidc(config).verify(token)` validates a Keycloak access token and
 * returns a backend AuthContext. No browser export.
 */
export type {
  AuthContext,
  KeycloakClaims,
  OidcConfig,
  OidcVerifier,
} from './types.js';
export { extractSubject, type ExtractOptions } from './claims.js';
export { createOidc } from './verify.js';
export {
  generateDevKeypair,
  signDevToken,
  type DevKeypair,
  type DevTokenClaims,
} from './devtoken.js';
