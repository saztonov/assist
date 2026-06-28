-- 0001_documents.sql — документная метадата (источник истины метаданных и ACL).
-- Поисковые чанки/эмбеддинги хранятся отдельно в схеме rag (0005_rag.sql).
--
-- Forward: documents, document_versions, document_acl, document_parse_jobs.
-- Rollback: DROP TABLE document_parse_jobs, document_acl, document_versions, documents.

CREATE TABLE documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      text NOT NULL,
  department_id      text,
  project_id         text,
  document_type      text,
  security_level     text NOT NULL DEFAULT 'internal',
  title              text,
  source_object_type text,
  source_object_id   text,
  content_hash       text,
  status             text NOT NULL DEFAULT 'registered',
  created_by         text NOT NULL,
  metadata_json      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_documents_owner_user_id  ON documents (owner_user_id);
CREATE INDEX ix_documents_created_by     ON documents (created_by);
CREATE INDEX ix_documents_status         ON documents (status);
CREATE INDEX ix_documents_department_id  ON documents (department_id);
CREATE INDEX ix_documents_security_level ON documents (security_level);

CREATE TABLE document_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  version      integer NOT NULL,
  storage_key  text,            -- S3 object key (НЕ presigned URL)
  mime_type    text,
  size_bytes   bigint,
  content_hash text,
  page_count   integer,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX ix_document_versions_document_id ON document_versions (document_id);

CREATE TABLE document_acl (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  principal_type text NOT NULL,   -- user | role | department | group
  principal_id   text NOT NULL,
  permission     text NOT NULL DEFAULT 'read',  -- read | write | admin
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, principal_type, principal_id, permission)
);
CREATE INDEX ix_document_acl_document_id ON document_acl (document_id);
CREATE INDEX ix_document_acl_principal   ON document_acl (principal_type, principal_id);

CREATE TABLE document_parse_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  document_version_id uuid REFERENCES document_versions (id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'pending',
  parser              text,
  attempts            integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 5,
  error_code          text,
  started_at          timestamptz,
  completed_at        timestamptz,
  metadata_json       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_document_parse_jobs_document_id ON document_parse_jobs (document_id);
CREATE INDEX ix_document_parse_jobs_status      ON document_parse_jobs (status);
