/**
 * Service-scoped config for agent-api. COMPOSES the shared server config
 * (`@su10/config.loadServerConfig`) and adds agent-api-specific env (OIDC, HTTP
 * surface, OpenAPI, readiness toggles). NODE-ONLY.
 *
 * Local-first: construction performs NO network I/O. For local manual testing
 * without Keycloak, set OIDC_DEV_JWKS to an inline JWKS (paired with a token
 * from `mint-dev-token`); it is rejected in production.
 */
import { z } from 'zod';
import { loadServerConfig, type ServerConfig } from '@su10/config';

const boolish = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const agentApiEnvSchema = z
  .object({
    API_PREFIX: z.string().startsWith('/').default('/api/v1'),
    TRUST_PROXY: boolish.default('false'),
    BODY_LIMIT: z.coerce.number().int().positive().default(1_048_576),
    CORS_ALLOWED_ORIGINS: z.string().default(''),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
    ALLOWED_SOURCE_PORTALS: z.string().default(''),
    OPENAPI_ENABLED: boolish.default('true'),
    OPENAPI_UI_ENABLED: boolish.default('false'),

    OIDC_ISSUER: z.string().url(),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_RESOURCE_CLIENT: z.string().min(1).optional(),
    OIDC_JWKS_URI: z.string().url().optional(),
    /** Inline JWKS JSON for local-first auth (NEVER production). */
    OIDC_DEV_JWKS: z.string().min(1).optional(),
    OIDC_CLOCK_TOLERANCE_S: z.coerce.number().int().nonnegative().default(5),

    LLM_READYCHECK_ENABLED: boolish.default('false'),
    DB_READYCHECK_ENABLED: boolish.default('false'),

    // Реальный Temporal-клиент подключается на шаге 6. Пока default false → stub;
    // ветка enabled в server.ts бросает NotImplementedError (no live infra).
    TEMPORAL_ENABLED: boolish.default('false'),
  })
  .refine((e) => Boolean(e.OIDC_JWKS_URI) || Boolean(e.OIDC_DEV_JWKS), {
    message: 'either OIDC_JWKS_URI (prod) or OIDC_DEV_JWKS (local) is required',
    path: ['OIDC_JWKS_URI'],
  });

export type AgentApiEnv = z.infer<typeof agentApiEnvSchema>;

export interface AgentApiConfig {
  server: ServerConfig;
  apiPrefix: string;
  trustProxy: boolean;
  bodyLimit: number;
  corsOrigins: string[];
  rateLimit: { max: number; timeWindow: string };
  allowedSourcePortals: string[];
  openapi: { enabled: boolean; uiEnabled: boolean };
  oidc: {
    issuer: string;
    audience: string;
    clientId: string;
    resourceClient: string;
    jwksUri?: string;
    devJwks?: string;
    clockToleranceSec: number;
  };
  readiness: { llmEnabled: boolean; dbEnabled: boolean };
  temporal: { enabled: boolean };
}

/** Pure mapping env → config. Throws on cross-field policy violations. */
export function buildAgentApiConfig(server: ServerConfig, env: AgentApiEnv): AgentApiConfig {
  if (server.NODE_ENV === 'production' && env.OIDC_DEV_JWKS) {
    throw new Error('OIDC_DEV_JWKS must not be set in production');
  }
  return {
    server,
    apiPrefix: env.API_PREFIX,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT,
    corsOrigins: csv(env.CORS_ALLOWED_ORIGINS),
    rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW },
    allowedSourcePortals: csv(env.ALLOWED_SOURCE_PORTALS),
    openapi: { enabled: env.OPENAPI_ENABLED, uiEnabled: env.OPENAPI_UI_ENABLED },
    oidc: {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
      clientId: env.OIDC_CLIENT_ID,
      resourceClient: env.OIDC_RESOURCE_CLIENT ?? env.OIDC_CLIENT_ID,
      jwksUri: env.OIDC_JWKS_URI,
      devJwks: env.OIDC_DEV_JWKS,
      clockToleranceSec: env.OIDC_CLOCK_TOLERANCE_S,
    },
    readiness: { llmEnabled: env.LLM_READYCHECK_ENABLED, dbEnabled: env.DB_READYCHECK_ENABLED },
    temporal: { enabled: env.TEMPORAL_ENABLED },
  };
}

/** Load + validate. On agent-api env failure prints only PATHS and exits. */
export function loadAgentApiConfig(env: NodeJS.ProcessEnv = process.env): AgentApiConfig {
  const server = loadServerConfig(env);
  const parsed = agentApiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`[config] invalid agent-api environment, refusing to start:\n${issues}`);
    process.exit(1);
  }
  return buildAgentApiConfig(server, parsed.data);
}
