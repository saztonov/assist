/** Типизированный доступ к /approvals. */
import { api } from './client';

export interface ApprovalCard {
  id: string;
  taskId: string | null;
  toolCallId: string | null;
  subjectId: string;
  riskLevel: string;
  action: string;
  resource: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const approvalsApi = {
  list: (status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<{ items: ApprovalCard[] }> =>
    api.get<{ items: ApprovalCard[] }>(`/approvals?status=${status}`),
  approve: (id: string, reason?: string): Promise<ApprovalCard> =>
    api.post<ApprovalCard>(`/approvals/${id}/approve`, reason ? { reason } : {}),
  reject: (id: string, reason?: string): Promise<ApprovalCard> =>
    api.post<ApprovalCard>(`/approvals/${id}/reject`, reason ? { reason } : {}),
};
