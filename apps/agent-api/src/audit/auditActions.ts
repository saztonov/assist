/** Константы action-строк аудита (избегаем stringly-typed дрейфа). */
export const AGENT_TASK_ACTIONS = {
  create: 'agent_task.create',
  start: 'agent_task.start',
  complete: 'agent_task.complete',
  fail: 'agent_task.fail',
  cancel: 'agent_task.cancel',
} as const;
