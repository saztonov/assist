/**
 * Сериализуемые контракты workflow + конфигурация retry/timeout + имена сигналов.
 * BROWSER-SAFE по сути (zod + типы), но пакет NODE-ONLY. НЕ импортирует Temporal,
 * чтобы оставаться доступным и тестам, и (через типы) детерминированному workflow.
 */
import { z } from 'zod';
import { WorkflowTemplateSchema } from '@su10/workflow-schema';

/** Идентичность субъекта, от имени которого исполняется workflow (ids/roles, без сырья). */
export const WorkflowSubjectSchema = z.object({
  id: z.string().min(1),
  roles: z.array(z.string()).default([]),
});
export type WorkflowSubject = z.infer<typeof WorkflowSubjectSchema>;

/** Вход generic_agent_task_workflow — только ids/refs/флаги (НЕТ секретов/промптов с ПДн). */
export const GenericAgentTaskInputSchema = z.object({
  taskId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  agentName: z.string().min(1).default('chat_agent'),
  /** Короткая постановка задачи агенту (не ПДн). */
  prompt: z.string().default(''),
  subject: WorkflowSubjectSchema,
  /** Если true — перед исполнением требуется approval (pause/resume). */
  requireApproval: z.boolean().default(false),
  approvalRiskLevel: z.enum(['low', 'medium', 'high']).default('high'),
});
export type GenericAgentTaskInput = z.infer<typeof GenericAgentTaskInputSchema>;

/** Вход visual_template_generic_workflow — задача + опубликованный WorkflowTemplate JSON. */
export const VisualTemplateInputSchema = z.object({
  taskId: z.string().min(1),
  subject: WorkflowSubjectSchema,
  template: WorkflowTemplateSchema,
});
export type VisualTemplateInput = z.infer<typeof VisualTemplateInputSchema>;

// Сигналы и retry/timeout-конфиг живут в constants.ts (lean-бандл workflow).
export {
  APPROVAL_DECISION_SIGNAL,
  CANCEL_SIGNAL,
  ACTIVITY_RETRY,
  ACTIVITY_TIMEOUTS,
  type ApprovalDecisionPayload,
} from './constants.js';

/**
 * Guard: аргументы workflow не должны содержать секретов/токенов/presigned URL.
 * Используется тестом и (опционально) на границе старта. Поверхностная эвристика
 * по ключам/значениям — defense in depth, не замена ревью.
 */
const FORBIDDEN_KEY = /(token|secret|password|authorization|presigned|api[_-]?key)/i;
const FORBIDDEN_VALUE = /(^https?:\/\/.*\b(x-amz-|signature=|sig=))|bearer\s+/i;

export function assertNoSecretsInPayload(payload: unknown, path = '$'): void {
  if (payload === null || payload === undefined) return;
  if (typeof payload === 'string') {
    if (FORBIDDEN_VALUE.test(payload)) {
      throw new Error(`Potential secret in workflow payload at ${path}`);
    }
    return;
  }
  if (typeof payload !== 'object') return;
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertNoSecretsInPayload(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_KEY.test(k)) {
      throw new Error(`Forbidden secret-like key "${k}" in workflow payload at ${path}`);
    }
    assertNoSecretsInPayload(v, `${path}.${k}`);
  }
}
