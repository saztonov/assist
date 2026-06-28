/**
 * Контракт activities AgentTask-workflow. NODE-ONLY, но БЕЗ side effects здесь —
 * только типы. Реализация инжектируется worker-хостом (`workers/temporal-worker`),
 * а детерминированный workflow получает прокси через `proxyActivities`.
 *
 * Все входы/выходы СЕРИАЛИЗУЕМЫ (Temporal payload) и НЕ содержат секретов/сырья:
 * только ids, refs, хэши, статусы. Бизнес-статус меняется ТОЛЬКО через
 * `recordTaskStatus` → `agentTaskRepo.transitionStatus` (источник истины).
 */
import type { AgentTaskStatus } from '@su10/db';

/** Перевод бизнес-статуса задачи (единственная активити смены статуса). */
export interface RecordTaskStatusInput {
  taskId: string;
  to: AgentTaskStatus;
  eventType?: string;
  message?: string;
  errorCode?: string;
  workflowId?: string;
  /** Произвольные НЕ-сырьевые данные события (ids/коды). */
  dataJson?: Record<string, unknown>;
  /** Итог задачи (без ПДн/сырья) — пишется при completed. */
  resultJson?: Record<string, unknown>;
}

/** Вызов произвольного инструмента (через ToolBroker, на стороне worker). */
export interface RunToolBlockInput {
  name: string;
  input: unknown;
  subjectId: string;
  roles: string[];
  at: string;
  taskId?: string;
  agentRunId?: string;
  /** Детерминированный ключ идемпотентности side effect (workflowId+node+attempt). */
  idempotencyKey?: string;
  approved?: boolean;
}

/** Запуск агентного шага (LangGraph runtime; на шаге 6 — stub/echo). */
export interface RunAgentBlockInput {
  taskId: string;
  agentName: string;
  prompt: string;
  subjectId: string;
  roles: string[];
  at: string;
  agentRunId?: string;
}

export interface RunAgentBlockResult {
  output: string;
}

/** Создать артефакт задачи (storageKey — S3-ключ, не URL). */
export interface CreateArtifactInput {
  taskId: string;
  artifactType: string;
  name?: string;
  storageKey: string;
  contentHash?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateArtifactResult {
  artifactId: string;
}

/** Запросить подтверждение high-risk действия (переводит задачу в waiting_for_approval). */
export interface RequestApprovalInput {
  taskId: string;
  subjectId: string;
  action: string;
  resource?: string;
  riskLevel: 'low' | 'medium' | 'high';
  reason?: string;
  at: string;
}

export interface RequestApprovalResult {
  approvalId: string;
}

/** Поставить уведомление в transactional outbox (идемпотентно по dedupeKey). */
export interface NotifyUserInput {
  to: string;
  subject: string;
  body: string;
  dedupeKey: string;
  subjectId: string;
  at: string;
}

export interface NotifyUserResult {
  enqueued: boolean;
}

/**
 * Полный контракт activities. Реализуется в worker-хосте, проксируется в workflow.
 * Side effects идемпотентны (повтор при ретрае Temporal не дублирует эффект).
 */
export interface AgentTaskActivities {
  recordTaskStatus(input: RecordTaskStatusInput): Promise<void>;
  runToolBlock(input: RunToolBlockInput): Promise<unknown>;
  runAgentBlock(input: RunAgentBlockInput): Promise<RunAgentBlockResult>;
  createArtifact(input: CreateArtifactInput): Promise<CreateArtifactResult>;
  requestApproval(input: RequestApprovalInput): Promise<RequestApprovalResult>;
  notifyUser(input: NotifyUserInput): Promise<NotifyUserResult>;
}

// ── Document processing activity (этап 9 / M6) ───────────────────────────────

/** Вход activity обработки документа (ids/refs, без сырья). */
export interface ProcessDocumentInput {
  documentId: string;
  documentVersionId: string;
  subjectId: string;
  roles: string[];
}

export interface ProcessDocumentResult {
  documentId: string;
  status: 'indexed' | 'failed';
  chunkCount: number;
  errorCode?: string;
}

/** Activity, исполняющая document-worker pipeline (parse→OCR→chunk→embed→store). */
export interface DocumentProcessingActivities {
  processDocument(input: ProcessDocumentInput): Promise<ProcessDocumentResult>;
}

export type Activities = AgentTaskActivities & DocumentProcessingActivities;
