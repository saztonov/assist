/** Константы action-строк аудита (избегаем stringly-typed дрейфа). */
export const AGENT_TASK_ACTIONS = {
  create: 'agent_task.create',
  start: 'agent_task.start',
  complete: 'agent_task.complete',
  fail: 'agent_task.fail',
  cancel: 'agent_task.cancel',
} as const;

export const WORKFLOW_TEMPLATE_ACTIONS = {
  create: 'workflow_template.create',
  saveDraft: 'workflow_template.save_draft',
  publish: 'workflow_template.publish',
  testRun: 'workflow_template.test_run',
} as const;

export const DOCUMENT_ACTIONS = {
  uploadSession: 'document.upload_session',
  confirm: 'document.confirm',
} as const;

export const RAG_ACTIONS = {
  search: 'rag.search',
  answer: 'rag.answer',
} as const;

export const MAIL_ACTIONS = {
  connectionList: 'mail.connection.list',
  search: 'mail.search',
  getMessage: 'mail.get_message',
  getAttachments: 'mail.get_attachments',
  saveAttachments: 'mail.save_attachments_to_s3',
  createDraft: 'mail.create_draft',
  accountCreate: 'connector.mail.create',
  connectionTest: 'connector.mail.test',
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
