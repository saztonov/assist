/**
 * Tool Registry: определения инструментов, версии (input/output schema),
 * permissions, журнал вызовов и approval-политики. Все вызовы — только через
 * Tool Broker; у каждого инструмента есть input/output schema, risk_level,
 * permission check, audit и approval policy.
 */
import { pgTable, uuid, text, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt } from './_columns.js';

export const toolDefinitions = pgTable('tool_definitions', {
  id: uuidPk(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  riskLevel: text('risk_level').notNull().default('low'),
  latestVersionId: uuid('latest_version_id'),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const toolVersions = pgTable('tool_versions', {
  id: uuidPk(),
  toolId: uuid('tool_id').notNull(),
  version: integer('version').notNull(),
  inputSchemaJson: jsonb('input_schema_json').notNull(),
  outputSchemaJson: jsonb('output_schema_json').notNull(),
  handlerRef: text('handler_ref'),
  checksum: text('checksum'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
});

export const toolPermissions = pgTable('tool_permissions', {
  id: uuidPk(),
  toolId: uuid('tool_id').notNull(),
  principalType: text('principal_type').notNull(),
  principalId: text('principal_id').notNull(),
  permission: text('permission').notNull().default('invoke'),
  createdAt: createdAt(),
});

export const toolCallLogs = pgTable('tool_call_logs', {
  id: uuidPk(),
  toolId: uuid('tool_id'),
  toolVersionId: uuid('tool_version_id'),
  taskId: uuid('task_id'),
  agentRunId: uuid('agent_run_id'),
  subjectId: text('subject_id'),
  idempotencyKey: text('idempotency_key'),
  status: text('status').notNull(),
  riskLevel: text('risk_level'),
  approved: boolean('approved').notNull().default(false),
  inputHash: text('input_hash'),
  outputHash: text('output_hash'),
  durationMs: integer('duration_ms'),
  redactedErrorCode: text('redacted_error_code'),
  createdAt: createdAt(),
});

export const toolApprovalPolicies = pgTable('tool_approval_policies', {
  id: uuidPk(),
  toolId: uuid('tool_id'),
  riskLevel: text('risk_level').notNull(),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  autoApproveRoles: jsonb('auto_approve_roles'),
  reason: text('reason'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
