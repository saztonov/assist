/**
 * Константы для детерминированного workflow-бандла. БЕЗ zod/IO/Temporal —
 * чтобы не утяжелять изолированный workflow-бандл лишними зависимостями.
 */

/** Имена сигналов approval/cancel. */
export const APPROVAL_DECISION_SIGNAL = 'approvalDecision' as const;
export const CANCEL_SIGNAL = 'cancelWorkflow' as const;

export interface ApprovalDecisionPayload {
  approvalId: string;
  decision: 'approved' | 'rejected';
}

/**
 * Политика retry для activities (идемпотентность side effects → ретрай безопасен).
 * Значения в мс; конвертируются в строки Temporal на границе proxyActivities.
 */
export const ACTIVITY_RETRY = {
  initialIntervalMs: 1_000,
  backoffCoefficient: 2,
  maximumIntervalMs: 30_000,
  maximumAttempts: 5,
} as const;

export const ACTIVITY_TIMEOUTS = {
  /** Обычные короткие activities. */
  defaultStartToCloseMs: 30_000,
  /** Агентный шаг (LLM/инструменты) — длиннее. */
  agentStartToCloseMs: 120_000,
} as const;
