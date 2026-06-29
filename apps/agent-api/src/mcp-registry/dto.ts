/** DTO/zod-схемы и мапперы MCP registry REST. Карточки НЕ содержат секретов. */
import { z } from 'zod';
import type { McpServerRow } from '@su10/db';

const RiskLevelEnum = z.enum(['low', 'medium', 'high']);
const PrincipalTypeEnum = z.enum(['user', 'role', 'group']);

// ---- requests ----

export const McpServerIdParams = z.object({ id: z.string().uuid() });

export const McpPermissionInputSchema = z.object({
  principalType: PrincipalTypeEnum,
  principalId: z.string().min(1),
  permission: z.string().min(1).optional(),
});

export const CreateMcpServerBody = z.object({
  key: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  transport: z.string().min(1).max(100).optional(),
  /** Ссылка на секрет с endpoint — НЕ сырой endpoint/секрет. */
  endpointSecretRef: z.string().min(1).max(500).optional(),
  riskLevel: RiskLevelEnum.default('medium'),
  allowed: z.boolean().default(false),
  enabled: z.boolean().default(false),
  permissions: z.array(McpPermissionInputSchema).max(100).optional(),
});

export const ToolEnableParams = z.object({
  id: z.string().uuid(),
  toolName: z.string().min(1).max(200),
});

export const ToolEnableBody = z.object({
  enabled: z.boolean(),
  riskLevel: RiskLevelEnum.optional(),
});

// ---- responses ----

export const McpServerCardSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  transport: z.string().nullable(),
  allowed: z.boolean(),
  riskLevel: z.string(),
  enabled: z.boolean(),
  toolsSnapshotHash: z.string().nullable(),
  toolsSnapshotAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ListMcpServersResponse = z.object({ servers: z.array(McpServerCardSchema) });

export const HealthCheckResponse = z.object({
  ok: z.boolean(),
  status: z.string(),
  latencyMs: z.number().nullable(),
});

export const SnapshotToolsResponse = z.object({
  hash: z.string(),
  total: z.number(),
  added: z.number(),
  kept: z.number(),
});

export const ToolEnableResponse = z.object({
  toolName: z.string(),
  enabled: z.boolean(),
  riskLevel: z.string().nullable(),
});

export type McpServerCard = z.infer<typeof McpServerCardSchema>;

/** Безопасная проекция строки сервера — БЕЗ `endpointSecretRef`. */
export function toMcpServerCard(row: McpServerRow): McpServerCard {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    transport: row.transport,
    allowed: row.allowed,
    riskLevel: row.riskLevel,
    enabled: row.enabled,
    toolsSnapshotHash: row.toolsSnapshotHash,
    toolsSnapshotAt: row.toolsSnapshotAt ? row.toolsSnapshotAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
