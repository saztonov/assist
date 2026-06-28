import { describe, it, expect } from 'vitest';
import {
  PROVIDER_SEEDS,
  lmStudioProviderSeed,
  yandexEmbeddingProviderSeed,
  mockEmbeddingProviderSeed,
} from './seed.js';
import { resolveEmbeddingDim } from './providers.js';

describe('LM Studio seed: точные параметры моделей', () => {
  const byId = Object.fromEntries(lmStudioProviderSeed.models.map((m) => [m.modelId, m]));

  it('chandra-ocr-2: ctx 32768, parallel 4, vision', () => {
    expect(byId['chandra-ocr-2'].contextWindow).toBe(32768);
    expect(byId['chandra-ocr-2'].maxParallelRequests).toBe(4);
    expect(byId['chandra-ocr-2'].supportsVision).toBe(true);
  });

  it('lift: ctx 32768, parallel 4, json extraction', () => {
    expect(byId['lift'].contextWindow).toBe(32768);
    expect(byId['lift'].maxParallelRequests).toBe(4);
    expect(byId['lift'].supportsJsonExtraction).toBe(true);
  });

  it('qwen36-27b-mtp: ctx 131072, parallel 1', () => {
    expect(byId['qwen36-27b-mtp'].contextWindow).toBe(131072);
    expect(byId['qwen36-27b-mtp'].maxParallelRequests).toBe(1);
  });

  it('LM Studio модели НЕ являются embedding-провайдером', () => {
    for (const m of lmStudioProviderSeed.models) expect(m.supportsEmbeddings).toBe(false);
    expect(lmStudioProviderSeed.providerType).toBe('lmstudio');
  });
});

describe('Embedding-провайдеры отделены, размерность соответствует провайдеру', () => {
  it('yandex → 768, mock → 1536', () => {
    expect(yandexEmbeddingProviderSeed.providerType).toBe('embedding_provider');
    expect(yandexEmbeddingProviderSeed.models[0].embeddingDim).toBe(768);
    expect(mockEmbeddingProviderSeed.providerType).toBe('embedding_provider');
    expect(mockEmbeddingProviderSeed.models[0].embeddingDim).toBe(1536);
  });

  it('resolveEmbeddingDim согласован с seed', () => {
    expect(resolveEmbeddingDim(yandexEmbeddingProviderSeed.key)).toBe(
      yandexEmbeddingProviderSeed.models[0].embeddingDim,
    );
    expect(resolveEmbeddingDim(mockEmbeddingProviderSeed.key)).toBe(
      mockEmbeddingProviderSeed.models[0].embeddingDim,
    );
  });
});

describe('Seed без секретов', () => {
  it('нет URL/токенов в значениях — только secret-ref имена', () => {
    const s = JSON.stringify(PROVIDER_SEEDS);
    expect(s).not.toMatch(/https?:\/\//i);
    expect(s).not.toMatch(/Bearer/i);
    expect(s).toContain('LLM_STUDIO_BASE_URL');
    expect(s).toContain('LLM_STUDIO_API_TOKEN');
  });
});
