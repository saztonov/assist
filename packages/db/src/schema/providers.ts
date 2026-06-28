/**
 * Реестр LLM/SaaS-провайдеров, моделей, политик и телеметрии.
 *
 * БЕЗОПАСНОСТЬ: таблицы хранят ТОЛЬКО метаданные и secret-references (`*_secret_ref`).
 * Сырые токены/пароли/OAuth refresh-токены/base URL в БД НЕ хранятся.
 * `provider_usage_events` и `llm_calls` НЕ хранят сырые prompt/документы/токены/
 * presigned URL — только метаданные, хэши, идентификаторы, статусы, длительности,
 * счётчики токенов и redacted error code.
 */
import { pgTable, uuid, text, integer, boolean, doublePrecision, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const llmProviderRegistry = pgTable('llm_provider_registry', {
  id: uuidPk(),
  // lmstudio | cloud_llm | saas_api | internal_api | embedding_provider | rerank_provider
  providerType: text('provider_type').notNull(),
  displayName: text('display_name').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  baseUrlSecretRef: text('base_url_secret_ref'),
  configSecretRef: text('config_secret_ref'),
  apiTokenSecretRef: text('api_token_secret_ref'),
  allowedDataClasses: jsonb('allowed_data_classes'),
  allowedRoles: jsonb('allowed_roles'),
  localOnly: boolean('local_only').notNull().default(true),
  cloudAllowed: boolean('cloud_allowed').notNull().default(false),
  auditLevel: text('audit_level').notNull().default('standard'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const llmProviderModels = pgTable('llm_provider_models', {
  id: uuidPk(),
  providerId: uuid('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  purpose: text('purpose'),
  contextWindow: integer('context_window'),
  maxParallelRequests: integer('max_parallel_requests'),
  defaultTimeoutMs: integer('default_timeout_ms'),
  defaultTemperature: doublePrecision('default_temperature'),
  supportsVision: boolean('supports_vision').notNull().default(false),
  supportsJsonExtraction: boolean('supports_json_extraction').notNull().default(false),
  supportsEmbeddings: boolean('supports_embeddings').notNull().default(false),
  embeddingDim: integer('embedding_dim'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const providerPolicies = pgTable('provider_policies', {
  id: uuidPk(),
  name: text('name').notNull(),
  providerType: text('provider_type'),
  dataClass: text('data_class').notNull(),
  decision: text('decision').notNull(), // allow | deny
  localOnlyRequired: boolean('local_only_required').notNull().default(false),
  cloudAllowed: boolean('cloud_allowed').notNull().default(false),
  reason: text('reason'),
  priority: integer('priority').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const providerUsageEvents = pgTable('provider_usage_events', {
  id: uuidPk(),
  providerId: uuid('provider_id'),
  modelId: text('model_id'),
  taskId: uuid('task_id'),
  requestHash: text('request_hash'),
  status: text('status').notNull(),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  redactedErrorCode: text('redacted_error_code'),
  createdAt: createdAt(),
});

export const providerHealthEvents = pgTable('provider_health_events', {
  id: uuidPk(),
  providerId: uuid('provider_id').notNull(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms'),
  checkedAt: tsOptional('checked_at'),
  errorCode: text('error_code'),
  createdAt: createdAt(),
});

export const externalSaasProviders = pgTable('external_saas_providers', {
  id: uuidPk(),
  providerType: text('provider_type').notNull().default('saas_api'),
  displayName: text('display_name').notNull(),
  capabilities: jsonb('capabilities'),
  allowedTools: jsonb('allowed_tools'),
  allowedRoles: jsonb('allowed_roles'),
  dataPolicy: jsonb('data_policy'),
  secretRef: text('secret_ref'),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const llmCalls = pgTable('llm_calls', {
  id: uuidPk(),
  providerId: uuid('provider_id'),
  modelId: text('model_id'),
  taskId: uuid('task_id'),
  agentRunId: uuid('agent_run_id'),
  purpose: text('purpose'),
  status: text('status').notNull(),
  promptHash: text('prompt_hash'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  redactedErrorCode: text('redacted_error_code'),
  createdAt: createdAt(),
});
