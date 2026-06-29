-- 0007_mcp_registry.sql — MCP registry v1: snapshot-метаданные + история health-check'ов.
--
-- БЕЗОПАСНОСТЬ: endpoint MCP-сервера хранится как endpoint_secret_ref (ссылка),
-- health-check detail — только безопасное краткое описание (без endpoint/секретов).
--
-- Forward: ALTER mcp_servers (+snapshot), CREATE mcp_server_health_checks.
-- Rollback:
--   DROP TABLE mcp_server_health_checks;
--   ALTER TABLE mcp_servers DROP COLUMN tools_snapshot_at, DROP COLUMN tools_snapshot_hash;

ALTER TABLE mcp_servers ADD COLUMN tools_snapshot_hash text;
ALTER TABLE mcp_servers ADD COLUMN tools_snapshot_at  timestamptz;

CREATE TABLE mcp_server_health_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id  uuid NOT NULL REFERENCES mcp_servers (id) ON DELETE CASCADE,
  status     text NOT NULL,          -- ok | error
  latency_ms integer,
  detail     text,                   -- safe summary, no secrets/endpoint
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mcp_server_health_checks_server_id  ON mcp_server_health_checks (server_id);
CREATE INDEX ix_mcp_server_health_checks_checked_at ON mcp_server_health_checks (checked_at);
