/**
 * Агентные задачи и их события/артефакты.
 * `agent_tasks` (+ Temporal `workflow_id`) — источник истины бизнес-статуса задачи.
 * LangGraph checkpoint источником НЕ является.
 */
import { pgTable, uuid, text, bigint, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt } from './_columns.js';

export const agentTasks = pgTable('agent_tasks', {
  id: uuidPk(),
  status: text('status').notNull().default('pending'),
  title: text('title'),
  taskType: text('task_type'),
  workflowId: text('workflow_id'),
  templateId: uuid('template_id'),
  templateVersionId: uuid('template_version_id'),
  createdBy: text('created_by').notNull(),
  sourcePortal: text('source_portal'),
  departmentId: text('department_id'),
  projectId: text('project_id'),
  inputJson: jsonb('input_json'),
  resultJson: jsonb('result_json'),
  errorCode: text('error_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agentTaskEvents = pgTable('agent_task_events', {
  id: uuidPk(),
  taskId: uuid('task_id').notNull(),
  eventType: text('event_type').notNull(),
  status: text('status'),
  message: text('message'),
  dataJson: jsonb('data_json'),
  createdAt: createdAt(),
});

export const agentTaskArtifacts = pgTable('agent_task_artifacts', {
  id: uuidPk(),
  taskId: uuid('task_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  name: text('name'),
  // S3 object key (НЕ presigned URL — URL никогда не хранятся/не логируются).
  storageKey: text('storage_key'),
  contentHash: text('content_hash'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
});
