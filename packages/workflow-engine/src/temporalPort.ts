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
}

export interface TemporalPort {
  /** Запускает workflow задачи; возвращает Temporal `workflow_id`. */
  startAgentTaskWorkflow(args: StartAgentTaskWorkflowArgs): Promise<{ workflowId: string }>;
  /** Сигнал отмены по `workflow_id` (best-effort оркестрация). */
  signalCancel(workflowId: string): Promise<void>;
}
