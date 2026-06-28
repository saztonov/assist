/** zod-контракты запросов/ответов AgentTask + мапперы строк БД в DTO (ISO-даты). */
import { z } from 'zod';
import {
  AgentTaskStatusSchema,
  type AgentTaskStatus,
  type AgentTaskRow,
  type AgentTaskEventRow,
} from '@su10/db';

// ---- requests ----
export const CreateTaskBody = z.object({
  title: z.string().min(1).max(200).optional(),
  taskType: z.string().min(1).max(100).optional(),
  templateId: z.string().uuid().optional(),
  inputJson: z.record(z.unknown()).optional(),
});

export const TaskIdParams = z.object({ id: z.string().uuid() });

export const ListTasksQuery = z.object({
  status: AgentTaskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

// ---- responses ----
export const TaskCardSchema = z.object({
  id: z.string(),
  status: AgentTaskStatusSchema,
  title: z.string().nullable(),
  taskType: z.string().nullable(),
  workflowId: z.string().nullable(),
  templateId: z.string().nullable(),
  sourcePortal: z.string().nullable(),
  departmentId: z.string().nullable(),
  projectId: z.string().nullable(),
  createdBy: z.string(),
  errorCode: z.string().nullable(),
  resultJson: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TaskSummarySchema = z.object({
  id: z.string(),
  status: AgentTaskStatusSchema,
  title: z.string().nullable(),
  taskType: z.string().nullable(),
  workflowId: z.string().nullable(),
  createdBy: z.string(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ListTasksResponse = z.object({
  items: z.array(TaskSummarySchema),
  nextCursor: z.string().optional(),
});

export const TaskEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  status: z.string().nullable(),
  message: z.string().nullable(),
  dataJson: z.unknown().nullable(),
  createdAt: z.string(),
});

export const EventsResponse = z.object({ items: z.array(TaskEventSchema) });

export type TaskCard = z.infer<typeof TaskCardSchema>;
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

// ---- mappers (row → DTO) ----
export function toTaskCard(row: AgentTaskRow): TaskCard {
  return {
    id: row.id,
    status: row.status as AgentTaskStatus,
    title: row.title,
    taskType: row.taskType,
    workflowId: row.workflowId,
    templateId: row.templateId,
    sourcePortal: row.sourcePortal,
    departmentId: row.departmentId,
    projectId: row.projectId,
    createdBy: row.createdBy,
    errorCode: row.errorCode,
    resultJson: row.resultJson ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTaskSummary(row: AgentTaskRow): TaskSummary {
  return {
    id: row.id,
    status: row.status as AgentTaskStatus,
    title: row.title,
    taskType: row.taskType,
    workflowId: row.workflowId,
    createdBy: row.createdBy,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTaskEvent(row: AgentTaskEventRow): z.infer<typeof TaskEventSchema> {
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    message: row.message,
    dataJson: row.dataJson ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
