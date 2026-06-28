/**
 * Порт телеметрии вызовов инструментов (`tool_call_logs`) + порт risk-policy.
 * Инъектируются в брокер, поэтому ядро остаётся DB-free (DB-реализации — в
 * `@su10/tool-base`). Хранятся только хэши/метаданные, не сырьё.
 */
import type { RiskLevel } from '@su10/permissions';
import type { ToolDefinition } from './types.js';

export type ToolCallStatus = 'success' | 'denied' | 'failure' | 'approval_required';

export interface ToolCallRecord {
  toolName: string;
  toolVersion: number;
  subjectId: string;
  taskId?: string;
  agentRunId?: string;
  idempotencyKey?: string;
  status: ToolCallStatus;
  riskLevel: RiskLevel;
  approved: boolean;
  inputHash?: string;
  outputHash?: string;
  durationMs: number;
  redactedErrorCode?: string;
  at: string;
}

export interface ToolCallRecorder {
  record(rec: ToolCallRecord): Promise<void> | void;
}

export class InMemoryToolCallRecorder implements ToolCallRecorder {
  readonly records: ToolCallRecord[] = [];
  record(rec: ToolCallRecord): void {
    this.records.push(rec);
  }
}

/** No-op по умолчанию (когда recorder не инжектирован). */
export const noopToolCallRecorder: ToolCallRecorder = { record() {} };

export interface ResolvedPolicy {
  requiresApproval: boolean;
  autoApproveRoles?: string[];
}

export interface ToolPolicyResolver {
  resolve(tool: ToolDefinition): ResolvedPolicy | Promise<ResolvedPolicy>;
}
