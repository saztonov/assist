/**
 * mail.get_attachments — attachment METADATA only (never bytes in tool output).
 * Fetches bytes to enforce the size cap; to persist bytes use
 * mail.save_attachments_to_s3.
 */
import { z } from 'zod';
import { ValidationError } from '@su10/errors';
import type { ToolDefinition } from '@su10/tools';
import { loadUsableMailAccount, providerForAccount, type MailReadToolDeps } from './deps.js';

const input = z.object({
  connector_account_id: z.string().uuid(),
  mailbox: z.string().min(1).optional(),
  uid: z.string().min(1),
  attachment_ids: z.array(z.string()).optional(),
  max_total_bytes: z.number().int().positive().optional(),
});

const output = z.object({
  attachments: z.array(
    z.object({
      attachmentId: z.string(),
      filename: z.string().nullable(),
      mimeType: z.string().nullable(),
      sizeBytes: z.number().nullable(),
    }),
  ),
});

export function mailGetAttachmentsTool(
  deps: MailReadToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'mail.get_attachments',
    version: 1,
    description: 'Метаданные вложений письма (без байтов; байты — через save_attachments_to_s3)',
    category: 'connector',
    riskLevel: 'low',
    inputSchema: input,
    outputSchema: output,
    timeoutMs: 30000,
    async handler(inp, ctx) {
      const account = await loadUsableMailAccount(deps, ctx.subject, inp.connector_account_id);
      const provider = providerForAccount(deps, account);
      const attachments = await provider.getAttachments(
        {
          uid: inp.uid,
          ...(inp.mailbox ? { mailbox: inp.mailbox } : {}),
          ...(inp.attachment_ids ? { attachmentIds: inp.attachment_ids } : {}),
        },
        ctx.signal,
      );
      const cap = inp.max_total_bytes ?? deps.options.maxAttachmentBytes;
      const totalBytes = attachments.reduce((n, a) => n + a.bytes.length, 0);
      if (totalBytes > cap) {
        throw new ValidationError('attachments exceed the maximum total size', { totalBytes, cap });
      }
      return {
        attachments: attachments.map((a) => ({
          attachmentId: a.attachmentId,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes ?? a.bytes.length,
        })),
      };
    },
  };
}
