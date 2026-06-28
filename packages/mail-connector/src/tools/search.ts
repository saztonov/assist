/** mail.search — search a connected mailbox. Returns summaries only (no bodies). */
import { z } from 'zod';
import type { ToolDefinition } from '@su10/tools';
import { loadUsableMailAccount, providerForAccount, type MailReadToolDeps } from './deps.js';
import type { MailSearchQuery } from '../port.js';

const input = z.object({
  connector_account_id: z.string().uuid(),
  mailbox: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  since: z.string().optional(),
  before: z.string().optional(),
  seen: z.boolean().optional(),
  text: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const summary = z.object({
  uid: z.string(),
  mailbox: z.string(),
  subject: z.string().nullable(),
  from: z.string().nullable(),
  to: z.array(z.string()),
  date: z.string().nullable(),
  seen: z.boolean(),
  hasAttachments: z.boolean(),
  sizeBytes: z.number().nullable(),
});
const output = z.object({ messages: z.array(summary) });

export function mailSearchTool(
  deps: MailReadToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'mail.search',
    version: 1,
    description: 'Поиск писем в подключённом почтовом ящике (только сводки, без тел)',
    category: 'connector',
    riskLevel: 'low',
    inputSchema: input,
    outputSchema: output,
    timeoutMs: 20000,
    async handler(inp, ctx) {
      const account = await loadUsableMailAccount(deps, ctx.subject, inp.connector_account_id);
      const provider = providerForAccount(deps, account);
      const query: MailSearchQuery = {
        limit: inp.limit,
        ...(inp.mailbox ? { mailbox: inp.mailbox } : {}),
        ...(inp.from ? { from: inp.from } : {}),
        ...(inp.to ? { to: inp.to } : {}),
        ...(inp.subject ? { subject: inp.subject } : {}),
        ...(inp.since ? { since: inp.since } : {}),
        ...(inp.before ? { before: inp.before } : {}),
        ...(inp.seen !== undefined ? { seen: inp.seen } : {}),
        ...(inp.text ? { text: inp.text } : {}),
      };
      const messages = await provider.search(query, ctx.signal);
      return { messages };
    },
  };
}
