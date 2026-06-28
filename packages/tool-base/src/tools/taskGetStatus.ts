/** task.get_status — статус задачи (owner/admin-aware). */
import { z } from 'zod';
import { NotFoundError } from '@su10/errors';
import type { ToolDefinition } from '@su10/tools';
import type { BaseToolDeps } from '../ports.js';

const input = z.object({ taskId: z.string().uuid() });
const output = z.object({
  taskId: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  taskType: z.string().nullable(),
  errorCode: z.string().nullable(),
});

export function taskGetStatusTool(
  deps: BaseToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'task.get_status',
    version: 1,
    description: 'Получить статус агентной задачи',
    category: 'task',
    riskLevel: 'low',
    inputSchema: input,
    outputSchema: output,
    allowedRoles: ['tasks.read'],
    timeoutMs: 5000,
    async handler({ taskId }, ctx) {
      const task = await deps.taskRepo.getTaskById(taskId);
      const isAdmin = ctx.subject.roles.includes('admin');
      if (!task || (!isAdmin && task.createdBy !== ctx.subject.id)) {
        throw new NotFoundError('task not found');
      }
      return {
        taskId: task.id,
        status: task.status,
        title: task.title,
        taskType: task.taskType,
        errorCode: task.errorCode,
      };
    },
  };
}
