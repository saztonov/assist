/**
 * All PostgreSQL access goes through Drizzle ORM here. NODE-ONLY.
 * `agent_tasks` (+ Temporal workflow_id) is the business-status source of truth.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import pg from 'pg';

export const agentTasks = pgTable('agent_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: text('status').notNull().default('pending'),
  workflowId: text('workflow_id'),
  templateId: text('template_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  outcome: text('outcome').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: text('owner_id').notNull(),
  aclTag: text('acl_tag').notNull(),
  contentHash: text('content_hash').notNull(),
  // Real migration uses pgvector `vector(1536)`; modeled as text in the scaffold
  // to avoid coupling the build to a specific pgvector helper version.
  embedding: text('embedding'),
});

export const schema = { agentTasks, auditLog, documents };

export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}
