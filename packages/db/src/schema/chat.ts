/** Чат-сессии и сообщения портала. */
import { pgTable, uuid, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt } from './_columns.js';

export const chatSessions = pgTable('chat_sessions', {
  id: uuidPk(),
  userId: text('user_id').notNull(),
  sourcePortal: text('source_portal'),
  title: text('title'),
  status: text('status').notNull().default('active'),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuidPk(),
  sessionId: uuid('session_id').notNull(),
  role: text('role').notNull(),
  // Содержимое диалога (это не provider usage/rag telemetry — ограничение на
  // prompt/content относится к provider_usage_events и rag_queries, не к чату).
  content: text('content').notNull(),
  toolCallJson: jsonb('tool_call_json'),
  tokenCount: integer('token_count'),
  createdAt: createdAt(),
});
