/**
 * MCP-реестр: серверы, их инструменты и permissions. MCP — через управляемый
 * registry с allowlist, permissions и audit. Endpoint хранится как secret-ref.
 */
import { pgTable, uuid, text, boolean, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const mcpServers = pgTable('mcp_servers', {
  id: uuidPk(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  transport: text('transport'),
  endpointSecretRef: text('endpoint_secret_ref'),
  allowed: boolean('allowed').notNull().default(false),
  riskLevel: text('risk_level').notNull().default('medium'),
  enabled: boolean('enabled').notNull().default(false),
  // Snapshot tools/list: стабильный hash последнего снимка + момент снятия.
  toolsSnapshotHash: text('tools_snapshot_hash'),
  toolsSnapshotAt: tsOptional('tools_snapshot_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mcpServerTools = pgTable('mcp_server_tools', {
  id: uuidPk(),
  serverId: uuid('server_id').notNull(),
  toolName: text('tool_name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  inputSchemaJson: jsonb('input_schema_json'),
  riskLevel: text('risk_level'),
  createdAt: createdAt(),
});

export const mcpServerPermissions = pgTable('mcp_server_permissions', {
  id: uuidPk(),
  serverId: uuid('server_id').notNull(),
  principalType: text('principal_type').notNull(),
  principalId: text('principal_id').notNull(),
  permission: text('permission').notNull().default('use'),
  createdAt: createdAt(),
});

/**
 * История health-check'ов MCP-сервера. `detail` — только безопасное краткое
 * описание (без endpoint, секретов и сырых upstream-ошибок).
 */
export const mcpServerHealthChecks = pgTable('mcp_server_health_checks', {
  id: uuidPk(),
  serverId: uuid('server_id').notNull(),
  status: text('status').notNull(), // ok | error
  latencyMs: integer('latency_ms'),
  detail: text('detail'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});
