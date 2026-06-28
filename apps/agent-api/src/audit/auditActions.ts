/** Константы action-строк аудита (избегаем stringly-typed дрейфа). */
export const AGENT_TASK_ACTIONS = {
  create: 'agent_task.create',
  start: 'agent_task.start',
  complete: 'agent_task.complete',
  fail: 'agent_task.fail',
  cancel: 'agent_task.cancel',
} as const;

export const DOCUMENT_ACTIONS = {
  uploadSession: 'document.upload_session',
  confirm: 'document.confirm',
} as const;

export const RAG_ACTIONS = {
  search: 'rag.search',
  answer: 'rag.answer',
} as const;

export const LLM_ADMIN_ACTIONS = {
  providerCreate: 'llm.provider.create',
  providerUpdate: 'llm.provider.update',
  modelCreate: 'llm.model.create',
  modelUpdate: 'llm.model.update',
  policyCreate: 'llm.policy.create',
  policyUpdate: 'llm.policy.update',
  modelTest: 'llm.model.test',
} as const;
