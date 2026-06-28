/**
 * MCP-реестр: серверы, их инструменты и permissions. MCP — через управляемый
 * registry с allowlist, permissions и audit. Endpoint хранится как secret-ref.
 */
import { pgTable, uuid, text, boolean, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt } from './_columns.js';

export const mcpServers = pgTable('mcp_servers', {
  id: uuidPk(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  transport: text('transport'),
  endpointSecretRef: text('endpoint_secret_ref'),
  allowed: boolean('allowed').notNull().default(false),
  riskLevel: text('risk_level').notNull().default('medium'),
  enabled: boolean('enabled').notNull().default(false),
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
