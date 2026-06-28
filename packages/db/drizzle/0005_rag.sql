-- 0005_rag.sql — изолированная RAG-схема (pgvector + FTS).
--
-- PREREQUISITES (отдельный admin/operator step, ДО применения этого файла —
-- runtime/migration-роль НЕ создаёт расширения на Yandex Managed PostgreSQL):
--   CREATE EXTENSION IF NOT EXISTS vector;    -- тип vector(N), оператор <=>
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- gin_trgm_ops
--
-- Канон RAG-схемы — этот SQL (не Drizzle). Точный векторный поиск работает БЕЗ
-- HNSW; HNSW создаётся отдельно в 0006_rag_hnsw.no-tx.sql.
--
-- Forward: CREATE SCHEMA rag; corpus_chunks, corpus_embeddings_768/_1536,
--   index_runs, eval_feedback + индексы.
-- Rollback: DROP SCHEMA rag CASCADE;

CREATE SCHEMA rag;

-- Канонические поисковые чанки (источник retrieval). content_original — для
-- отображения; content_embedding — обогащённый текст, подаваемый в эмбеддер.
CREATE TABLE rag.corpus_chunks (
  chunk_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  document_version_id uuid REFERENCES public.document_versions (id) ON DELETE CASCADE,
  source_object_type  text,
  source_object_id    text,
  project_id          text,
  department_id       text,
  owner_user_id       text,
  document_type       text,
  security_level      text,
  title               text,
  page_from           integer,
  page_to             integer,
  chunk_index         integer NOT NULL,
  token_count         integer NOT NULL,
  char_start          integer,
  char_end            integer,
  content_original    text NOT NULL,
  content_embedding   text NOT NULL,
  source_text_hash    text NOT NULL,
  chunk_hash          text NOT NULL,
  chunker_version     text NOT NULL,
  metadata_json       jsonb,
  search_vector       tsvector GENERATED ALWAYS AS
                        (to_tsvector('russian', coalesce(content_original, ''))) STORED,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Идемпотентность переиндексации.
  UNIQUE (document_version_id, source_text_hash, chunker_version, chunk_index)
);
CREATE INDEX ix_rag_chunks_document_id   ON rag.corpus_chunks (document_id);
CREATE INDEX ix_rag_chunks_version_id    ON rag.corpus_chunks (document_version_id);
CREATE INDEX ix_rag_chunks_project_id    ON rag.corpus_chunks (project_id);
CREATE INDEX ix_rag_chunks_department_id ON rag.corpus_chunks (department_id);
CREATE INDEX ix_rag_chunks_security      ON rag.corpus_chunks (security_level);
CREATE INDEX ix_rag_chunks_source_hash   ON rag.corpus_chunks (source_text_hash);
-- FTS (GIN по generated tsvector).
CREATE INDEX ix_rag_chunks_fts ON rag.corpus_chunks USING gin (search_vector);
-- Триграммный поиск по заголовку (требует pg_trgm).
CREATE INDEX ix_rag_chunks_title_trgm ON rag.corpus_chunks USING gin (title gin_trgm_ops);

-- Эмбеддинги размерности 768 (Yandex Embeddings).
CREATE TABLE rag.corpus_embeddings_768 (
  chunk_id      uuid NOT NULL REFERENCES rag.corpus_chunks (chunk_id) ON DELETE CASCADE,
  provider      text NOT NULL,
  model         text NOT NULL,
  embedding     vector(768) NOT NULL,
  model_version text,
  embedding_dim integer NOT NULL DEFAULT 768 CHECK (embedding_dim = 768),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, provider, model)
);

-- Эмбеддинги размерности 1536 (прочие эмбеддеры).
CREATE TABLE rag.corpus_embeddings_1536 (
  chunk_id      uuid NOT NULL REFERENCES rag.corpus_chunks (chunk_id) ON DELETE CASCADE,
  provider      text NOT NULL,
  model         text NOT NULL,
  embedding     vector(1536) NOT NULL,
  model_version text,
  embedding_dim integer NOT NULL DEFAULT 1536 CHECK (embedding_dim = 1536),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, provider, model)
);

-- Телеметрия прогонов индексации.
CREATE TABLE rag.index_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backend            text NOT NULL,
  status             text NOT NULL,
  source_count       integer DEFAULT 0,
  chunk_count        integer DEFAULT 0,
  token_count        bigint DEFAULT 0,
  success_count      integer DEFAULT 0,
  error_count        integer DEFAULT 0,
  embedding_provider text,
  embedding_model    text,
  embedding_dim      integer,
  configuration_json jsonb,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  error_text         text
);
CREATE INDEX ix_rag_index_runs_status ON rag.index_runs (status);

-- Оценочная обратная связь (gold set) — без сырого тела документа.
CREATE TABLE rag.eval_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query       text NOT NULL,
  profile     text NOT NULL,
  document_id uuid,
  chunk_id    uuid,
  verdict     text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
