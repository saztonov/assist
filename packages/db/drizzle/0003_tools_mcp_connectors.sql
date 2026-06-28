-- 0003_tools_mcp_connectors.sql — Tool Registry, MCP-реестр, Connector Registry.
--
-- БЕЗОПАСНОСТЬ: mcp endpoint и connector-доступ хранятся как secret-ref;
-- connector_tokens_metadata хранит ТОЛЬКО метаданные токена + secret_ref, не значение.
--
-- Forward: tool_*, mcp_*, connector_*.
-- Rollback: DROP в обратном порядке (connector_* → mcp_* → tool_*).

-- =============================== Tools ===============================

CREATE TABLE tool_definitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text NOT NULL,
  name              text NOT NULL,
  description       text,
  risk_level        text NOT NULL DEFAULT 'low',
  latest_version_id uuid,            -- денормализованный указатель (без FK во избежание цикла)
  enabled           boolean NOT NULL DEFAULT true,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_tool_definitions_key ON tool_definitions (key);
CREATE INDEX ix_tool_definitions_enabled    ON tool_definitions (enabled);
CREATE INDEX ix_tool_definitions_risk_level ON tool_definitions (risk_level);

CREATE TABLE tool_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id            uuid NOT NULL REFERENCES tool_definitions (id) ON DELETE CASCADE,
  version            integer NOT NULL,
  input_schema_json  jsonb NOT NULL,
  output_schema_json jsonb NOT NULL,
  handler_ref        text,
  checksum           text,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_id, version)
);
CREATE INDEX ix_tool_versions_tool_id ON tool_versions (tool_id);

CREATE TABLE tool_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id        uuid NOT NULL REFERENCES tool_definitions (id) ON DELETE CASCADE,
  principal_type text NOT NULL,
  principal_id   text NOT NULL,
  permission     text NOT NULL DEFAULT 'invoke',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_id, principal_type, principal_id, permission)
);
CREATE INDEX ix_tool_permissions_tool_id ON tool_permissions (tool_id);

CREATE TABLE tool_call_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id             uuid REFERENCES tool_definitions (id) ON DELETE SET NULL,
  tool_version_id     uuid REFERENCES tool_versions (id) ON DELETE SET NULL,
  task_id             uuid REFERENCES agent_tasks (id) ON DELETE SET NULL,
  agent_run_id        uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  subject_id          text,
  idempotency_key     text,
  status              text NOT NULL,
  risk_level          text,
  approved            boolean NOT NULL DEFAULT false,
  input_hash          text,
  output_hash         text,
  duration_ms         integer,
  redacted_error_code text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tool_call_logs_tool_id ON tool_call_logs (tool_id);
CREATE INDEX ix_tool_call_logs_task_id ON tool_call_logs (task_id);
CREATE INDEX ix_tool_call_logs_status  ON tool_call_logs (status);
-- Идемпотентность вызовов (partial unique по непустому ключу).
CREATE UNIQUE INDEX ux_tool_call_logs_idempotency
  ON tool_call_logs (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE tool_approval_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id           uuid REFERENCES tool_definitions (id) ON DELETE CASCADE,
  risk_level        text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  auto_approve_roles jsonb,
  reason            text,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tool_approval_policies_tool_id    ON tool_approval_policies (tool_id);
CREATE INDEX ix_tool_approval_policies_risk_level ON tool_approval_policies (risk_level);

-- ================================ MCP ================================

CREATE TABLE mcp_servers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL,
  name               text NOT NULL,
  transport          text,
  endpoint_secret_ref text,
  allowed            boolean NOT NULL DEFAULT false,
  risk_level         text NOT NULL DEFAULT 'medium',
  enabled            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_mcp_servers_key ON mcp_servers (key);
CREATE INDEX ix_mcp_servers_enabled    ON mcp_servers (enabled);
CREATE INDEX ix_mcp_servers_allowed    ON mcp_servers (allowed);

CREATE TABLE mcp_server_tools (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id         uuid NOT NULL REFERENCES mcp_servers (id) ON DELETE CASCADE,
  tool_name         text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  input_schema_json jsonb,
  risk_level        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, tool_name)
);
CREATE INDEX ix_mcp_server_tools_server_id ON mcp_server_tools (server_id);

CREATE TABLE mcp_server_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id      uuid NOT NULL REFERENCES mcp_servers (id) ON DELETE CASCADE,
  principal_type text NOT NULL,
  principal_id   text NOT NULL,
  permission     text NOT NULL DEFAULT 'use',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, principal_type, principal_id, permission)
);
CREATE INDEX ix_mcp_server_permissions_server_id ON mcp_server_permissions (server_id);

-- ============================= Connectors ============================

CREATE TABLE connector_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid REFERENCES external_saas_providers (id) ON DELETE SET NULL,
  connector_key text NOT NULL,
  display_name  text,
  owner_user_id text,
  secret_ref    text,
  status        text NOT NULL DEFAULT 'inactive',
  enabled       boolean NOT NULL DEFAULT false,
  metadata_json jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_connector_accounts_connector_key ON connector_accounts (connector_key);
CREATE INDEX ix_connector_accounts_enabled       ON connector_accounts (enabled);
CREATE INDEX ix_connector_accounts_status        ON connector_accounts (status);

CREATE TABLE connector_permissions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_account_id uuid NOT NULL REFERENCES connector_accounts (id) ON DELETE CASCADE,
  principal_type       text NOT NULL,
  principal_id         text NOT NULL,
  permission           text NOT NULL DEFAULT 'use',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_account_id, principal_type, principal_id, permission)
);
CREATE INDEX ix_connector_permissions_account_id ON connector_permissions (connector_account_id);

-- Только МЕТАДАННЫЕ токена + secret_ref. Значение токена в БД НЕ хранится.
CREATE TABLE connector_tokens_metadata (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_account_id uuid NOT NULL REFERENCES connector_accounts (id) ON DELETE CASCADE,
  token_type           text NOT NULL,   -- access | refresh
  secret_ref           text NOT NULL,
  scopes               jsonb,
  expires_at           timestamptz,
  last_rotated_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_connector_tokens_metadata_account_id ON connector_tokens_metadata (connector_account_id);
