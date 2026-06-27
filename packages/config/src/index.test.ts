import { describe, it, expect } from 'vitest';
import { serverEnvSchema } from './index.js';
import { getPublicConfig } from './public.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/agent_platform_db',
  LLM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
  LLM_STUDIO_API_TOKEN: 'token',
};

describe('config', () => {
  it('parses a valid server env', () => {
    expect(serverEnvSchema.safeParse(base).success).toBe(true);
  });

  it('rejects missing required vars', () => {
    expect(serverEnvSchema.safeParse({}).success).toBe(false);
  });

  it('rejects RAG_ACL_ENFORCE=false', () => {
    expect(serverEnvSchema.safeParse({ ...base, RAG_ACL_ENFORCE: 'false' }).success).toBe(false);
  });

  it('public config defaults the API base to /api', () => {
    expect(getPublicConfig({}).VITE_API_BASE_URL).toBe('/api');
  });
});
