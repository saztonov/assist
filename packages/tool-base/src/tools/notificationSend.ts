/**
 * notification.send — идемпотентно ставит уведомление в transactional outbox
 * (доставка — отдельным процессором позже). Повтор с тем же dedupeKey не дублирует.
 * Сырьё (body) не логируется; в outbox хранится payload как данные приложения.
 */
import { z } from 'zod';
import type { ToolDefinition } from '@su10/tools';
import type { BaseToolDeps } from '../ports.js';

const input = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  dedupeKey: z.string().min(1).optional(),
});
const output = z.object({ enqueued: z.boolean(), idempotencyKey: z.string() });

export function notificationSendTool(
  deps: BaseToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'notification.send',
    version: 1,
    description: 'Поставить уведомление в очередь доставки (outbox)',
    category: 'notification',
    riskLevel: 'low',
    inputSchema: input,
    outputSchema: output,
    allowedRoles: ['notifications.send'],
    timeoutMs: 5000,
    async handler(inp, ctx) {
      const dedupeKey = inp.dedupeKey ?? `notify:${ctx.subject.id}:${inp.to}:${ctx.at}`;
      const res = await deps.outboxRepo.enqueue({
        aggregateType: 'notification',
        eventType: 'notification.send',
        dedupeKey,
        payload: { to: inp.to, subject: inp.subject, body: inp.body },
      });
      return { enqueued: res.enqueued, idempotencyKey: dedupeKey };
    },
  };
}
