/**
 * approval.request — создаёт запрос подтверждения и переводит задачу в
 * waiting_for_approval (вызывается из running-агента, шаг 6 добавит pause/resume
 * через Temporal-signals). riskLevel=medium + role-gate: сам инструмент НЕ требует
 * approval (иначе дедлок), он и есть механизм запроса approval.
 */
import { z } from 'zod';
import { RiskLevelSchema } from '@su10/permissions';
import type { ToolDefinition } from '@su10/tools';
import type { BaseToolDeps } from '../ports.js';

const input = z.object({
  taskId: z.string().uuid().optional(),
  action: z.string().min(1),
  resource: z.string().optional(),
  riskLevel: RiskLevelSchema,
  reason: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
const output = z.object({ approvalId: z.string(), status: z.literal('pending') });

export function approvalRequestTool(
  deps: BaseToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'approval.request',
    version: 1,
    description: 'Запросить подтверждение high-risk действия',
    category: 'approval',
    riskLevel: 'medium',
    inputSchema: input,
    outputSchema: output,
    requiresApproval: false,
    allowedRoles: ['agent.run', 'tasks.write'],
    timeoutMs: 5000,
    async handler(inp, ctx) {
      const approval = await deps.approvalRepo.create({
        taskId: inp.taskId ?? null,
        subjectId: ctx.subject.id,
        riskLevel: inp.riskLevel,
        action: inp.action,
        resource: inp.resource ?? null,
        reason: inp.reason ?? null,
        metadata: inp.metadata ?? null,
      });
      if (inp.taskId) {
        await deps.taskRepo.transitionStatus({
          taskId: inp.taskId,
          to: 'waiting_for_approval',
          eventType: 'approval_requested',
          dataJson: { approvalId: approval.id },
        });
      }
      return { approvalId: approval.id, status: 'pending' };
    },
  };
}
