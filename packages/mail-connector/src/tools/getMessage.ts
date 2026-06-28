/** mail.get_message — full message (bodies truncated to the configured cap). */
import { z } from 'zod';
import type { ToolDefinition } from '@su10/tools';
import {
  loadUsableMailAccount,
  providerForAccount,
  truncateBody,
  type MailReadToolDeps,
} from './deps.js';

const input = z.object({
  connector_account_id: z.string().uuid(),
  mailbox: z.string().min(1).optional(),
  uid: z.string().min(1),
});

const attachmentMeta = z.object({
  attachmentId: z.string(),
  filename: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
});
const output = z.object({
  uid: z.string(),
  mailbox: z.string(),
  subject: z.string().nullable(),
  from: z.string().nullable(),
  to: z.array(z.string()),
  date: z.string().nullable(),
  seen: z.boolean(),
  hasAttachments: z.boolean(),
  sizeBytes: z.number().nullable(),
  textBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
  attachments: z.array(attachmentMeta),
});

export function mailGetMessageTool(
  deps: MailReadToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'mail.get_message',
    version: 1,
    description: 'Получить письмо целиком (тела обрезаются до лимита)',
    category: 'connector',
    riskLevel: 'low',
    inputSchema: input,
    outputSchema: output,
    timeoutMs: 20000,
    async handler(inp, ctx) {
      const account = await loadUsableMailAccount(deps, ctx.subject, inp.connector_account_id);
      const provider = providerForAccount(deps, account);
      const msg = await provider.getMessage(
        { uid: inp.uid, ...(inp.mailbox ? { mailbox: inp.mailbox } : {}) },
        ctx.signal,
      );
      const cap = deps.options.bodyMaxChars;
      return {
        ...msg,
        textBody: truncateBody(msg.textBody, cap),
        htmlBody: truncateBody(msg.htmlBody, cap),
      };
    },
  };
}
