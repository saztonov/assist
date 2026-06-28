/**
 * ТОНКОЕ типизированное зеркало изолированной схемы `rag` для типобезопасного
 * чтения из app-кода. КАНОН — SQL-миграции `drizzle/0005_rag.sql` и
 * `drizzle/0006_rag_hnsw.no-tx.sql` (generated `tsvector`, `vector(N)`, HNSW,
 * trigram-индексы, CHECK-и и UNIQUE здесь НЕ воспроизводятся — они в SQL).
 *
 * Эти таблицы НЕ входят в реляционную карту public-схемы `schema` (см. index.ts);
 * экспортируются отдельно как `ragSchema`.
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  jsonb,
  vector,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { createdAt } from './_columns.js';

export const ragSchemaNs = pgSchema('rag');

/** Канонические поисковые чанки (источник retrieval). */
export const corpusChunks = ragSchemaNs.table('corpus_chunks', {
  chunkId: uuid('chunk_id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull(),
  documentVersionId: uuid('document_version_id'),
  sourceObjectType: text('source_object_type'),
  sourceObjectId: text('source_object_id'),
  projectId: text('project_id'),
  departmentId: text('department_id'),
  ownerUserId: text('owner_user_id'),
  documentType: text('document_type'),
  securityLevel: text('security_level'),
  title: text('title'),
  pageFrom: integer('page_from'),
  pageTo: integer('page_to'),
  chunkIndex: integer('chunk_index').notNull(),
  tokenCount: integer('token_count').notNull(),
  charStart: integer('char_start'),
  charEnd: integer('char_end'),
  contentOriginal: text('content_original').notNull(),
  contentEmbedding: text('content_embedding').notNull(),
  sourceTextHash: text('source_text_hash').notNull(),
  chunkHash: text('chunk_hash').notNull(),
  chunkerVersion: text('chunker_version').notNull(),
  metadataJson: jsonb('metadata_json'),
  // search_vector tsvector GENERATED ALWAYS — только в SQL (здесь опущен).
  createdAt: createdAt(),
});

/** Эмбеддинги размерности 768 (Yandex Embeddings). */
export const corpusEmbeddings768 = ragSchemaNs.table(
  'corpus_embeddings_768',
  {
    chunkId: uuid('chunk_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    modelVersion: text('model_version'),
    embeddingDim: integer('embedding_dim').notNull().default(768),
    createdAt: createdAt(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.chunkId, t.provider, t.model] }) }),
);

/** Эмбеддинги размерности 1536 (прочие эмбеддеры). */
export const corpusEmbeddings1536 = ragSchemaNs.table(
  'corpus_embeddings_1536',
  {
    chunkId: uuid('chunk_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    modelVersion: text('model_version'),
    embeddingDim: integer('embedding_dim').notNull().default(1536),
    createdAt: createdAt(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.chunkId, t.provider, t.model] }) }),
);

/** Телеметрия прогонов индексации. */
export const ragIndexRuns = ragSchemaNs.table('index_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  backend: text('backend').notNull(),
  status: text('status').notNull(),
  sourceCount: integer('source_count').default(0),
  chunkCount: integer('chunk_count').default(0),
  tokenCount: integer('token_count').default(0),
  successCount: integer('success_count').default(0),
  errorCount: integer('error_count').default(0),
  embeddingProvider: text('embedding_provider'),
  embeddingModel: text('embedding_model'),
  embeddingDim: integer('embedding_dim'),
  configurationJson: jsonb('configuration_json'),
  startedAt: createdAt(),
  errorText: text('error_text'),
});

/** Оценочная обратная связь (gold set). */
export const ragEvalFeedback = ragSchemaNs.table('eval_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  query: text('query').notNull(),
  profile: text('profile').notNull(),
  documentId: uuid('document_id'),
  chunkId: uuid('chunk_id'),
  verdict: text('verdict').notNull(),
  createdBy: text('created_by'),
  createdAt: createdAt(),
});

/** Изолированная схема `rag` (отдельно от public-карты `schema`). */
export const ragSchema = {
  corpusChunks,
  corpusEmbeddings768,
  corpusEmbeddings1536,
  ragIndexRuns,
  ragEvalFeedback,
};
