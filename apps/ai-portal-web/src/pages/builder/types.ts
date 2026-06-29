/**
 * Локальные browser-интерфейсы для серверных DTO. Серверные пакеты (@su10/db,
 * @su10/tools, …) импортировать НЕЛЬЗЯ (check-frontend-boundaries). Сетевые вызовы —
 * только через `api`-клиент к /api/v1.
 */
import type { WorkflowTemplate } from '@su10/workflow-schema';

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

/** Метаданные инструмента из GET /tools (inputSchema приходит как JSON Schema). */
export interface ToolMetadata {
  name: string;
  version: number;
  description: string;
  category: string;
  riskLevel: string;
  allowedRoles?: string[];
  requiresApproval: boolean;
  timeoutMs: number;
  inputSchema: unknown;
  outputSchema: unknown;
  checksum: string;
}

export interface WorkflowTemplateListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateDetail extends WorkflowTemplateListItem {
  latestVersion: number;
  definition: WorkflowTemplate;
}

export interface TaskCard {
  id: string;
  status: TaskStatus;
  title: string | null;
  taskType: string | null;
  workflowId: string | null;
  templateId: string | null;
  createdBy: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  eventType: string;
  status: string | null;
  message: string | null;
  createdAt: string;
}
