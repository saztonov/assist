import { describe, it, expect } from 'vitest';
import {
  toPublicProviderConfig,
  evaluateProviderPolicy,
  resolveEmbeddingDim,
} from './providers.js';

describe('toPublicProviderConfig: не возвращает сырые секреты', () => {
  it('отдаёт secret-ref имена, но не значения секретов', () => {
    const row = {
      id: 'p1',
      providerType: 'lmstudio',
      displayName: 'LM Studio',
      enabled: true,
      localOnly: true,
      cloudAllowed: false,
      auditLevel: 'standard',
      apiTokenSecretRef: 'LLM_STUDIO_API_TOKEN',
      baseUrlSecretRef: 'LLM_STUDIO_BASE_URL',
      // посторонние сырые секреты — НЕ должны утечь:
      apiToken: 'RAW-SECRET-TOKEN-123',
      password: 'RAW-PASSWORD-456',
      baseUrl: 'https://secret.internal/v1',
    };
    const pub = toPublicProviderConfig(row);

    expect(pub.apiTokenSecretRef).toBe('LLM_STUDIO_API_TOKEN');
    expect(pub.baseUrlSecretRef).toBe('LLM_STUDIO_BASE_URL');

    const leaked = pub as Record<string, unknown>;
    expect(leaked.apiToken).toBeUndefined();
    expect(leaked.password).toBeUndefined();
    expect(leaked.baseUrl).toBeUndefined();

    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain('RAW-SECRET-TOKEN-123');
    expect(serialized).not.toContain('RAW-PASSWORD-456');
    expect(serialized).not.toContain('https://secret.internal');
  });
});

describe('evaluateProviderPolicy: запрет cloud/SaaS для sensitive data', () => {
  it('cloud_llm + confidential → deny', () => {
    const d = evaluateProviderPolicy({
      providerType: 'cloud_llm',
      dataClass: 'confidential',
      cloudAllowed: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBeDefined();
  });

  it('saas_api + secret → deny', () => {
    expect(evaluateProviderPolicy({ providerType: 'saas_api', dataClass: 'secret' }).allowed).toBe(false);
  });

  it('не-локальный провайдер (localOnly:false) + confidential → deny', () => {
    expect(
      evaluateProviderPolicy({
        providerType: 'embedding_provider',
        dataClass: 'confidential',
        localOnly: false,
      }).allowed,
    ).toBe(false);
  });

  it('lmstudio локальный + confidential → allow', () => {
    expect(
      evaluateProviderPolicy({
        providerType: 'lmstudio',
        dataClass: 'confidential',
        localOnly: true,
        cloudAllowed: false,
      }).allowed,
    ).toBe(true);
  });

  it('lmstudio + public → allow', () => {
    expect(evaluateProviderPolicy({ providerType: 'lmstudio', dataClass: 'public' }).allowed).toBe(true);
  });
});

describe('resolveEmbeddingDim', () => {
  it('yandex → 768, прочие → 1536', () => {
    expect(resolveEmbeddingDim('yandex')).toBe(768);
    expect(resolveEmbeddingDim('yandex-embeddings')).toBe(768);
    expect(resolveEmbeddingDim('mock-embedding')).toBe(1536);
    expect(resolveEmbeddingDim('openai')).toBe(1536);
  });
});
