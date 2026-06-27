/** OIDC/SSO verification (Keycloak + AD). NODE-ONLY. Scaffold stub. */

export interface OidcSubject {
  id: string;
  email?: string;
  roles: string[];
}

export interface OidcConfig {
  issuerUrl: string;
  audience: string;
}

export interface OidcVerifier {
  verify(token: string): Promise<OidcSubject>;
}

/**
 * Scaffold stub. Real verification (JWKS discovery, signature, iss/aud/exp) is
 * wired later via `openid-client`. No network I/O here.
 */
export function createOidc(_cfg: OidcConfig): OidcVerifier {
  return {
    async verify(_token: string): Promise<OidcSubject> {
      throw new Error('OIDC verification not implemented in scaffold');
    },
  };
}
