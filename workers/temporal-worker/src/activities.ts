/**
 * Реализация Temporal activities — ЕДИНСТВЕННОЕ место side effects workflow.
 * Детерминированный workflow остаётся чистым; здесь живут БД/брокер/аудит.
 *
 * Инварианты:
 * - смена бизнес-статуса только через `taskRepo.transitionStatus` (источник истины);
 * - инструменты — только через `broker.invoke` (адаптер `makeToolInvokeActivity`);
 * - side effects идемпотентны (повтор при ретрае Temporal не дублирует эффект);
 * - в логи/историю не уходит сырьё (хэши/ids/коды).
 */
import { ConflictError } from '@su10/errors';
import type {
  AgentApprovalRepo,
  AgentTaskRepo,
  ArtifactRepo,
  OutboxRepo,
} from '@su10/db';
import type { AuditSink } from '@su10/audit';
import { makeToolInvokeActivity, type ToolBroker } from '@su10/tools';
import type {
  AgentTaskActivities,
  RunAgentBlockInput,
  RunAgentBlockResult,
} from '@su10/workflow-engine';

/** Порт агентного runtime (LangGraph). Реальная реализация — этап 7 (PR7.2). */
export type AgentBlockRunner = (input: RunAgentBlockInput) => Promise<RunAgentBlockResult>;

/** Echo-runner по умолчанию (до подключения LangGraph). Без сети/сайд-эффектов. */
export const echoAgentBlockRunner: AgentBlockRunner = async (input) => ({
  output: `[${input.agentName}] ${input.prompt}`,
});

export interface TemporalActivityDeps {
  taskRepo: AgentTaskRepo;
  approvalRepo: AgentApprovalRepo;
  artifactRepo: ArtifactRepo;
  outboxRepo: OutboxRepo;
  broker: ToolBroker;
  auditSink: AuditSink;
  /** Агентный runtime; по умолчанию echo (этап 7 подменяет реальным). */
  runAgentBlock?: AgentBlockRunner;
}

/** Собирает реализацию activities из инжектируемых зависимостей. */
export function createActivities(deps: TemporalActivityDeps): AgentTaskActivities {
  const runToolBlockActivity = makeToolInvokeActivity(deps.broker, { auditSink: deps.auditSink });
  const runAgent = deps.runAgentBlock ?? echoAgentBlockRunner;

  return {
    async recordTaskStatus(i) {
      try {
        await deps.taskRepo.transitionStatus({
          taskId: i.taskId,
          to: i.to,
          ...(i.eventType ? { eventType: i.eventType } : {}),
          ...(i.message ? { message: i.message } : {}),
          ...(i.errorCode ? { errorCode: i.errorCode } : {}),
          ...(i.workflowId ? { workflowId: i.workflowId } : {}),
          ...(i.dataJson ? { dataJson: i.dataJson } : {}),
          ...(i.resultJson ? { resultJson: i.resultJson } : {}),
        });
      } catch (err) {
        // Идемпотентность под ретрай Temporal: если задача уже в целевом статусе —
        // считаем переход выполненным (не зацикливаем activity на ConflictError).
        if (err instanceof ConflictError) {
          const cur = await deps.taskRepo.getTaskById(i.taskId);
          if (cur?.status === i.to) return;
        }
        throw err;
      }
    },

    async runToolBlock(i) {
      return runToolBlockActivity({
        name: i.name,
        input: i.input,
        subjectId: i.subjectId,
        roles: i.roles,
        at: i.at,
        ...(i.taskId ? { taskId: i.taskId } : {}),
        ...(i.agentRunId ? { agentRunId: i.agentRunId } : {}),
        ...(i.idempotencyKey ? { idempotencyKey: i.idempotencyKey } : {}),
        ...(i.approved ? { approved: i.approved } : {}),
      });
    },

    async runAgentBlock(i) {
      return runAgent(i);
    },

    async createArtifact(i) {
      const row = await deps.artifactRepo.create({
        taskId: i.taskId,
        artifactType: i.artifactType,
        name: i.name ?? null,
        storageKey: i.storageKey,
        contentHash: i.contentHash ?? null,
        sizeBytes: i.sizeBytes ?? null,
        metadata: i.metadata ?? null,
      });
      return { artifactId: row.id };
    },

    async requestApproval(i) {
      const approval = await deps.approvalRepo.create({
        taskId: i.taskId,
        subjectId: i.subjectId,
        riskLevel: i.riskLevel,
        action: i.action,
        resource: i.resource ?? null,
        reason: i.reason ?? null,
      });
      // running → waiting_for_approval (как в базовом инструменте approval.request).
      await deps.taskRepo.transitionStatus({
        taskId: i.taskId,
        to: 'waiting_for_approval',
        eventType: 'approval_requested',
        dataJson: { approvalId: approval.id },
      });
      return { approvalId: approval.id };
    },

    async notifyUser(i) {
      const res = await deps.outboxRepo.enqueue({
        aggregateType: 'notification',
        eventType: 'notification.send',
        dedupeKey: i.dedupeKey,
        payload: { to: i.to, subject: i.subject, body: i.body },
      });
      return { enqueued: res.enqueued };
    },
  };
}
