/** Подтверждения high-risk действий и их события (append-only). */
import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const approvals = pgTable('approvals', {
  id: uuidPk(),
  taskId: uuid('task_id'),
  toolCallId: uuid('tool_call_id'),
  subjectId: text('subject_id').notNull(),
  riskLevel: text('risk_level').notNull(),
  action: text('action').notNull(),
  resource: text('resource'),
  status: text('status').notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: tsOptional('decided_at'),
  reason: text('reason'),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const approvalEvents = pgTable('approval_events', {
  id: uuidPk(),
  approvalId: uuid('approval_id').notNull(),
  eventType: text('event_type').notNull(),
  actor: text('actor').notNull(),
  outcome: text('outcome'),
  message: text('message'),
  dataJson: jsonb('data_json'),
  createdAt: createdAt(),
});
