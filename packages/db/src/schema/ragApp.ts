/**
 * App-уровень RAG: реестр логических индексов и журнал запросов.
 * Канонические поисковые чанки/эмбеддинги — в изолированной схеме `rag`
 * (`rag.corpus_chunks`, `rag.corpus_embeddings_*`), не здесь.
 *
 * `rag_queries` хранит метаданные запроса и ACL-решение, но НЕ сырое тело
 * запроса/ПДн (опционально `query_hash`). `acl_scope` и `permission_decision`
 * обязательны (фиксируют ACL-before-retrieval).
 */
import { pgTable, uuid, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt } from './_columns.js';

export const ragIndexes = pgTable('rag_indexes', {
  id: uuidPk(),
  key: text('key').notNull(),
  name: text('name'),
  status: text('status').notNull().default('inactive'),
  embeddingProvider: text('embedding_provider').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embeddingDim: integer('embedding_dim').notNull(),
  backend: text('backend').notNull().default('pgvector'),
  configurationJson: jsonb('configuration_json'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ragQueries = pgTable('rag_queries', {
  id: uuidPk(),
  ragIndexId: uuid('rag_index_id'),
  subjectId: text('subject_id').notNull(),
  // ACL-scope, применённый ДО retrieval (обязателен).
  aclScope: jsonb('acl_scope').notNull(),
  // allowed | denied — решение доступа (обязательно).
  permissionDecision: text('permission_decision').notNull(),
  queryHash: text('query_hash'),
  resultCount: integer('result_count'),
  durationMs: integer('duration_ms'),
  profile: text('profile'),
  createdAt: createdAt(),
});
