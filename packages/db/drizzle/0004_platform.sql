-- 0004_platform.sql — аудит, транзакционный outbox, PostgreSQL-очередь задач,
-- app-уровень RAG (реестр индексов + журнал запросов).
--
-- БЕЗОПАСНОСТЬ: audit_events и rag_queries не содержат сырых секретов/ПДн/токенов.
-- rag_queries хранит acl_scope (обязателен) и permission_decision (обязателен),
-- но НЕ сырое тело запроса (опционально query_hash).
--
-- Forward: audit_events, outbox_events, postgres_jobs, rag_indexes, rag_queries.
-- Rollback: DROP в обратном порядке.

CREATE TABLE audit_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor          text NOT NULL,
  action         text NOT NULL,
  resource       text,
  outcome        text NOT NULL,  -- allowed | denied | success | failure
  correlation_id text,
  source_portal  text,
  meta_json      jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_events_actor  ON audit_events (actor);
CREATE INDEX ix_audit_events_action ON audit_events (action);
CREATE INDEX ix_audit_events_at     ON audit_events (at);

CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type  text,
  aggregate_id    text,
  event_type      text NOT NULL,
  dedupe_key      text NOT NULL,   -- идемпотентность доставки
  payload_json    jsonb,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 10,
  next_run_at     timestamptz,
  locked_until    timestamptz,
  dead            boolean NOT NULL DEFAULT false,
  last_error_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);
CREATE INDEX ix_outbox_events_status      ON outbox_events (status);
CREATE INDEX ix_outbox_events_next_run_at ON outbox_events (next_run_at);

CREATE TABLE postgres_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text NOT NULL,
  queue           text NOT NULL DEFAULT 'default',
  payload_json    jsonb,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 5,
  run_after       timestamptz,
  locked_until    timestamptz,
  locked_by       text,
  dead            boolean NOT NULL DEFAULT false,
  last_error_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_postgres_jobs_status    ON postgres_jobs (status);
CREATE INDEX ix_postgres_jobs_queue     ON postgres_jobs (queue);
CREATE INDEX ix_postgres_jobs_run_after ON postgres_jobs (run_after);

-- App-уровень RAG: реестр логических индексов (какой embedding-провайдер/модель/dim).
CREATE TABLE rag_indexes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL,
  name               text,
  status             text NOT NULL DEFAULT 'inactive',
  embedding_provider text NOT NULL,
  embedding_model    text NOT NULL,
  embedding_dim      integer NOT NULL,
  backend            text NOT NULL DEFAULT 'pgvector',
  configuration_json jsonb,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_rag_indexes_key ON rag_indexes (key);
CREATE INDEX ix_rag_indexes_status     ON rag_indexes (status);

-- Журнал RAG-запросов: метаданные + ACL-решение, БЕЗ сырого тела запроса.
CREATE TABLE rag_queries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rag_index_id        uuid REFERENCES rag_indexes (id) ON DELETE SET NULL,
  subject_id          text NOT NULL,
  acl_scope           jsonb NOT NULL,         -- ACL-scope, применённый ДО retrieval
  permission_decision text NOT NULL,          -- allowed | denied
  query_hash          text,
  result_count        integer,
  duration_ms         integer,
  profile             text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rag_queries_subject_id   ON rag_queries (subject_id);
CREATE INDEX ix_rag_queries_rag_index_id ON rag_queries (rag_index_id);
CREATE INDEX ix_rag_queries_created_at   ON rag_queries (created_at);
