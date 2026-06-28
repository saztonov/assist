/** Доступ к approvals/approval_events (для базовых tools approval.request/resolve). */
import { eq } from 'drizzle-orm';
import { approvals, approvalEvents } from '../schema/approvals.js';
import type { Database } from '../index.js';

export type ApprovalRow = typeof approvals.$inferSelect;

export interface CreateApprovalInput {
  taskId?: string | null;
  toolCallId?: string | null;
  subjectId: string;
  riskLevel: string;
  action: string;
  resource?: string | null;
  reason?: string | null;
  metadata?: unknown;
}

export interface ResolveApprovalInput {
  approvalId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  reason?: string | null;
}

export interface AgentApprovalRepo {
  create(input: CreateApprovalInput): Promise<ApprovalRow>;
  resolve(input: ResolveApprovalInput): Promise<ApprovalRow | undefined>;
  getById(id: string): Promise<ApprovalRow | undefined>;
}

export function createAgentApprovalRepo(db: Database): AgentApprovalRepo {
  return {
    async create(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(approvals)
          .values({
            taskId: input.taskId ?? null,
            toolCallId: input.toolCallId ?? null,
            subjectId: input.subjectId,
            riskLevel: input.riskLevel,
            action: input.action,
            resource: input.resource ?? null,
            status: 'pending',
            reason: input.reason ?? null,
            metadataJson: input.metadata ?? null,
          })
          .returning();
        await tx.insert(approvalEvents).values({
          approvalId: row.id,
          eventType: 'requested',
          actor: input.subjectId,
        });
        return row;
      });
    },

    async resolve(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(approvals)
          .set({
            status: input.decision,
            decidedBy: input.decidedBy,
            decidedAt: new Date(),
            reason: input.reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(approvals.id, input.approvalId))
          .returning();
        if (!row) return undefined;
        await tx.insert(approvalEvents).values({
          approvalId: row.id,
          eventType: 'decided',
          actor: input.decidedBy,
          outcome: input.decision,
        });
        return row;
      });
    },

    async getById(id) {
      const [row] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
      return row;
    },
  };
}
