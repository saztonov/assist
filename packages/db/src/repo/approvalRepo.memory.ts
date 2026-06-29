/**
 * In-memory реализация `AgentApprovalRepo` для DB-free unit/integration тестов
 * (agent-api `app.inject`). Самостоятельная корректная реализация интерфейса.
 * `resolve` так же ограничен `pending`, как и продакшен-репозиторий.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentApprovalRepo,
  ApprovalRow,
  CreateApprovalInput,
  ListApprovalsFilter,
  ResolveApprovalInput,
} from './approvalRepo.js';

export class InMemoryAgentApprovalRepo implements AgentApprovalRepo {
  readonly approvals: ApprovalRow[] = [];
  private seq = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.seq++ * 1000);
  }

  async create(input: CreateApprovalInput): Promise<ApprovalRow> {
    const ts = this.now();
    const row: ApprovalRow = {
      id: randomUUID(),
      taskId: input.taskId ?? null,
      toolCallId: input.toolCallId ?? null,
      subjectId: input.subjectId,
      riskLevel: input.riskLevel,
      action: input.action,
      resource: input.resource ?? null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      reason: input.reason ?? null,
      metadataJson: input.metadata ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.approvals.push(row);
    return row;
  }

  async resolve(input: ResolveApprovalInput): Promise<ApprovalRow | undefined> {
    const row = this.approvals.find((a) => a.id === input.approvalId);
    // Guard: резолвим только pending; иначе (нет / уже решено) → undefined.
    if (!row || row.status !== 'pending') return undefined;
    row.status = input.decision;
    row.decidedBy = input.decidedBy;
    row.decidedAt = this.now();
    row.reason = input.reason ?? null;
    row.updatedAt = this.now();
    return row;
  }

  async getById(id: string): Promise<ApprovalRow | undefined> {
    return this.approvals.find((a) => a.id === id);
  }

  async listForSubject(filter: ListApprovalsFilter): Promise<ApprovalRow[]> {
    let rows = [...this.approvals];
    if (!filter.isAdmin) rows = rows.filter((a) => a.subjectId === filter.subjectId);
    if (filter.status) rows = rows.filter((a) => a.status === filter.status);
    rows.sort((a, b) => {
      const d = b.createdAt.getTime() - a.createdAt.getTime();
      return d !== 0 ? d : b.id.localeCompare(a.id);
    });
    return rows.slice(0, filter.limit);
  }
}
