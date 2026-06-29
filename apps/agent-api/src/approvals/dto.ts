/** zod-контракты REST approvals + маппер строки БД в DTO (ISO-даты). */
import { z } from 'zod';
import type { ApprovalRow } from '@su10/db';

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected']);

// ---- requests ----
export const ApprovalIdParams = z.object({ id: z.string().uuid() });

export const ListApprovalsQuery = z.object({
  status: ApprovalStatusSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ResolveBody = z.object({
  reason: z.string().max(1000).optional(),
});

// ---- responses ----
export const ApprovalCardSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  toolCallId: z.string().nullable(),
  subjectId: z.string(),
  riskLevel: z.string(),
  action: z.string(),
  resource: z.string().nullable(),
  status: ApprovalStatusSchema,
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ListApprovalsResponse = z.object({ items: z.array(ApprovalCardSchema) });

export type ApprovalCard = z.infer<typeof ApprovalCardSchema>;

export function toApprovalCard(row: ApprovalRow): ApprovalCard {
  return {
    id: row.id,
    taskId: row.taskId,
    toolCallId: row.toolCallId,
    subjectId: row.subjectId,
    riskLevel: row.riskLevel,
    action: row.action,
    resource: row.resource,
    status: row.status as ApprovalCard['status'],
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
