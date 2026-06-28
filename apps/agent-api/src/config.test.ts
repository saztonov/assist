import { describe, it, expect } from 'vitest';
import { agentApiEnvSchema, buildAgentApiConfig, loadAgentApiConfig } from './config.js';
import type { ServerConfig } from '@su10/config';

const baseServer: ServerConfig = {
  NODE_ENV: 'development',
  HTTP_HOST: '0.0.0.0',
  HTTP_PORT: 8080,
  DATABASE_URL: 'postgres://placeholder/db',
  DATABASE_POOL_MAX: 10,
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'default',
  TEMPORAL_TASK_QUEUE: 'ai-portal',
  LLM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
  LLM_STUDIO_API_TOKEN: 'placeholder',
  RAG_ACL_ENFORCE: true,
  LOG_LEVEL: 'info',
};

const validEnv = {
  OIDC_ISSUER: 'https://auth.su10.ru/realms/portal',
  OIDC_AUDIENCE: 'agent-api',
  OIDC_CLIENT_ID: 'agent-api',
  OIDC_DEV_JWKS: '{"keys":[]}',
};

describe('agentApiEnvSchema', () => {
  it('applies defaults for a minimal valid env', () => {
    const parsed = agentApiEnvSchema.parse(validEnv);
    expect(parsed.API_PREFIX).toBe('/api/v1');
    expect(parsed.OPENAPI_ENABLED).toBe(true);
    expect(parsed.OPENAPI_UI_ENABLED).toBe(false);
    expect(parsed.LLM_READYCHECK_ENABLED).toBe(false);
    expect(parsed.DB_READYCHECK_ENABLED).toBe(false);
  });

  it('rejects an invalid OIDC_ISSUER url', () => {
    const r = agentApiEnvSchema.safeParse({ ...validEnv, OIDC_ISSUER: 'not-a-url' });
    expect(r.success).toBe(false);
  });

  it('requires either OIDC_JWKS_URI or OIDC_DEV_JWKS', () => {
    const { OIDC_DEV_JWKS: _omit, ...rest } = validEnv;
    expect(agentApiEnvSchema.safeParse(rest).success).toBe(false);
  });
});

describe('buildAgentApiConfig', () => {
  it('defaults resourceClient to clientId and maps CSV fields', () => {
    const env = agentApiEnvSchema.parse({
      ...validEnv,
      CORS_ALLOWED_ORIGINS: 'https://a.ru, https://b.ru',
      ALLOWED_SOURCE_PORTALS: 'portal-a,portal-b',
    });
    const cfg = buildAgentApiConfig(baseServer, env);
    expect(cfg.oidc.resourceClient).toBe('agent-api');
    expect(cfg.corsOrigins).toEqual(['https://a.ru', 'https://b.ru']);
    expect(cfg.allowedSourcePortals).toEqual(['portal-a', 'portal-b']);
  });

  it('refuses OIDC_DEV_JWKS in production', () => {
    const env = agentApiEnvSchema.parse(validEnv);
    expect(() => buildAgentApiConfig({ ...baseServer, NODE_ENV: 'production' }, env)).toThrow();
  });
});

describe('loadAgentApiConfig', () => {
  it('loads a full local env without DB/LLM connection', () => {
    const cfg = loadAgentApiConfig({
      DATABASE_URL: 'postgres://placeholder/db',
      LLM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
      LLM_STUDIO_API_TOKEN: 'placeholder',
      ...validEnv,
    } as NodeJS.ProcessEnv);
    expect(cfg.apiPrefix).toBe('/api/v1');
    expect(cfg.oidc.issuer).toBe('https://auth.su10.ru/realms/portal');
    expect(cfg.readiness.llmEnabled).toBe(false);
    expect(cfg.readiness.dbEnabled).toBe(false);
  });
});
