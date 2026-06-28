/**
 * Реальный `TemporalPort` поверх `@temporalio/client` (шаг 6). Инжектируется в
 * `buildApp` из `server.ts` ТОЛЬКО при `TEMPORAL_ENABLED=true`; иначе используется
 * in-memory stub. Соединение/сеть создаются здесь (I/O вне `buildApp`).
 *
 * `@temporalio/client` импортируется динамически — тяжёлый native-модуль грузится
 * лишь когда Temporal реально включён.
 */
import { UpstreamError } from '@su10/errors';
import {
  GenericAgentTaskInputSchema,
  CANCEL_SIGNAL,
  type StartAgentTaskWorkflowArgs,
  type TemporalPort,
} from '@su10/workflow-engine';

export interface TemporalClientPort extends TemporalPort {
  /** Закрывает соединение (graceful shutdown). */
  close(): Promise<void>;
}

export interface TemporalClientPortConfig {
  address: string;
  namespace: string;
}

export async function createTemporalClientPort(
  cfg: TemporalClientPortConfig,
): Promise<TemporalClientPort> {
  const { Client, Connection } = await import('@temporalio/client');
  const connection = await Connection.connect({ address: cfg.address });
  const client = new Client({ connection, namespace: cfg.namespace });

  return {
    async startAgentTaskWorkflow(args: StartAgentTaskWorkflowArgs) {
      const workflowId = `agent-task-${args.taskId}`;
      const input = GenericAgentTaskInputSchema.parse({
        taskId: args.taskId,
        ...(args.templateId ? { templateId: args.templateId } : {}),
        ...(args.agentName ? { agentName: args.agentName } : {}),
        ...(args.prompt ? { prompt: args.prompt } : {}),
        subject: args.subject ?? { id: 'system', roles: [] },
        requireApproval: args.requireApproval ?? false,
      });
      try {
        const handle = await client.workflow.start('generic_agent_task_workflow', {
          taskQueue: args.taskQueue,
          workflowId,
          args: [input],
        });
        return { workflowId: handle.workflowId };
      } catch {
        // Не раскрываем детали кластера наружу.
        throw new UpstreamError('failed to start agent task workflow');
      }
    },

    async signalCancel(workflowId: string) {
      try {
        await client.workflow.getHandle(workflowId).signal(CANCEL_SIGNAL);
      } catch {
        throw new UpstreamError('failed to signal workflow cancel');
      }
    },

    async close() {
      await connection.close();
    },
  };
}
