-- 0000_init.sql — baseline app-core (этап 3, консолидированный baseline).
-- Применяется отдельным deploy-шагом (не из app/worker-контейнеров). Runtime-роль
-- не имеет DDL. gen_random_uuid() встроен в PostgreSQL 13+.
--
-- Forward: создаёт agent_tasks(+events/artifacts), chat(+messages),
--   workflow_templates(+versions/runs), approvals(+events), agent_runs(+steps).
-- Rollback: DROP TABLE в обратном порядке (agent_steps … agent_tasks).

-- ============================ Agent tasks ============================

CREATE TABLE agent_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Источник истины бизнес-статуса. Начальный статус — created; CHECK защищает
  -- 7 контрактных статусов на уровне БД (defense in depth к app-автомату).
  status              text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','queued','running','waiting_for_approval','completed','failed','cancelled')),
  title               text,
  task_type           text,
  workflow_id         text,            -- Temporal workflow id (часть источника истины статуса)
  template_id         uuid,
  template_version_id uuid,
  created_by          text NOT NULL,
  source_portal       text,
  department_id       text,
  project_id          text,
  input_json          jsonb,
  result_json         jsonb,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_agent_tasks_status      ON agent_tasks (status);
CREATE INDEX ix_agent_tasks_created_by  ON agent_tasks (created_by);
CREATE INDEX ix_agent_tasks_workflow_id ON agent_tasks (workflow_id);

CREATE TABLE agent_task_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES agent_tasks (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status     text,
  message    text,
  data_json  jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_agent_task_events_task_id ON agent_task_events (task_id);

CREATE TABLE agent_task_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES agent_tasks (id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  name          text,
  storage_key   text,            -- S3 object key (НЕ presigned URL)
  content_hash  text,
  size_bytes    bigint,
  metadata_json jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_agent_task_artifacts_task_id ON agent_task_artifacts (task_id);

-- ================================ Chat ================================

CREATE TABLE chat_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  source_portal text,
  title         text,
  status        text NOT NULL DEFAULT 'active',
  metadata_json jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_chat_sessions_user_id ON chat_sessions (user_id);
CREATE INDEX ix_chat_sessions_status  ON chat_sessions (status);

CREATE TABLE chat_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role           text NOT NULL,
  content        text NOT NULL,
  tool_call_json jsonb,
  token_count    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_chat_messages_session_id ON chat_messages (session_id);

-- ============================== Workflow ==============================

CREATE TABLE workflow_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text NOT NULL,
  name              text NOT NULL,
  description       text,
  status            text NOT NULL DEFAULT 'draft',
  latest_version_id uuid,            -- денормализованный указатель (без FK во избежание цикла)
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_workflow_templates_key ON workflow_templates (key);
CREATE INDEX ix_workflow_templates_status    ON workflow_templates (status);

CREATE TABLE workflow_template_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES workflow_templates (id) ON DELETE CASCADE,
  version         integer NOT NULL,
  definition_json jsonb NOT NULL,
  checksum        text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
CREATE INDEX ix_workflow_template_versions_template_id ON workflow_template_versions (template_id);

CREATE TABLE workflow_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         uuid REFERENCES workflow_templates (id) ON DELETE SET NULL,
  template_version_id uuid REFERENCES workflow_template_versions (id) ON DELETE SET NULL,
  task_id             uuid REFERENCES agent_tasks (id) ON DELETE SET NULL,
  workflow_id         text,
  status              text NOT NULL DEFAULT 'pending',
  started_at          timestamptz,
  completed_at        timestamptz,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_workflow_runs_task_id     ON workflow_runs (task_id);
CREATE INDEX ix_workflow_runs_workflow_id ON workflow_runs (workflow_id);
CREATE INDEX ix_workflow_runs_status      ON workflow_runs (status);

-- ============================== Approvals =============================

CREATE TABLE approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid REFERENCES agent_tasks (id) ON DELETE CASCADE,
  tool_call_id  uuid,            -- указатель на tool_call_logs (FK не задаём: таблица в 0003)
  subject_id    text NOT NULL,
  risk_level    text NOT NULL,
  action        text NOT NULL,
  resource      text,
  status        text NOT NULL DEFAULT 'pending',
  decided_by    text,
  decided_at    timestamptz,
  reason        text,
  metadata_json jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_approvals_task_id ON approvals (task_id);
CREATE INDEX ix_approvals_status  ON approvals (status);

CREATE TABLE approval_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES approvals (id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  actor       text NOT NULL,
  outcome     text,
  message     text,
  data_json   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_approval_events_approval_id ON approval_events (approval_id);

-- ============================= Agent runs =============================

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid REFERENCES agent_tasks (id) ON DELETE SET NULL,
  session_id    uuid REFERENCES chat_sessions (id) ON DELETE SET NULL,
  graph_name    text,
  status        text NOT NULL DEFAULT 'pending',
  started_at    timestamptz,
  completed_at  timestamptz,
  error_code    text,
  metadata_json jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_agent_runs_task_id ON agent_runs (task_id);
CREATE INDEX ix_agent_runs_status  ON agent_runs (status);

CREATE TABLE agent_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  step_index  integer NOT NULL,
  step_type   text NOT NULL,
  tool_name   text,
  status      text,
  input_hash  text,
  output_hash text,
  duration_ms integer,
  data_json   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index)
);
CREATE INDEX ix_agent_steps_run_id ON agent_steps (run_id);
