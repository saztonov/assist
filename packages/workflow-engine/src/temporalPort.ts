/**
 * Порт оркестрации Temporal-workflow для AgentTask. NODE-ONLY.
 *
 * Это контракт «как запустить/отменить workflow» — без сетевого кода. agent-api
 * (этап 4) использует in-memory stub; реальный `@temporalio/client` подключается
 * на шаге 6 (Temporal worker foundation). Так `buildApp` остаётся без I/O, а
 * локальные проверки не требуют живого кластера.
 */

export interface StartAgentTaskWorkflowArgs {
  taskId: string;
  templateId?: string;
  taskQueue: string;
  /** От чьего имени исполняется workflow (ids/roles, без сырья). */
  subject?: { id: string; roles: string[] };
  /** Короткая постановка агенту (не ПДн); по умолчанию пусто. */
  prompt?: string;
  agentName?: string;
  requireApproval?: boolean;
}

export interface StartDocumentProcessingArgs {
  documentId: string;
  documentVersionId: string;
  taskQueue: string;
  subject?: { id: string; roles: string[] };
}

export interface TemporalPort {
  /** Запускает workflow задачи; возвращает Temporal `workflow_id`. */
  startAgentTaskWorkflow(args: StartAgentTaskWorkflowArgs): Promise<{ workflowId: string }>;
  /** Сигнал отмены по `workflow_id` (best-effort оркестрация). */
  signalCancel(workflowId: string): Promise<void>;
  /** Запускает workflow обработки документа (этап 9 / M6); возвращает `workflow_id`. */
  startDocumentProcessingWorkflow(
    args: StartDocumentProcessingArgs,
  ): Promise<{ workflowId: string }>;
}
