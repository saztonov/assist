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
  DocumentProcessingInputSchema,
  GenericAgentTaskInputSchema,
  VisualTemplateInputSchema,
  assertNoSecretsInPayload,
  CANCEL_SIGNAL,
  type StartAgentTaskWorkflowArgs,
  type StartDocumentProcessingArgs,
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
      // Единый детерминированный id для visual и generic путей: один task = один
      // workflow, корректный target для signalCancel.
      const workflowId = `agent-task-${args.taskId}`;
      const subject = args.subject ?? { id: 'system', roles: [] };

      // Visual builder: стартуем visual_template_generic_workflow с определением.
      if (args.template) {
        const input = VisualTemplateInputSchema.parse({
          taskId: args.taskId,
          subject,
          template: args.template,
        });
        // params узлов авторские → defense-in-depth против утечки секретов в историю.
        assertNoSecretsInPayload(input);
        try {
          const handle = await client.workflow.start('visual_template_generic_workflow', {
            taskQueue: args.taskQueue,
            workflowId,
            args: [input],
          });
          return { workflowId: handle.workflowId };
        } catch {
          throw new UpstreamError('failed to start visual template workflow');
        }
      }

      const input = GenericAgentTaskInputSchema.parse({
        taskId: args.taskId,
        ...(args.templateId ? { templateId: args.templateId } : {}),
        ...(args.agentName ? { agentName: args.agentName } : {}),
        ...(args.prompt ? { prompt: args.prompt } : {}),
        subject,
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

    async startDocumentProcessingWorkflow(args: StartDocumentProcessingArgs) {
      const workflowId = `document-${args.documentId}`;
      const input = DocumentProcessingInputSchema.parse({
        documentId: args.documentId,
        documentVersionId: args.documentVersionId,
        subject: args.subject ?? { id: 'system', roles: [] },
      });
      try {
        const handle = await client.workflow.start('document_processing_workflow', {
          taskQueue: args.taskQueue,
          workflowId,
          args: [input],
        });
        return { workflowId: handle.workflowId };
      } catch {
        throw new UpstreamError('failed to start document processing workflow');
      }
    },

    async close() {
      await connection.close();
    },
  };
}
