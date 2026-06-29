/**
 * Browser-safe public configuration (`@su10/config/public`). Contains NO secrets
 * and touches no node APIs. The web app passes `import.meta.env` as the source.
 */
import { z } from 'zod';

export const publicEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().default('/api'),
  VITE_OIDC_ISSUER_URL: z.string().optional(),
  VITE_OIDC_CLIENT_ID: z.string().optional(),
  /** Redirect URI зарегистрированного в Keycloak public-клиента (по умолчанию origin). */
  VITE_OIDC_REDIRECT_URI: z.string().optional(),
  /** OIDC scope; по умолчанию `openid profile email`. */
  VITE_OIDC_SCOPE: z.string().default('openid profile email'),
});

export type PublicConfig = z.infer<typeof publicEnvSchema>;

export type PublicEnvSource = Record<string, string | boolean | undefined>;

export function getPublicConfig(source: PublicEnvSource): PublicConfig {
  return publicEnvSchema.parse(source);
}
