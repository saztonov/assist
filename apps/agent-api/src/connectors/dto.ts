/** Connector REST DTOs. Responses NEVER include secretRef, host, or credentials. */
import { z } from 'zod';

export const ConnectorIdParams = z.object({ id: z.string().uuid() });

export const ConnectionCard = z.object({
  connectorAccountId: z.string(),
  displayName: z.string().nullable(),
  providerKind: z.string().nullable(),
  status: z.string(),
  enabled: z.boolean(),
  mailbox: z.string().nullable(),
});
export const ConnectionListResponse = z.object({ connections: z.array(ConnectionCard) });

/**
 * Create body: non-secret connection metadata + a `secretRef` (e.g. an
 * `env:NAME` / Lockbox reference). The RAW secret is never accepted here.
 */
export const CreateConnectorBody = z.object({
  displayName: z.string().min(1).optional(),
  providerKind: z.enum(['yandex360', 'postbox', 'cloudflare-imap', 'generic-imap']).default('generic-imap'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  user: z.string().min(1),
  mailbox: z.string().min(1).default('INBOX'),
  draftsMailbox: z.string().min(1).default('Drafts'),
  authType: z.enum(['password', 'oauth2']).default('password'),
  secretRef: z.string().min(1),
  enabled: z.boolean().default(false),
  permissions: z
    .array(
      z.object({
        principalType: z.enum(['user', 'role', 'group']),
        principalId: z.string().min(1),
        permission: z.string().min(1).optional(),
      }),
    )
    .optional(),
})
  // Reject any unexpected field at the API boundary (incl. secret-like keys);
  // the raw secret is never accepted — only `secretRef`.
  .strict();
export const CreateConnectorResponse = z.object({
  connectorAccountId: z.string(),
  status: z.string(),
});

export const TestConnectionResponse = z.object({ ok: z.boolean(), status: z.string() });
