/** mail.connection.list — connections the subject owns or is permitted to use. */
import { z } from 'zod';
import { MailConnectorMetadataSchema } from '@su10/db';
import type { ToolDefinition } from '@su10/tools';
import { MAIL_CONNECTOR_KEY, type MailReadToolDeps } from './deps.js';

const input = z.object({ enabledOnly: z.boolean().optional() });
const output = z.object({
  connections: z.array(
    z.object({
      connectorAccountId: z.string(),
      displayName: z.string().nullable(),
      providerKind: z.string().nullable(),
      status: z.string(),
      enabled: z.boolean(),
      mailbox: z.string().nullable(),
    }),
  ),
});

export function mailConnectionListTool(
  deps: MailReadToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'mail.connection.list',
    version: 1,
    description: 'Список доступных пользователю почтовых подключений (без секретов и хостов)',
    category: 'connector',
    riskLevel: 'low',
    inputSchema: input,
    outputSchema: output,
    timeoutMs: 5000,
    async handler(inp, ctx) {
      const accounts = await deps.connectorRepo.listForPrincipal(ctx.subject, {
        connectorKey: MAIL_CONNECTOR_KEY,
        ...(inp.enabledOnly ? { enabledOnly: true } : {}),
      });
      return {
        connections: accounts.map((a) => {
          const meta = MailConnectorMetadataSchema.safeParse(a.metadataJson ?? {});
          return {
            connectorAccountId: a.id,
            displayName: a.displayName,
            providerKind: meta.success ? meta.data.providerKind : null,
            status: a.status,
            enabled: a.enabled,
            mailbox: meta.success ? meta.data.mailbox : null,
          };
        }),
      };
    },
  };
}
