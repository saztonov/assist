-- 0002_providers.sql — реестр LLM/SaaS-провайдеров, моделей, политик, телеметрии.
--
-- БЕЗОПАСНОСТЬ: только метаданные и secret-references (*_secret_ref). Сырые токены/
-- пароли/refresh-токены/base URL в БД НЕ хранятся. provider_usage_events и llm_calls
-- НЕ содержат сырых prompt/документов/токенов/presigned URL — только метаданные,
-- хэши, идентификаторы, статусы, длительности, счётчики токенов, redacted error code.
--
-- Forward: llm_provider_registry, llm_provider_models, provider_policies,
--   provider_usage_events, provider_health_events, external_saas_providers, llm_calls.
-- Rollback: DROP в обратном порядке.

CREATE TABLE llm_provider_registry (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type        text NOT NULL,  -- lmstudio | cloud_llm | saas_api | internal_api | embedding_provider | rerank_provider
  display_name         text NOT NULL,
  enabled              boolean NOT NULL DEFAULT false,
  base_url_secret_ref  text,
  config_secret_ref    text,
  api_token_secret_ref text,
  allowed_data_classes jsonb,
  allowed_roles        jsonb,
  local_only           boolean NOT NULL DEFAULT true,
  cloud_allowed        boolean NOT NULL DEFAULT false,
  audit_level          text NOT NULL DEFAULT 'standard',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_llm_provider_registry_type    ON llm_provider_registry (provider_type);
CREATE INDEX ix_llm_provider_registry_enabled ON llm_provider_registry (enabled);

CREATE TABLE llm_provider_models (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id            uuid NOT NULL REFERENCES llm_provider_registry (id) ON DELETE CASCADE,
  model_id               text NOT NULL,
  purpose                text,
  context_window         integer,
  max_parallel_requests  integer,
  default_timeout_ms     integer,
  default_temperature    double precision,
  supports_vision          boolean NOT NULL DEFAULT false,
  supports_json_extraction boolean NOT NULL DEFAULT false,
  supports_embeddings      boolean NOT NULL DEFAULT false,
  embedding_dim          integer,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_id)
);
CREATE INDEX ix_llm_provider_models_provider_id ON llm_provider_models (provider_id);
CREATE INDEX ix_llm_provider_models_model_id    ON llm_provider_models (model_id);

CREATE TABLE provider_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  provider_type       text,
  data_class          text NOT NULL,
  decision            text NOT NULL,  -- allow | deny
  local_only_required boolean NOT NULL DEFAULT false,
  cloud_allowed       boolean NOT NULL DEFAULT false,
  reason              text,
  priority            integer NOT NULL DEFAULT 100,
  enabled             boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_provider_policies_data_class    ON provider_policies (data_class);
CREATE INDEX ix_provider_policies_provider_type ON provider_policies (provider_type);
CREATE INDEX ix_provider_policies_enabled       ON provider_policies (enabled);

-- Телеметрия использования. БЕЗ сырых prompt/документов/токенов/URL.
CREATE TABLE provider_usage_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         uuid REFERENCES llm_provider_registry (id) ON DELETE SET NULL,
  model_id            text,
  task_id             uuid REFERENCES agent_tasks (id) ON DELETE SET NULL,
  request_hash        text,
  status              text NOT NULL,
  duration_ms         integer,
  input_tokens        integer,
  output_tokens       integer,
  redacted_error_code text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_provider_usage_events_provider_id ON provider_usage_events (provider_id);
CREATE INDEX ix_provider_usage_events_task_id     ON provider_usage_events (task_id);
CREATE INDEX ix_provider_usage_events_status      ON provider_usage_events (status);

-- Только для будущей записи результатов. Реальные health-checks тут не выполняются.
CREATE TABLE provider_health_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES llm_provider_registry (id) ON DELETE CASCADE,
  status      text NOT NULL,
  latency_ms  integer,
  checked_at  timestamptz,
  error_code  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_provider_health_events_provider_id ON provider_health_events (provider_id);

CREATE TABLE external_saas_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type text NOT NULL DEFAULT 'saas_api',
  display_name  text NOT NULL,
  capabilities  jsonb,
  allowed_tools jsonb,
  allowed_roles jsonb,
  data_policy   jsonb,
  secret_ref    text,
  enabled       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_external_saas_providers_type    ON external_saas_providers (provider_type);
CREATE INDEX ix_external_saas_providers_enabled ON external_saas_providers (enabled);

-- Журнал LLM-вызовов. Сырой prompt НЕ хранится (только prompt_hash).
CREATE TABLE llm_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         uuid REFERENCES llm_provider_registry (id) ON DELETE SET NULL,
  model_id            text,
  task_id             uuid REFERENCES agent_tasks (id) ON DELETE SET NULL,
  agent_run_id        uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  purpose             text,
  status              text NOT NULL,
  prompt_hash         text,
  duration_ms         integer,
  input_tokens        integer,
  output_tokens       integer,
  redacted_error_code text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_llm_calls_provider_id ON llm_calls (provider_id);
CREATE INDEX ix_llm_calls_task_id     ON llm_calls (task_id);
CREATE INDEX ix_llm_calls_status      ON llm_calls (status);
