/**
 * Прогоны LangGraph-агентов и их шаги (reasoning/tool-calling).
 * Это исполнительная телеметрия; бизнес-статус задачи — в agent_tasks.
 */
import { pgTable, uuid, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const agentRuns = pgTable('agent_runs', {
  id: uuidPk(),
  taskId: uuid('task_id'),
  sessionId: uuid('session_id'),
  graphName: text('graph_name'),
  status: text('status').notNull().default('pending'),
  startedAt: tsOptional('started_at'),
  completedAt: tsOptional('completed_at'),
  errorCode: text('error_code'),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agentSteps = pgTable('agent_steps', {
  id: uuidPk(),
  runId: uuid('run_id').notNull(),
  stepIndex: integer('step_index').notNull(),
  stepType: text('step_type').notNull(),
  toolName: text('tool_name'),
  status: text('status'),
  inputHash: text('input_hash'),
  outputHash: text('output_hash'),
  durationMs: integer('duration_ms'),
  dataJson: jsonb('data_json'),
  createdAt: createdAt(),
});
