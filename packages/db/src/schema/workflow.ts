/**
 * Шаблоны workflow (сохраняются Visual Builder как WorkflowTemplate JSON),
 * их версии и запуски. Visual Builder сам workflow НЕ исполняет.
 */
import { pgTable, uuid, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const workflowTemplates = pgTable('workflow_templates', {
  id: uuidPk(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'),
  latestVersionId: uuid('latest_version_id'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workflowTemplateVersions = pgTable('workflow_template_versions', {
  id: uuidPk(),
  templateId: uuid('template_id').notNull(),
  version: integer('version').notNull(),
  definitionJson: jsonb('definition_json').notNull(),
  checksum: text('checksum'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuidPk(),
  templateId: uuid('template_id'),
  templateVersionId: uuid('template_version_id'),
  taskId: uuid('task_id'),
  // Temporal workflow id (источник истины статуса вместе с agent_tasks).
  workflowId: text('workflow_id'),
  status: text('status').notNull().default('pending'),
  startedAt: tsOptional('started_at'),
  completedAt: tsOptional('completed_at'),
  errorCode: text('error_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
