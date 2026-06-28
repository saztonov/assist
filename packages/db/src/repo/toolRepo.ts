/**
 * Доступ к Tool Registry-таблицам: журнал вызовов (`tool_call_logs`), approval-
 * политики (`tool_approval_policies`) и idempotent-синхронизация метаданных
 * (`tool_definitions`/`tool_versions`). Вся работа с БД — здесь; `@su10/tool-base`
 * только оборачивает это в порты `@su10/tools`.
 */
import { and, eq } from 'drizzle-orm';
import { toolApprovalPolicies, toolCallLogs, toolDefinitions, toolVersions } from '../schema/tools.js';
import type { Database } from '../index.js';

export interface ToolCallLogInsert {
  toolId?: string | null;
  toolVersionId?: string | null;
  taskId?: string | null;
  agentRunId?: string | null;
  subjectId: string;
  idempotencyKey?: string | null;
  status: string;
  riskLevel?: string | null;
  approved: boolean;
  inputHash?: string | null;
  outputHash?: string | null;
  durationMs?: number | null;
  redactedErrorCode?: string | null;
}

export interface ToolApprovalPolicyRow {
  requiresApproval: boolean;
  autoApproveRoles?: string[];
}

export interface ToolRef {
  toolId: string;
  toolVersionId?: string;
}

export interface UpsertToolVersionInput {
  name: string;
  description?: string | null;
  riskLevel: string;
  version: number;
  inputSchema: unknown;
  outputSchema: unknown;
  checksum: string;
  createdBy?: string;
}

export interface ToolRepo {
  insertCallLog(row: ToolCallLogInsert): Promise<void>;
  getApprovalPolicy(toolName: string, riskLevel: string): Promise<ToolApprovalPolicyRow | undefined>;
  upsertToolVersion(input: UpsertToolVersionInput): Promise<ToolRef>;
}

export function createToolRepo(db: Database): ToolRepo {
  return {
    async insertCallLog(row) {
      await db.insert(toolCallLogs).values({
        toolId: row.toolId ?? null,
        toolVersionId: row.toolVersionId ?? null,
        taskId: row.taskId ?? null,
        agentRunId: row.agentRunId ?? null,
        subjectId: row.subjectId ?? null,
        idempotencyKey: row.idempotencyKey ?? null,
        status: row.status,
        riskLevel: row.riskLevel ?? null,
        approved: row.approved,
        inputHash: row.inputHash ?? null,
        outputHash: row.outputHash ?? null,
        durationMs: row.durationMs ?? null,
        redactedErrorCode: row.redactedErrorCode ?? null,
      });
    },

    async getApprovalPolicy(toolName, riskLevel) {
      const [def] = await db
        .select({ id: toolDefinitions.id })
        .from(toolDefinitions)
        .where(and(eq(toolDefinitions.key, toolName), eq(toolDefinitions.enabled, true)))
        .limit(1);
      if (!def) return undefined;
      const [pol] = await db
        .select()
        .from(toolApprovalPolicies)
        .where(
          and(
            eq(toolApprovalPolicies.toolId, def.id),
            eq(toolApprovalPolicies.riskLevel, riskLevel),
            eq(toolApprovalPolicies.enabled, true),
          ),
        )
        .limit(1);
      if (!pol) return undefined;
      const roles = Array.isArray(pol.autoApproveRoles)
        ? (pol.autoApproveRoles as string[])
        : undefined;
      return { requiresApproval: pol.requiresApproval, ...(roles ? { autoApproveRoles: roles } : {}) };
    },

    async upsertToolVersion(input) {
      const [def] = await db
        .insert(toolDefinitions)
        .values({
          key: input.name,
          name: input.name,
          description: input.description ?? null,
          riskLevel: input.riskLevel,
          enabled: true,
          createdBy: input.createdBy ?? 'system',
        })
        .onConflictDoUpdate({
          target: toolDefinitions.key,
          set: {
            name: input.name,
            description: input.description ?? null,
            riskLevel: input.riskLevel,
            updatedAt: new Date(),
          },
        })
        .returning({ id: toolDefinitions.id });

      await db
        .insert(toolVersions)
        .values({
          toolId: def.id,
          version: input.version,
          inputSchemaJson: input.inputSchema,
          outputSchemaJson: input.outputSchema,
          checksum: input.checksum,
          createdBy: input.createdBy ?? 'system',
        })
        .onConflictDoNothing({ target: [toolVersions.toolId, toolVersions.version] });

      const [ver] = await db
        .select({ id: toolVersions.id })
        .from(toolVersions)
        .where(and(eq(toolVersions.toolId, def.id), eq(toolVersions.version, input.version)))
        .limit(1);

      return { toolId: def.id, ...(ver ? { toolVersionId: ver.id } : {}) };
    },
  };
}
