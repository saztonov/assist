-- Initial schema (static artifact; applied by the deploy migration step, never
-- auto-run from app/worker containers). pgvector is enabled and the documents
-- embedding column uses vector(1536) in the real migration.

-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text NOT NULL DEFAULT 'pending',
  workflow_id text,
  template_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor   text NOT NULL,
  action  text NOT NULL,
  outcome text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     text NOT NULL,
  acl_tag      text NOT NULL,
  content_hash text NOT NULL,
  embedding    text -- vector(1536) in production with pgvector
);
