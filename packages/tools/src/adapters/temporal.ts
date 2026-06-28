/**
 * Temporal activity adapter. Возвращает activity-образную функцию, которую worker
 * (шаг 6) регистрирует как activity; детерминированный workflow остаётся чистым.
 * Реконструирует ToolContext из сериализуемого входа и funnel'ит в broker.invoke.
 */
import type { AuditSink } from '@su10/audit';
import type { ToolBroker } from '../broker.js';

export interface ToolInvokeActivityInput {
  name: string;
  input: unknown;
  subjectId: string;
  roles: string[];
  at: string;
  taskId?: string;
  agentRunId?: string;
  idempotencyKey?: string;
  approved?: boolean;
}

export function makeToolInvokeActivity(
  broker: ToolBroker,
  deps: { auditSink: AuditSink },
): (input: ToolInvokeActivityInput) => Promise<unknown> {
  return (a) =>
    broker.invoke(a.name, a.input, {
      subject: { id: a.subjectId, roles: a.roles },
      auditSink: deps.auditSink,
      at: a.at,
      ...(a.taskId ? { taskId: a.taskId } : {}),
      ...(a.agentRunId ? { agentRunId: a.agentRunId } : {}),
      ...(a.idempotencyKey ? { idempotencyKey: a.idempotencyKey } : {}),
      ...(a.approved ? { approved: a.approved } : {}),
    });
}
