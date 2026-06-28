/**
 * mail.create_draft — compose a draft and APPEND it to the Drafts mailbox. NEVER
 * sends (the provider has no transport). Idempotency relies on the broker's
 * idempotency key; the audit meta carries no recipient addresses or body.
 */
import { z } from 'zod';
import { audit } from '@su10/audit';
import type { ToolDefinition } from '@su10/tools';
import { loadUsableMailAccount, providerForAccount, type MailToolDeps } from './deps.js';

const input = z.object({
  connector_account_id: z.string().uuid(),
  subject: z.string().max(998),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  text_body: z.string(),
  html_body: z.string().optional(),
  in_reply_to_uid: z.string().min(1).optional(),
  dedupe_key: z.string().min(1).optional(),
});

const output = z.object({ draftUid: z.string(), mailbox: z.string() });

export function mailCreateDraftTool(
  deps: MailToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'mail.create_draft',
    version: 1,
    description: 'Создать черновик письма (IMAP APPEND). Письмо не отправляется.',
    category: 'connector',
    riskLevel: 'medium',
    inputSchema: input,
    outputSchema: output,
    timeoutMs: 20000,
    async handler(inp, ctx) {
      const account = await loadUsableMailAccount(deps, ctx.subject, inp.connector_account_id);
      const provider = providerForAccount(deps, account);
      const result = await provider.createDraft(
        {
          subject: inp.subject,
          to: inp.to,
          ...(inp.cc ? { cc: inp.cc } : {}),
          ...(inp.bcc ? { bcc: inp.bcc } : {}),
          textBody: inp.text_body,
          ...(inp.html_body ? { htmlBody: inp.html_body } : {}),
          ...(inp.in_reply_to_uid ? { inReplyToUid: inp.in_reply_to_uid } : {}),
        },
        ctx.signal,
      );

      await audit(ctx.auditSink, {
        actor: ctx.subject.id,
        action: 'mail.create_draft',
        resource: `connector:${account.id}`,
        outcome: 'success',
        at: ctx.at,
        meta: {
          connectorAccountId: account.id,
          mailbox: result.mailbox,
          recipientsCount: inp.to.length,
          deduped: false,
        },
      });

      return result;
    },
  };
}
