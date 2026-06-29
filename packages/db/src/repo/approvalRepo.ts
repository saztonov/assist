/** Доступ к approvals/approval_events (для базовых tools approval.request/resolve
 * и REST /approvals). Резолв high-risk решения атомарен и ограничен `pending`,
 * чтобы повторный/гоночный approve|reject не перезаписал уже принятое решение. */
import { and, desc, eq } from 'drizzle-orm';
import { approvals, approvalEvents } from '../schema/approvals.js';
import type { Database } from '../index.js';

export type ApprovalRow = typeof approvals.$inferSelect;

export type ApprovalDecision = 'approved' | 'rejected';
export type ApprovalStatus = 'pending' | ApprovalDecision;

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
  decision: ApprovalDecision;
  decidedBy: string;
  reason?: string | null;
}

export interface ListApprovalsFilter {
  /** Скоуп для не-admin: только свои (по subjectId). */
  subjectId: string;
  isAdmin: boolean;
  status?: ApprovalStatus;
  limit: number;
}

export interface AgentApprovalRepo {
  create(input: CreateApprovalInput): Promise<ApprovalRow>;
  /** Атомарно резолвит ТОЛЬКО `pending`. Если не найдено или уже решено → undefined. */
  resolve(input: ResolveApprovalInput): Promise<ApprovalRow | undefined>;
  getById(id: string): Promise<ApprovalRow | undefined>;
  listForSubject(filter: ListApprovalsFilter): Promise<ApprovalRow[]>;
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
        // Guard `status='pending'`: при гонке/повторе UPDATE затронет 0 строк.
        const [row] = await tx
          .update(approvals)
          .set({
            status: input.decision,
            decidedBy: input.decidedBy,
            decidedAt: new Date(),
            reason: input.reason ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(approvals.id, input.approvalId), eq(approvals.status, 'pending')))
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

    async listForSubject(filter) {
      const conds = [];
      if (!filter.isAdmin) conds.push(eq(approvals.subjectId, filter.subjectId));
      if (filter.status) conds.push(eq(approvals.status, filter.status));
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
      const q = db
        .select()
        .from(approvals)
        .orderBy(desc(approvals.createdAt), desc(approvals.id))
        .limit(filter.limit);
      return where ? q.where(where) : q;
    },
  };
}
