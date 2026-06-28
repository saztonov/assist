/**
 * Чистый статус-автомат AgentTask (DB-FREE, без I/O).
 *
 * `agent_tasks.status` (+ Temporal `workflow_id`) — источник истины бизнес-статуса.
 * Этот модуль — единственный авторитет легальности переходов; смена статуса в
 * runtime выполняется ТОЛЬКО через `agentTaskRepo.transitionStatus`, который
 * вызывает `assertTransition`. CHECK в `0000_init.sql` — defense in depth.
 */
import { z } from 'zod';
import { ConflictError } from '@su10/errors';

export const AGENT_TASK_STATUSES = [
  'created',
  'queued',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
] as const;

export const AgentTaskStatusSchema = z.enum(AGENT_TASK_STATUSES);
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

/** Терминальные статусы — без исходящих переходов. */
export const TERMINAL_STATUSES: ReadonlySet<AgentTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export const ALLOWED_TRANSITIONS: Readonly<Record<AgentTaskStatus, readonly AgentTaskStatus[]>> = {
  created: ['queued', 'failed', 'cancelled'],
  queued: ['running', 'failed', 'cancelled'],
  running: ['waiting_for_approval', 'completed', 'failed', 'cancelled'],
  waiting_for_approval: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isTerminal(status: AgentTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Бросает `ConflictError(409)` при нелегальном/терминальном переходе.
 * Сообщение безопасно для клиента (только статусы, без сырья).
 */
export function assertTransition(from: AgentTaskStatus, to: AgentTaskStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(`Illegal task status transition: ${from} → ${to}`, {
      from,
      to,
    });
  }
}
