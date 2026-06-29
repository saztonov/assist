/**
 * In-memory реализация `TemporalPort` для local-first/тестов: детерминированный
 * `workflow_id`, без сети. `failStart` воспроизводит ошибку старта workflow
 * (для проверки маппинга в `status='failed'`). Реальный клиент — шаг 6.
 */
import { UpstreamError } from '@su10/errors';
import type { TemporalPort } from '@su10/workflow-engine';

export interface StubTemporalPortOptions {
  /** Если true — `startAgentTaskWorkflow` бросает (путь failed). */
  failStart?: boolean;
  /** Если true — `signalCancel` бросает (путь cancel-failure). */
  failCancel?: boolean;
  /** Если true — `startDocumentProcessingWorkflow` бросает (путь failed). */
  failDocStart?: boolean;
}

export interface StubTemporalPort extends TemporalPort {
  readonly started: ReadonlySet<string>;
  readonly cancelled: ReadonlySet<string>;
  /** workflowId-ы, запущенные как visual-template (передан `template`). */
  readonly startedVisual: ReadonlySet<string>;
}

export function createStubTemporalPort(opts: StubTemporalPortOptions = {}): StubTemporalPort {
  const started = new Set<string>();
  const cancelled = new Set<string>();
  const startedVisual = new Set<string>();
  return {
    started,
    cancelled,
    startedVisual,
    async startAgentTaskWorkflow({ taskId, template }) {
      if (opts.failStart) throw new UpstreamError('temporal unavailable (stub)');
      const workflowId = `agent-task-${taskId}`;
      started.add(workflowId);
      if (template) startedVisual.add(workflowId);
      return { workflowId };
    },
    async signalCancel(workflowId) {
      if (opts.failCancel) throw new UpstreamError('temporal signal failed (stub)');
      cancelled.add(workflowId);
    },
    async startDocumentProcessingWorkflow({ documentId }) {
      if (opts.failDocStart) throw new UpstreamError('temporal unavailable (stub)');
      const workflowId = `document-${documentId}`;
      started.add(workflowId);
      return { workflowId };
    },
  };
}
