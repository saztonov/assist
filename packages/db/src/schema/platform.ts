/**
 * Платформенные таблицы: аудит бизнес-действий, транзакционный outbox и
 * PostgreSQL-очередь фоновых задач.
 *
 * `audit_events` соответствует контракту `@su10/audit` (actor/action/resource/
 * outcome/at/meta). Аудит и логи не содержат сырых секретов/ПДн/токенов.
 */
import { pgTable, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const auditEvents = pgTable('audit_events', {
  id: uuidPk(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resource: text('resource'),
  outcome: text('outcome').notNull(), // allowed | denied | success | failure
  correlationId: text('correlation_id'),
  sourcePortal: text('source_portal'),
  metaJson: jsonb('meta_json'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuidPk(),
  aggregateType: text('aggregate_type'),
  aggregateId: text('aggregate_id'),
  eventType: text('event_type').notNull(),
  // Ключ идемпотентности доставки (UNIQUE в SQL).
  dedupeKey: text('dedupe_key').notNull(),
  payloadJson: jsonb('payload_json'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(10),
  nextRunAt: tsOptional('next_run_at'),
  lockedUntil: tsOptional('locked_until'),
  dead: boolean('dead').notNull().default(false),
  lastErrorCode: text('last_error_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const postgresJobs = pgTable('postgres_jobs', {
  id: uuidPk(),
  jobType: text('job_type').notNull(),
  queue: text('queue').notNull().default('default'),
  payloadJson: jsonb('payload_json'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  runAfter: tsOptional('run_after'),
  lockedUntil: tsOptional('locked_until'),
  lockedBy: text('locked_by'),
  dead: boolean('dead').notNull().default(false),
  lastErrorCode: text('last_error_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
