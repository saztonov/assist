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

  it('applies LM Studio default model ids and concurrency caps', () => {
    const parsed = serverEnvSchema.parse(base);
    expect(parsed.CHANDRA_MODEL).toBe('chandra-ocr-2');
    expect(parsed.LIFT_MODEL).toBe('lift');
    expect(parsed.QWEN_MODEL).toBe('qwen36-27b-mtp');
    expect(parsed.LLM_MAX_PARALLEL_CHANDRA).toBe(4);
    expect(parsed.LLM_MAX_PARALLEL_LIFT).toBe(4);
    expect(parsed.LLM_MAX_PARALLEL_QWEN).toBe(1);
    expect(parsed.EMBEDDING_PROVIDER).toBe('mock');
    expect(parsed.EMBEDDING_DIM).toBe(768);
  });

  it('maps LMSTUDIO_*/LM_STUDIO_* aliases to canonical names', () => {
    const fromAlias = serverEnvSchema.safeParse({
      DATABASE_URL: base.DATABASE_URL,
      LMSTUDIO_BASE_URL: 'http://alias:1234/v1',
      LM_STUDIO_API_TOKEN: 'aliased-token',
    });
    expect(fromAlias.success).toBe(true);
    if (fromAlias.success) {
      expect(fromAlias.data.LLM_STUDIO_BASE_URL).toBe('http://alias:1234/v1');
      expect(fromAlias.data.LLM_STUDIO_API_TOKEN).toBe('aliased-token');
    }
  });

  it('rejects mock embedding provider in production', () => {
    expect(
      serverEnvSchema.safeParse({ ...base, NODE_ENV: 'production', EMBEDDING_PROVIDER: 'mock' })
        .success,
    ).toBe(false);
    expect(
      serverEnvSchema.safeParse({
        ...base,
        NODE_ENV: 'production',
        EMBEDDING_PROVIDER: 'lmstudio-embed',
      }).success,
    ).toBe(true);
  });

  it('requires S3 settings only when DOCUMENTS_ENABLED', () => {
    expect(serverEnvSchema.safeParse({ ...base, DOCUMENTS_ENABLED: 'true' }).success).toBe(false);
    expect(
      serverEnvSchema.safeParse({
        ...base,
        DOCUMENTS_ENABLED: 'true',
        S3_ENDPOINT: 'https://s3.example.ru',
        S3_REGION: 'ru-central1',
        S3_BUCKET: 'files',
        S3_ACCESS_KEY_ID: 'ak',
        S3_SECRET_ACCESS_KEY: 'sk',
      }).success,
    ).toBe(true);
  });

  it('rejects EMBEDDING_DIM other than 768/1536', () => {
    expect(serverEnvSchema.safeParse({ ...base, EMBEDDING_DIM: '1024' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, EMBEDDING_DIM: '1536' }).success).toBe(true);
  });

  it('public config defaults the API base to /api', () => {
    expect(getPublicConfig({}).VITE_API_BASE_URL).toBe('/api');
  });
});
