/** Контракты Tool Registry / Tool Broker. NODE-ONLY (ядро БЕЗ зависимости от БД). */
import type { ZodTypeAny } from 'zod';
import type { RiskLevel, Subject } from '@su10/permissions';
import type { AuditSink } from '@su10/audit';

export type ToolCategory =
  | 'task'
  | 'artifact'
  | 'approval'
  | 'notification'
  | 'system'
  | 'connector';

export interface ToolContext {
  subject: Subject;
  /** Уже одобрено (approval-флоу) — пропускает approval-проверку. */
  approved?: boolean;
  auditSink: AuditSink;
  /** ISO timestamp (детерминированный, тестируемый). */
  at: string;
  /** Корреляция вызова для call-log (никогда не сырьё). */
  taskId?: string;
  agentRunId?: string;
  idempotencyKey?: string;
  /** Прокидывается брокером на шаге timeout; handler должен уважать отмену. */
  signal?: AbortSignal;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  version: number;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  /** Дополнительный ролевой гейт сверх permissions.can() (admin — байпас). */
  allowedRoles?: string[];
  /** Статически требует approval независимо от risk policy. */
  requiresApproval?: boolean;
  /** Бюджет исполнения; брокер гонит handler против таймаута. */
  timeoutMs: number;
  /** Исполнять ТОЛЬКО через ToolBroker.invoke (наружу не экспонируется). */
  handler(input: I, ctx: ToolContext): Promise<O>;
}
