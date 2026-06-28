/**
 * Connection-config assembly. Turns a stored connector account (non-secret
 * `metadata_json`) plus a freshly resolved secret into a `MailConnectionConfig`.
 * The secret is read at call time and never persisted on the account row.
 */
import {
  MailConnectorMetadataSchema,
  type ConnectorAccountRow,
  type SecretResolver,
} from '@su10/db';
import { NotFoundError, ValidationError } from '@su10/errors';
import type { MailConnectionConfig } from './port.js';
import type { RateLimitConfig } from './rateLimit.js';

/** Runtime knobs for the mail connector (sourced from env at the app boundary). */
export interface MailConnectorOptions {
  rateLimit: RateLimitConfig;
  maxAttachmentBytes: number;
  bodyMaxChars: number;
}

export const DEFAULT_MAIL_CONNECTOR_OPTIONS: MailConnectorOptions = {
  rateLimit: { capacity: 10, refillPerSec: 2 },
  maxAttachmentBytes: 26_214_400, // 25 MiB
  bodyMaxChars: 50_000,
};

/** zod issue paths only (no values) — safe to surface. */
function issuePaths(error: { issues: Array<{ path: Array<string | number> }> }): string[] {
  return error.issues.map((i) => i.path.join('.') || '(root)');
}

/**
 * Builds the per-connection config. Validates metadata via the strict mail schema
 * (which rejects unknown/secret-like keys) and resolves the account's `secret_ref`.
 */
export function buildMailConnectionConfig(
  account: ConnectorAccountRow,
  secrets: SecretResolver,
): MailConnectionConfig {
  const parsed = MailConnectorMetadataSchema.safeParse(account.metadataJson ?? {});
  if (!parsed.success) {
    throw new ValidationError('mail connector metadata is invalid', {
      connectorAccountId: account.id,
      issuePaths: issuePaths(parsed.error),
    });
  }
  if (!account.secretRef) {
    throw new NotFoundError('mail connector account has no secret reference', {
      connectorAccountId: account.id,
    });
  }
  // Resolver throws with the ref NAME only (never the value) when missing.
  const secret = secrets.resolve(account.secretRef);
  const meta = parsed.data;
  return {
    host: meta.host,
    port: meta.port,
    secure: meta.secure,
    user: meta.user,
    authType: meta.authType,
    secret,
    mailbox: meta.mailbox,
    draftsMailbox: meta.draftsMailbox,
  };
}
