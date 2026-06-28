import { describe, it, expect } from 'vitest';
import {
  schema,
  documents,
  documentVersions,
  documentAcl,
  documentParseJobs,
  auditEvents,
  llmProviderRegistry,
  llmProviderModels,
  providerUsageEvents,
  llmCalls,
  ragQueries,
  corpusChunks,
  corpusEmbeddings768,
  corpusEmbeddings1536,
} from '../index.js';

describe('public app schema shape', () => {
  it('documents пересобрана: нет embedding/acl_tag, есть metadata-поля', () => {
    expect((documents as Record<string, unknown>).embedding).toBeUndefined();
    expect((documents as Record<string, unknown>).aclTag).toBeUndefined();
    expect(documents.ownerUserId).toBeDefined();
    expect(documents.securityLevel).toBeDefined();
    expect(documents.ownerUserId.name).toBe('owner_user_id');
  });

  it('документные дочерние таблицы существуют', () => {
    expect(documentVersions.documentId).toBeDefined();
    expect(documentAcl.principalType).toBeDefined();
    expect(documentParseJobs.maxAttempts).toBeDefined();
  });

  it('audit_log заменён на audit_events', () => {
    expect((schema as Record<string, unknown>).auditLog).toBeUndefined();
    expect(auditEvents.actor).toBeDefined();
    expect(auditEvents.outcome).toBeDefined();
    expect(auditEvents.at).toBeDefined();
  });

  it('провайдерские таблицы экспонируют ключевые поля', () => {
    expect(llmProviderRegistry.providerType).toBeDefined();
    expect(llmProviderRegistry.enabled).toBeDefined();
    expect(llmProviderModels.providerId).toBeDefined();
    expect(llmProviderModels.modelId).toBeDefined();
  });
});

describe('инвариант отсутствия утечек (telemetry без сырья)', () => {
  for (const [name, table] of [
    ['provider_usage_events', providerUsageEvents],
    ['llm_calls', llmCalls],
    ['rag_queries', ragQueries],
  ] as const) {
    it(`${name} не содержит колонок prompt/content/token`, () => {
      const t = table as Record<string, unknown>;
      expect(t.prompt).toBeUndefined();
      expect(t.content).toBeUndefined();
      expect(t.token).toBeUndefined();
      expect(t.promptText).toBeUndefined();
      expect(t.rawBody).toBeUndefined();
    });
  }

  it('rag_queries требует acl_scope и permission_decision (ACL-before-retrieval)', () => {
    expect(ragQueries.aclScope).toBeDefined();
    expect(ragQueries.aclScope.notNull).toBe(true);
    expect(ragQueries.permissionDecision).toBeDefined();
    expect(ragQueries.permissionDecision.notNull).toBe(true);
  });
});

describe('rag-зеркало изолировано и хранит две размерности', () => {
  it('corpus_chunks: content split present', () => {
    expect(corpusChunks.contentOriginal).toBeDefined();
    expect(corpusChunks.contentEmbedding).toBeDefined();
    expect(corpusChunks.sourceTextHash).toBeDefined();
    expect(corpusChunks.chunkerVersion).toBeDefined();
  });

  it('две таблицы эмбеддингов: 768 и 1536, с vector + embedding_dim', () => {
    expect(corpusEmbeddings768.embedding).toBeDefined();
    expect(corpusEmbeddings768.embeddingDim).toBeDefined();
    expect(corpusEmbeddings1536.embedding).toBeDefined();
    expect(corpusEmbeddings1536.embeddingDim).toBeDefined();
  });

  it('rag-таблицы НЕ входят в public-карту schema', () => {
    expect((schema as Record<string, unknown>).corpusChunks).toBeUndefined();
    expect((schema as Record<string, unknown>).corpusEmbeddings768).toBeUndefined();
  });
});
