/**
 * DB-backed `ToolCallRecorder` → `tool_call_logs` (через `@su10/db` toolRepo).
 * Хранятся только хэши/duration/redacted code, без сырья. Линковка
 * toolId/toolVersionId опциональна (резолвится после `syncRegistryToDb`); без неё
 * пишутся NULL — бизнес-аудит (action=имя) остаётся в `audit_events`.
 */
import { createToolRepo, type Database, type ToolRef } from '@su10/db';
import type { ToolCallRecord, ToolCallRecorder } from '@su10/tools';

export interface DbToolCallRecorderOptions {
  /** name → {toolId, toolVersionId} (например, из syncRegistryToDb). */
  resolveTool?: (name: string, version: number) => ToolRef | undefined;
}

export function createDbToolCallRecorder(
  db: Database,
  opts: DbToolCallRecorderOptions = {},
): ToolCallRecorder {
  const repo = createToolRepo(db);
  return {
    async record(rec: ToolCallRecord): Promise<void> {
      const ref = opts.resolveTool?.(rec.toolName, rec.toolVersion);
      await repo.insertCallLog({
        toolId: ref?.toolId ?? null,
        toolVersionId: ref?.toolVersionId ?? null,
        taskId: rec.taskId ?? null,
        agentRunId: rec.agentRunId ?? null,
        subjectId: rec.subjectId,
        idempotencyKey: rec.idempotencyKey ?? null,
        status: rec.status,
        riskLevel: rec.riskLevel,
        approved: rec.approved,
        inputHash: rec.inputHash ?? null,
        outputHash: rec.outputHash ?? null,
        durationMs: rec.durationMs,
        redactedErrorCode: rec.redactedErrorCode ?? null,
      });
    },
  };
}
