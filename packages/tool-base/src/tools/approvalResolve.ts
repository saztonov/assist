/**
 * approval.resolve — решение по запросу подтверждения (только approver/admin —
 * через allowedRoles на брокере). approved → задача resume (waiting_for_approval
 * → running); rejected → задача failed. riskLevel=medium (иначе дедлок approval).
 */
import { z } from 'zod';
import { NotFoundError } from '@su10/errors';
import type { ToolDefinition } from '@su10/tools';
import type { BaseToolDeps } from '../ports.js';

const input = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
});
const output = z.object({ approvalId: z.string(), status: z.enum(['approved', 'rejected']) });

export function approvalResolveTool(
  deps: BaseToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'approval.resolve',
    version: 1,
    description: 'Подтвердить или отклонить запрос (approver/admin)',
    category: 'approval',
    riskLevel: 'medium',
    inputSchema: input,
    outputSchema: output,
    requiresApproval: false,
    allowedRoles: ['approver', 'admin'],
    timeoutMs: 5000,
    async handler(inp, ctx) {
      const approval = await deps.approvalRepo.resolve({
        approvalId: inp.approvalId,
        decision: inp.decision,
        decidedBy: ctx.subject.id,
        reason: inp.reason ?? null,
      });
      if (!approval) throw new NotFoundError('approval not found');
      if (approval.taskId) {
        await deps.taskRepo.transitionStatus({
          taskId: approval.taskId,
          to: inp.decision === 'approved' ? 'running' : 'failed',
          eventType: inp.decision === 'approved' ? 'approval_granted' : 'approval_rejected',
          ...(inp.decision === 'rejected' ? { errorCode: 'APPROVAL_REJECTED' } : {}),
        });
      }
      return { approvalId: approval.id, status: inp.decision };
    },
  };
}
